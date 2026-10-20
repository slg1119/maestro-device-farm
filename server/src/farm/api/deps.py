from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from farm.api.errors import ApiError
from farm.auth import verify_token
from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import ApiToken


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Database:
    return request.app.state.db


# Declared so Swagger UI (/docs) shows an Authorize button; we raise our own 401 body.
bearer_scheme = HTTPBearer(auto_error=False, description="farm API token (`farm token create <name>`)")


def require_token(request: Request,
                  credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> ApiToken:
    token = credentials.credentials.strip() if credentials else ""
    if not token:
        raise ApiError(401, "unauthorized", "missing bearer token")
    with get_db(request).session() as s:
        row = verify_token(s, token)
    if row is None:
        raise ApiError(401, "unauthorized", "invalid token")
    return row
