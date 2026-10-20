import argparse
import logging
import sys

from farm.config import Settings
from farm.db import migrate
from farm.auth import TokenExistsError, create_token, list_tokens, revoke_token
from farm.db.engine import Database


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


HANDLERS = {"db": _cmd_db, "token": _cmd_token}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    return HANDLERS[args.cmd](args, Settings())


if __name__ == "__main__":
    sys.exit(main())
