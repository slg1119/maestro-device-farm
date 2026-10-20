import pytest

from farm.workspaces.paths import (
    BRANCH_RE,
    NAME_RE,
    REPO_RE,
    InvalidPath,
    normalize_rel,
    repo_path,
    strip_root,
)


@pytest.mark.parametrize("raw", ["/etc/passwd", "../x.yaml", "a/../../x", "a\\b.yaml", "", "a//b", "a/", "./a",
                                 ".git/config"])
def test_normalize_rejects_unsafe_paths(raw):
    with pytest.raises(InvalidPath):
        normalize_rel(raw)


def test_normalize_accepts_nested_paths():
    assert normalize_rel(" flows/login.yaml ") == "flows/login.yaml"
    assert normalize_rel(".maestro", allow_empty=True) == ".maestro"
    assert normalize_rel("/.maestro/", allow_empty=True) == ".maestro"
    assert normalize_rel("", allow_empty=True) == ""


def test_repo_path_and_strip_root():
    assert repo_path(".maestro", "a.yaml") == ".maestro/a.yaml"
    assert repo_path("", "a.yaml") == "a.yaml"
    assert repo_path(".maestro", "") == ".maestro"
    assert strip_root(".maestro", ".maestro/sub/a.yaml") == "sub/a.yaml"
    assert strip_root("", "a.yaml") == "a.yaml"


def test_name_repo_branch_patterns():
    assert NAME_RE.match("example-app") and not NAME_RE.match("APP App") and not NAME_RE.match("-x")
    assert REPO_RE.match("example-org/example-app") and not REPO_RE.match("example-org") and not REPO_RE.match("a/b/c")
    assert BRANCH_RE.match("main") and BRANCH_RE.match("release/1.2")
    assert not any(BRANCH_RE.match(b) for b in ("-x", "a..b", "a b", "a/", "a.", "a//b"))
