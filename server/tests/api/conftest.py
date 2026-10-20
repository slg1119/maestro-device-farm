import pytest
from fastapi.testclient import TestClient

from farm.api.app import create_app
from farm.auth import create_token
from tests.fakes import FakeApkParser, FakeSyntaxChecker
from tests.gitfixtures import git_settings


@pytest.fixture
def remotes(tmp_path):
    return tmp_path / "remotes"


@pytest.fixture
def app(settings, db, remotes):
    return create_app(git_settings(settings, remotes), db=db, apk_parser=FakeApkParser(),
                      syntax_checker=FakeSyntaxChecker())


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
