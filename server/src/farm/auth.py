import hashlib
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.db.models import ApiToken
from farm.timeutil import now

TOKEN_PREFIX = "farm_"


class TokenExistsError(ValueError):
    pass


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_token(session: Session, name: str) -> str:
    if session.scalar(select(ApiToken).where(ApiToken.name == name)) is not None:
        raise TokenExistsError(name)
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    session.add(ApiToken(name=name, token_hash=hash_token(token)))
    return token


def verify_token(session: Session, token: str) -> ApiToken | None:
    row = session.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(token)))
    if row is not None:
        row.last_used_at = now()
    return row


def list_tokens(session: Session) -> list[ApiToken]:
    return list(session.scalars(select(ApiToken).order_by(ApiToken.name)))


def revoke_token(session: Session, name: str) -> bool:
    row = session.scalar(select(ApiToken).where(ApiToken.name == name))
    if row is None:
        return False
    session.delete(row)
    return True
