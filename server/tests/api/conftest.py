import pytest
from fastapi.testclient import TestClient

from farm.api.app import create_app
from farm.auth import create_token
from tests.fakes import FakeApkParser


@pytest.fixture
def app(settings, db):
    return create_app(settings, db=db, apk_parser=FakeApkParser())


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def token(db) -> str:
    with db.session() as s:
        return create_token(s, "test")


@pytest.fixture
def auth(token) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
