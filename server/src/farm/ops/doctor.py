"""Read-only host diagnostics. Never echo network errors, credentials or response bodies."""
import base64
import contextlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import httpx
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from farm.config import REPO_ROOT, Settings
from farm.db.engine import Database
from farm.db.migrate import alembic_config
from farm.db.models import AgentStatus, Device, Workspace
from farm.timeutil import age_seconds
from farm.workspaces.registry import open_repo


@dataclass(frozen=True)
class Check:
    status: str
    name: str
    hint: str

    def __str__(self) -> str:
        return f"{self.status} {self.name}: {self.hint}"


def _version(name: str, *args: str) -> Check:
    if not shutil.which(name):
        return Check("FAIL", name, "Executable not found · install it and check PATH")
    try:
        result = subprocess.run([name, *args], capture_output=True, text=True, errors="replace",
                                timeout=10, check=False)
        if result.returncode == 0:
            lines = (result.stdout + "\n" + result.stderr).strip().splitlines()
            return Check("OK", name, lines[0] if lines else "Executable available")
    except (OSError, subprocess.SubprocessError):
        pass
    return Check("FAIL", name, "Version check failed · check PATH and execute permissions")


def _ai(settings: Settings) -> Check:
    from farm.ai import client as ai

    builder = getattr(ai, "build_ai_client", None)
    if builder is not None:
        client = None
        try:
            client = builder(settings)
            if client is not None:
                provider = getattr(client, "provider", None) or (
                    "codex" if type(client).__name__ == "CodexCliClient" else "openai")
                return Check("OK", "AI", f"{provider} available")
        except Exception:  # noqa: BLE001 - provider failure must not hide the remaining host checks
            return Check("WARN", "AI", "Provider check failed · check CLI login or API key configuration")
        finally:
            if client is not None and callable(getattr(client, "close", None)):
                with contextlib.suppress(Exception):  # cleanup must not prevent the rest of the diagnostics
                    client.close()
    else:  # A1 may not have landed yet.
        if settings.openai_api_key:
            return Check("OK", "AI", "OpenAI key configured · validity is checked on request")
        codex = getattr(settings, "codex_bin", "codex")
        if shutil.which(codex):
            try:
                result = subprocess.run([codex, "login", "status"], capture_output=True, timeout=10, check=False)
                if result.returncode == 0:
                    return Check("OK", "AI", "Codex CLI authenticated")
            except (OSError, subprocess.SubprocessError):
                pass
    return Check("WARN", "AI", "Disabled · run codex login or set FARM_OPENAI_API_KEY")


def run_doctor(db: Database, settings: Settings, *,
               github_transport: httpx.BaseTransport | None = None) -> list[Check]:
    checks = [_version(name, *args) for name, args in (
        ("adb", ("version",)), ("maestro", ("--version",)), ("java", ("-version",)), ("git", ("--version",)))]
    jar = Path(getattr(settings, "scrcpy_server_path", REPO_ROOT.parent / "ops/scrcpy/scrcpy-server-v4.1"))
    version = getattr(settings, "scrcpy_version", "4.1")
    try:
        found_jar = jar.is_file() and jar.stat().st_size > 0
    except OSError:
        found_jar = False
    checks.append(Check("OK" if found_jar else "WARN", "scrcpy", f"server {version} · {jar}" + (
        "" if found_jar else " · place the JAR file")))

    workspaces, devices, agents = [], [], []
    try:
        with db.engine.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
        heads = set(ScriptDirectory.from_config(alembic_config(db.path)).get_heads())
        if current == heads:
            checks.append(Check("OK", "DB", f"Connected · migrations head ({', '.join(sorted(heads))})"))
        else:
            checks.append(Check("FAIL", "DB", "Migration required · run uv run farm db upgrade"))
        with db.session() as s:
            workspaces = list(s.scalars(select(Workspace).order_by(Workspace.name)))
            devices = list(s.scalars(select(Device).order_by(Device.serial)))
            agents = list(s.scalars(select(AgentStatus).order_by(AgentStatus.id)))
    except (OSError, SQLAlchemyError, CommandError):
        checks.append(Check("FAIL", "DB", "Query failed · check FARM_DATA_DIR, database permissions, and migrations"))

    if settings.github_token:
        try:
            with httpx.Client(transport=github_transport, timeout=10, follow_redirects=False) as client:
                response = client.get("https://api.github.com/user", headers={
                    "Authorization": f"Bearer {settings.github_token.get_secret_value()}",
                    "Accept": "application/vnd.github+json"})
            checks.append(Check("OK" if response.status_code == 200 else "FAIL", "GitHub token",
                                "Valid" if response.status_code == 200 else "Authentication failed · check PAT permissions and expiration"))
        except httpx.HTTPError:
            checks.append(Check("FAIL", "GitHub token", "Connection failed · check network and PAT configuration"))
    else:
        checks.append(Check("WARN", "GitHub token", "Not configured · not needed for an SSH remote"))
    for workspace in workspaces:
        try:
            repo = open_repo(settings, workspace.repo)
            repo.timeout = 10
            # Reuse the workspace layer's credential/header environment, but ls-remote
            # needs no local bare repository (a doctor check must not create one).
            env = repo._env()
            env.pop("GIT_DIR", None)
            env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o ConnectTimeout=10"
            result = subprocess.run(["git", "ls-remote", "--exit-code", repo.remote_url,
                                     f"refs/heads/{workspace.branch}"], env=env,
                                    capture_output=True, timeout=repo.timeout, check=False)
            reachable = result.returncode == 0
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            reachable = False
        checks.append(Check("OK" if reachable else "FAIL", f"workspace {workspace.name}",
                            "Remote branch reachable" if reachable else "Remote access failed · check SSH/PAT, repository, and branch"))

    checks.append(_ai(settings))
    if not devices:
        checks.append(Check("WARN", "devices", "No registered devices · check USB debugging and farm agent"))
    for device in devices:
        warning = device.state in {"offline", "unhealthy", "unauthorized"}
        checks.append(Check("WARN" if warning else "OK", f"device {device.serial}", f"state {device.state}" +
                            (" · check USB connection and device availability" if warning else "")))
    if not agents:
        checks.append(Check("WARN", "agent heartbeat", "No heartbeat recorded · run uv run farm agent"))
    for agent in agents:
        try:
            age = max(0.0, age_seconds(agent.last_heartbeat_at))
            checks.append(Check("OK" if age <= 30 else "WARN", f"agent {agent.id}",
                                f"heartbeat {age:.0f}s ago" + (" · check the agent logs" if age > 30 else "")))
        except (ValueError, TypeError):
            checks.append(Check("WARN", f"agent {agent.id}", "Invalid heartbeat timestamp · check the agent"))
    try:
        path = settings.data_dir
        while not path.exists() and path != path.parent:
            path = path.parent
        usage = shutil.disk_usage(path)
        checks.append(Check("WARN" if usage.free < 1024 ** 3 else "OK", "disk",
                            f"{settings.data_dir} · {usage.free / 1024 ** 3:.1f} GiB free" +
                            (" · check retention settings" if usage.free < 1024 ** 3 else "")))
    except OSError:
        checks.append(Check("FAIL", "disk", "Free-space check failed · check data directory permissions"))

    secrets = [value.get_secret_value() for value in (settings.github_token, settings.openai_api_key) if value]
    if settings.github_token:
        secrets.append(base64.b64encode(f"x-access-token:{settings.github_token.get_secret_value()}".encode()).decode())

    def clean(value: str) -> str:
        for secret in secrets:
            value = value.replace(secret, "***")
        return " ".join(value.splitlines())[:300]

    return [Check(c.status, clean(c.name), clean(c.hint)) for c in checks]
