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
        return Check("FAIL", name, "실행 파일 없음 · 설치 후 PATH를 확인하세요")
    try:
        result = subprocess.run([name, *args], capture_output=True, text=True, errors="replace",
                                timeout=10, check=False)
        if result.returncode == 0:
            lines = (result.stdout + "\n" + result.stderr).strip().splitlines()
            return Check("OK", name, lines[0] if lines else "실행 가능")
    except (OSError, subprocess.SubprocessError):
        pass
    return Check("FAIL", name, "버전 확인 실패 · PATH와 실행 권한을 확인하세요")


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
                return Check("OK", "AI", f"{provider} 사용 가능")
        except Exception:  # noqa: BLE001 - provider failure must not hide the remaining host checks
            return Check("WARN", "AI", "제공자 확인 실패 · CLI 로그인 또는 키 설정을 확인하세요")
        finally:
            if client is not None and callable(getattr(client, "close", None)):
                with contextlib.suppress(Exception):  # cleanup must not prevent the rest of the diagnostics
                    client.close()
    else:  # A1 may not have landed yet.
        if settings.openai_api_key:
            return Check("OK", "AI", "OpenAI 키 설정됨 · 키 유효성은 요청 시 확인")
        codex = getattr(settings, "codex_bin", "codex")
        if shutil.which(codex):
            try:
                result = subprocess.run([codex, "login", "status"], capture_output=True, timeout=10, check=False)
                if result.returncode == 0:
                    return Check("OK", "AI", "Codex CLI 로그인됨")
            except (OSError, subprocess.SubprocessError):
                pass
    return Check("WARN", "AI", "비활성 · codex login 또는 FARM_OPENAI_API_KEY를 설정하세요")


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
    checks.append(Check("OK" if found_jar else "WARN", "scrcpy", f"서버 {version} · {jar}" + (
        "" if found_jar else " · jar 파일을 배치하세요")))

    workspaces, devices, agents = [], [], []
    try:
        with db.engine.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
        heads = set(ScriptDirectory.from_config(alembic_config(db.path)).get_heads())
        if current == heads:
            checks.append(Check("OK", "DB", f"연결됨 · migrations head ({', '.join(sorted(heads))})"))
        else:
            checks.append(Check("FAIL", "DB", "마이그레이션 필요 · uv run farm db upgrade"))
        with db.session() as s:
            workspaces = list(s.scalars(select(Workspace).order_by(Workspace.name)))
            devices = list(s.scalars(select(Device).order_by(Device.serial)))
            agents = list(s.scalars(select(AgentStatus).order_by(AgentStatus.id)))
    except (OSError, SQLAlchemyError, CommandError):
        checks.append(Check("FAIL", "DB", "조회 실패 · FARM_DATA_DIR, DB 권한과 마이그레이션을 확인하세요"))

    if settings.github_token:
        try:
            with httpx.Client(transport=github_transport, timeout=10, follow_redirects=False) as client:
                response = client.get("https://api.github.com/user", headers={
                    "Authorization": f"Bearer {settings.github_token.get_secret_value()}",
                    "Accept": "application/vnd.github+json"})
            checks.append(Check("OK" if response.status_code == 200 else "FAIL", "GitHub token",
                                "유효함" if response.status_code == 200 else "인증 실패 · PAT 권한과 만료를 확인하세요"))
        except httpx.HTTPError:
            checks.append(Check("FAIL", "GitHub token", "연결 실패 · 네트워크와 PAT 설정을 확인하세요"))
    else:
        checks.append(Check("WARN", "GitHub token", "미설정 · SSH 원격 사용 시 필요 없음"))
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
                            "원격 브랜치 접근 가능" if reachable else "원격 접근 실패 · SSH/PAT, 저장소와 브랜치를 확인하세요"))

    checks.append(_ai(settings))
    if not devices:
        checks.append(Check("WARN", "devices", "등록된 기기 없음 · USB 디버깅과 farm agent를 확인하세요"))
    for device in devices:
        warning = device.state in {"offline", "unhealthy", "unauthorized"}
        checks.append(Check("WARN" if warning else "OK", f"device {device.serial}", f"상태 {device.state}" +
                            (" · USB 연결과 기기 사용 가능 상태를 확인하세요" if warning else "")))
    if not agents:
        checks.append(Check("WARN", "agent heartbeat", "기록 없음 · uv run farm agent를 실행하세요"))
    for agent in agents:
        try:
            age = max(0.0, age_seconds(agent.last_heartbeat_at))
            checks.append(Check("OK" if age <= 30 else "WARN", f"agent {agent.id}",
                                f"heartbeat {age:.0f}초 전" + (" · agent 로그를 확인하세요" if age > 30 else "")))
        except (ValueError, TypeError):
            checks.append(Check("WARN", f"agent {agent.id}", "heartbeat 시간 형식 오류 · agent를 확인하세요"))
    try:
        path = settings.data_dir
        while not path.exists() and path != path.parent:
            path = path.parent
        usage = shutil.disk_usage(path)
        checks.append(Check("WARN" if usage.free < 1024 ** 3 else "OK", "disk",
                            f"{settings.data_dir} · 여유 {usage.free / 1024 ** 3:.1f} GiB" +
                            (" · 보관 설정을 확인하세요" if usage.free < 1024 ** 3 else "")))
    except OSError:
        checks.append(Check("FAIL", "disk", "여유 공간 조회 실패 · 데이터 경로 권한을 확인하세요"))

    secrets = [value.get_secret_value() for value in (settings.github_token, settings.openai_api_key) if value]
    if settings.github_token:
        secrets.append(base64.b64encode(f"x-access-token:{settings.github_token.get_secret_value()}".encode()).decode())

    def clean(value: str) -> str:
        for secret in secrets:
            value = value.replace(secret, "***")
        return " ".join(value.splitlines())[:300]

    return [Check(c.status, clean(c.name), clean(c.hint)) for c in checks]
