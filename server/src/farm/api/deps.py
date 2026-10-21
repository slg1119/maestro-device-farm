from dataclasses import dataclass
from urllib.parse import unquote

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from farm.api.errors import ApiError
from farm.auth import verify_token
from farm.config import Settings
from farm.db.engine import Database

ANONYMOUS = "anonymous"
USER_HEADER = "x-farm-user"


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Database:
    return request.app.state.db


@dataclass(frozen=True)
class Writer:
    """Who made a write request; recorded as created_by / uploaded_by."""

    name: str


# Declared so Swagger UI (/docs) shows an Authorize button; we raise our own 401 body.
bearer_scheme = HTTPBearer(auto_error=False, description="farm API token (only needed with FARM_REQUIRE_TOKEN=true)")


def get_writer(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> Writer:
    """A valid token names the writer. Without FARM_REQUIRE_TOKEN anyone may write, named by X-Farm-User."""
    required = get_settings(request).require_token
    token = credentials.credentials.strip() if credentials else ""
    if token:
        with get_db(request).session() as s:
            row = verify_token(s, token)
        if row is not None:
            return Writer(row.name)
        if required:
            raise ApiError(401, "unauthorized", "invalid token")
    elif required:
        raise ApiError(401, "unauthorized", "missing bearer token")
    # Percent-encoded by clients so non-ASCII names (e.g. Korean) survive HTTP headers.
    return Writer(unquote(request.headers.get(USER_HEADER, "")).strip()[:100] or ANONYMOUS)
