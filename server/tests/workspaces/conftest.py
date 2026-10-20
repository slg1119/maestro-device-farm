import pytest

from farm.workspaces.registry import create_workspace
from tests.gitfixtures import SAMPLE_FILES, git_settings, make_origin


@pytest.fixture
def remotes(tmp_path):
    return tmp_path / "remotes"


@pytest.fixture
def gsettings(settings, remotes):
    return git_settings(settings, remotes)


@pytest.fixture
def origin(remotes):
    return make_origin(remotes, "acme/app", SAMPLE_FILES)


@pytest.fixture
def workspace(db, gsettings, origin):
    return create_workspace(db, gsettings, name="app", repo="acme/app", branch="main", path=".maestro")
