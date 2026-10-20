import argparse
import logging
import sys

from farm.config import Settings
from farm.db import migrate
from farm.auth import TokenExistsError, create_token, list_tokens, revoke_token
from farm.db.engine import Database

import asyncio
import signal

from sqlalchemy import inspect

from farm.agent.main import Agent
from farm.devices.adb import Adb, AndroidAdbProvider
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.runner.fake import FakeInspector, FakeRunner
from farm.runner.inspect import AdbInspector
from farm.runner.maestro import MaestroRunner


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
    sub.add_parser("api", help="run farm-api (applies migrations first)")
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


def schema_ready(db: Database) -> bool:
    return inspect(db.engine).has_table("devices")


def build_agent(settings: Settings, *, db: Database | None = None, fake_devices: int = 0) -> Agent:
    db = db or Database(settings.database_path)
    if fake_devices:
        infos = [DeviceInfo(f"fake-{i}", "device", model="Fake Pixel", manufacturer="Fake", os_version="14",
                            sdk_int=34, battery=100) for i in range(1, fake_devices + 1)]
        return Agent(settings, db, FakeProvider(infos), FakeRunner(delay=2.0), FakeInspector())
    adb = Adb()
    return Agent(settings, db, AndroidAdbProvider(adb), MaestroRunner(adb, min_battery=settings.min_battery),
                 AdbInspector(adb))


async def _run_agent(agent: Agent) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, agent.request_stop)
    await agent.run()


def _cmd_agent(args: argparse.Namespace, settings: Settings) -> int:
    db = Database(settings.database_path)
    if not schema_ready(db):
        print("database schema missing: run `farm db upgrade` (or start `farm api`) first", file=sys.stderr)
        return 2
    asyncio.run(_run_agent(build_agent(settings, db=db, fake_devices=args.fake)))
    return 0


def _cmd_api(_args: argparse.Namespace, settings: Settings) -> int:
    import uvicorn

    from farm.api.app import create_app

    migrate.upgrade(settings.database_path)
    uvicorn.run(create_app(settings), host=settings.api_host, port=settings.api_port)
    return 0


HANDLERS = {"db": _cmd_db, "token": _cmd_token, "api": _cmd_api, "agent": _cmd_agent}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    return HANDLERS[args.cmd](args, Settings())


if __name__ == "__main__":
    sys.exit(main())
