import argparse
import asyncio
import logging
import signal
import sys
from time import monotonic, sleep

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from farm.agent.main import Agent
from farm.auth import TokenExistsError, create_token, list_tokens, revoke_token
from farm.config import Settings
from farm.db import migrate
from farm.db.engine import Database
from farm.devices.adb import Adb, AndroidAdbProvider
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.runner.fake import FakeInspector, FakeRunner
from farm.runner.inspect import AdbInspector
from farm.runner.maestro import MaestroRunner
from farm.stream.manager import StreamManager
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.registry import create_workspace, delete_workspace, list_workspaces


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="farm", description="maestro-device-farm operations")
    sub = parser.add_subparsers(dest="cmd", required=True)

    db = sub.add_parser("db", help="database schema")
    db_sub = db.add_subparsers(dest="db_cmd", required=True)
    db_sub.add_parser("upgrade", help="apply migrations")
    revision = db_sub.add_parser("revision", help="autogenerate a migration (developers)")
    revision.add_argument("-m", "--message", required=True)
    revision.add_argument("--rev-id")
    token = sub.add_parser("token", help="API tokens")
    token_sub = token.add_subparsers(dest="token_cmd", required=True)
    token_sub.add_parser("create", help="create a token and print it once").add_argument("name")
    token_sub.add_parser("list", help="list tokens")
    token_sub.add_parser("revoke", help="delete a token").add_argument("name")
    workspace = sub.add_parser("workspace", help="flow workspaces (GitHub repo + branch + path)")
    ws_sub = workspace.add_subparsers(dest="ws_cmd", required=True)
    add = ws_sub.add_parser("add", help="register a workspace (fetches the branch to check access)")
    add.add_argument("--name", required=True)
    add.add_argument("--repo", required=True, help="owner/name")
    add.add_argument("--branch", default="main")
    add.add_argument("--path", default="", help="workspace root inside the repo, e.g. .maestro")
    add.add_argument("--app-package", dest="default_app_package")
    ws_sub.add_parser("list", help="list workspaces")
    ws_sub.add_parser("remove", help="unregister a workspace (the repo is untouched)").add_argument("name")
    sub.add_parser("api", help="run farm-api (applies migrations first)")
    sub.add_parser("doctor", help="Check host and farm status")
    retention = sub.add_parser("retention", help="Remove expired data")
    retention_run = retention.add_subparsers(dest="retention_cmd", required=True).add_parser("run", help="Run cleanup now")
    retention_run.add_argument("--dry-run", action="store_true", help="Preview cleanup without changing files or the database")
    agent = sub.add_parser("agent", help="run farm-agent")
    agent.add_argument("--fake", type=int, default=0, metavar="N",
                       help="simulate N devices with the fake runner instead of adb/maestro")
    return parser


def _cmd_db(args: argparse.Namespace, settings: Settings) -> int:
    if args.db_cmd == "upgrade":
        migrate.upgrade(settings.database_path)
        print(f"database ready: {settings.database_path}")
        return 0
    migrate.autogenerate(args.message, rev_id=args.rev_id)
    return 0


def _cmd_token(args: argparse.Namespace, settings: Settings) -> int:
    db = Database(settings.database_path)
    if args.token_cmd == "create":
        try:
            with db.session() as s:
                token = create_token(s, args.name)
        except TokenExistsError:
            print(f"token '{args.name}' already exists", file=sys.stderr)
            return 1
        print(token)
        return 0
    if args.token_cmd == "list":
        with db.session() as s:
            for row in list_tokens(s):
                print(f"{row.name}\tcreated {row.created_at}\tlast used {row.last_used_at or '-'}")
        return 0
    with db.session() as s:
        removed = revoke_token(s, args.name)
    if not removed:
        print(f"token '{args.name}' not found", file=sys.stderr)
        return 1
    return 0


def _cmd_workspace(args: argparse.Namespace, settings: Settings) -> int:
    db = Database(settings.database_path)
    try:
        if args.ws_cmd == "add":
            ws = create_workspace(db, settings, name=args.name, repo=args.repo, branch=args.branch, path=args.path,
                                  default_app_package=args.default_app_package)
            print(f"workspace {ws.name} added at {ws.head_sha[:7]}")
        elif args.ws_cmd == "list":
            for ws in list_workspaces(db):
                head = (ws.head_sha or "-------")[:7]
                status = f"error: {ws.sync_error}" if ws.sync_error else f"synced {ws.synced_at}"
                print(f"{ws.name}\t{ws.repo}@{ws.branch}:{ws.path or '/'}\t{head}\t{status}")
        else:
            delete_workspace(db, args.name)
    except WorkspaceError as exc:
        print(f"{exc.code}: {exc.message}", file=sys.stderr)
        return 1
    return 0


def wait_for_schema(db: Database, timeout: float = 120) -> bool:
    heads = set(ScriptDirectory.from_config(migrate.alembic_config(db.path)).get_heads())
    deadline = monotonic() + timeout
    waiting_logged = False
    while True:
        # Close each transaction before sleeping so farm-api can migrate independently.
        with db.engine.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
        if current == heads:
            return True
        if not waiting_logged:
            logging.getLogger(__name__).info("waiting for database migrations (current %s, head %s)",
                                             ",".join(sorted(current)) or "none", ",".join(sorted(heads)))
            waiting_logged = True
        remaining = deadline - monotonic()
        if remaining <= 0:
            print(f"database migrations not ready after {timeout:g}s: "
                  "start farm api or run `farm db upgrade`", file=sys.stderr)
            return False
        sleep(min(2, remaining))


def build_agent(settings: Settings, *, db: Database | None = None, fake_devices: int = 0) -> Agent:
    db = db or Database(settings.database_path)
    adb = Adb()
    stream_manager = StreamManager(adb, settings, db=db, control_hooks=[])
    if fake_devices:
        infos = [DeviceInfo(f"fake-{i}", "device", model="Fake Pixel", manufacturer="Fake", os_version="14",
                            sdk_int=34, battery=100) for i in range(1, fake_devices + 1)]
        return Agent(settings, db, FakeProvider(infos), FakeRunner(delay=2.0), FakeInspector(),
                     stream_manager=stream_manager)
    return Agent(settings, db, AndroidAdbProvider(adb), MaestroRunner(adb, min_battery=settings.min_battery),
                 AdbInspector(adb), stream_manager=stream_manager)


async def _run_agent(agent: Agent) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, agent.request_stop)
    await agent.run()


def _cmd_agent(args: argparse.Namespace, settings: Settings) -> int:
    db = Database(settings.database_path)
    try:
        if not wait_for_schema(db):
            return 2
        asyncio.run(_run_agent(build_agent(settings, db=db, fake_devices=args.fake)))
        return 0
    finally:
        db.dispose()


def _cmd_api(_args: argparse.Namespace, settings: Settings) -> int:
    import uvicorn

    from farm.api.app import create_app

    migrate.upgrade(settings.database_path)
    uvicorn.run(create_app(settings), host=settings.api_host, port=settings.api_port)
    return 0


def _cmd_doctor(_args: argparse.Namespace, settings: Settings) -> int:
    from farm.ops.doctor import run_doctor

    try:
        db = Database(settings.database_path)
    except OSError:
        print("FAIL DB: cannot create data directory · check FARM_DATA_DIR and directory permissions")
        return 1
    try:
        checks = run_doctor(db, settings)
        for check in checks:
            print(check)
        return int(any(check.status == "FAIL" for check in checks))
    finally:
        db.dispose()


def _cmd_retention(args: argparse.Namespace, settings: Settings) -> int:
    from dataclasses import asdict

    from farm.ops.retention import run_retention

    db = Database(settings.database_path)
    try:
        paths = []
        report = run_retention(db, settings, dry_run=args.dry_run, removal_paths=paths if args.dry_run else None)
        print(("Retention preview: " if args.dry_run else "Retention complete: ") +
              " ".join(f"{key}={value}" for key, value in asdict(report).items()))
        for path in paths:
            print("Would delete: " + " ".join(str(path).splitlines()))
        return 0
    finally:
        db.dispose()


HANDLERS = {"db": _cmd_db, "token": _cmd_token, "workspace": _cmd_workspace, "api": _cmd_api,
            "agent": _cmd_agent, "doctor": _cmd_doctor, "retention": _cmd_retention}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    return HANDLERS[args.cmd](args, Settings())


if __name__ == "__main__":
    sys.exit(main())
