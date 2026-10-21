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
def secured_client(settings, db, remotes):
    """A farm-api started with FARM_REQUIRE_TOKEN=true, sharing the same database."""
    secured = git_settings(settings, remotes).model_copy(update={"require_token": True})
    return TestClient(create_app(secured, db=db, apk_parser=FakeApkParser(), syntax_checker=FakeSyntaxChecker()))


@pytest.fixture
def token(db) -> str:
    with db.session() as s:
        return create_token(s, "test")


@pytest.fixture
def auth(token) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
