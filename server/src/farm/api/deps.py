from fastapi import Request

from farm.api.errors import ApiError
from farm.auth import verify_token
from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import ApiToken


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Database:
    return request.app.state.db


def require_token(request: Request) -> ApiToken:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "unauthorized", "missing bearer token")
    with get_db(request).session() as s:
        row = verify_token(s, token.strip())
    if row is None:
        raise ApiError(401, "unauthorized", "invalid token")
    return row
