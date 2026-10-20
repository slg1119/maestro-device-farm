import argparse
import logging
import sys

from farm.config import Settings
from farm.db import migrate


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="farm", description="maestro-device-farm operations")
    sub = parser.add_subparsers(dest="cmd", required=True)

    db = sub.add_parser("db", help="database schema")
    db_sub = db.add_subparsers(dest="db_cmd", required=True)
    db_sub.add_parser("upgrade", help="apply migrations")
    revision = db_sub.add_parser("revision", help="autogenerate a migration (developers)")
    revision.add_argument("-m", "--message", required=True)
    revision.add_argument("--rev-id")
    return parser


def _cmd_db(args: argparse.Namespace, settings: Settings) -> int:
    if args.db_cmd == "upgrade":
        migrate.upgrade(settings.database_path)
        print(f"database ready: {settings.database_path}")
        return 0
    migrate.autogenerate(args.message, rev_id=args.rev_id)
    return 0


HANDLERS = {"db": _cmd_db}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    return HANDLERS[args.cmd](args, Settings())


if __name__ == "__main__":
    sys.exit(main())
