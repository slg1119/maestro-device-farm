import pytest
from pydantic import ValidationError

from farm.workspaces.commit import Author, CommitRequest, RestoreRequest, commit_changes, restore
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.git import GitRepo
from farm.workspaces.registry import load_workspace, update_workspace
from tests.fakes import FakeSyntaxChecker
from tests.gitfixtures import FLOW, git

AUTHOR = {"name": "Kim Dev", "email": "kim@example.com"}


def _req(base, changes, message="Edit flows"):
    return CommitRequest(base_sha=base, message=message, author=Author(**AUTHOR), changes=changes)


def _commit(db, gsettings, base, changes, **kwargs):
    return commit_changes(db, gsettings, "app", _req(base, changes, **kwargs), FakeSyntaxChecker())


def test_commit_put_delete_move(db, gsettings, workspace, origin):
    result = _commit(db, gsettings, workspace.head_sha, [
        {"op": "put", "path": "login.yaml", "content": FLOW + "- back\n"},
        {"op": "put", "path": "media/logo.png", "content": "iVBORw0KGgo=", "encoding": "base64"},
        {"op": "delete", "path": "search.yaml"},
        {"op": "move", "path": "sub/helper.yaml", "to": "shared/helper.yaml"},
    ])
    assert result == {"sha": origin.head(), "parent": workspace.head_sha}
    files = git("--git-dir", str(origin.bare), "ls-tree", "-r", "--name-only", result["sha"]).splitlines()
    assert files == [".maestro/login.yaml", ".maestro/media/logo.png", ".maestro/shared/helper.yaml", "README.md"]
    assert origin.show(result["sha"], ".maestro/login.yaml").endswith("- back")
    body = git("--git-dir", str(origin.bare), "log", "-1", "--format=%an <%ae>%n%B", result["sha"])
    assert body.splitlines()[0] == "maestro-device-farm <maestro-device-farm@users.noreply.github.com>"
    assert "Edit flows\n\nCo-authored-by: Kim Dev <kim@example.com>" in body
    ws = load_workspace(db, "app")
    assert ws.head_sha == result["sha"] and ws.sync_error is None


def test_invalid_files_are_rejected_before_git(db, gsettings, workspace, origin):
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "bad.yaml", "content": "- notACommand: 1\n"}])
    assert (exc.value.status, exc.value.code) == (422, "invalid_flow")
    assert exc.value.extra["issues"][0]["path"] == "bad.yaml"
    assert origin.head() == workspace.head_sha


def test_conflict_on_same_file(db, gsettings, workspace, origin):
    remote = origin.commit({".maestro/login.yaml": "someone else\n"})
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "login.yaml", "content": FLOW}])
    assert (exc.value.status, exc.value.code) == (409, "conflict")
    assert exc.value.extra == {"paths": ["login.yaml"], "remote_head": remote}


def test_other_files_changed_builds_on_remote_head(db, gsettings, workspace, origin):
    remote = origin.commit({".maestro/search.yaml": FLOW + "- back\n"})
    result = _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "login.yaml", "content": FLOW + "#\n"}])
    assert result["parent"] == remote
    assert origin.show(result["sha"], ".maestro/search.yaml").endswith("- back")


def test_push_race_is_retried(db, gsettings, workspace, origin, monkeypatch):
    real_push = GitRepo.push
    calls = []

    def racing_push(self, sha, branch):
        calls.append(sha)
        if len(calls) == 1:
            origin.commit({"README.md": "raced\n"})
        return real_push(self, sha, branch)

    monkeypatch.setattr(GitRepo, "push", racing_push)
    result = _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "new.yaml", "content": FLOW}])
    assert len(calls) == 2 and result["sha"] == origin.head()
    assert origin.show(result["sha"], "README.md") == "raced"


def test_protected_branch(db, gsettings, workspace, origin):
    origin.protect()
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "new.yaml", "content": FLOW}])
    assert (exc.value.status, exc.value.code) == (403, "branch_protected")


@pytest.mark.parametrize(("changes", "code"), [
    ([{"op": "delete", "path": "ghost.yaml"}], "no_changes"),
    ([{"op": "move", "path": "ghost.yaml", "to": "x.yaml"}], "path_not_found"),
])
def test_commit_errors(db, gsettings, workspace, changes, code):
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, workspace.head_sha, changes)
    assert exc.value.code == code


def test_unknown_base(db, gsettings, workspace):
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, "e" * 40, [{"op": "put", "path": "a.yaml", "content": FLOW}])
    assert exc.value.code == "base_not_found"


def test_request_models_validate():
    with pytest.raises(ValidationError):
        _req("abc", [{"op": "delete", "path": "a"}])
    with pytest.raises(ValidationError):
        _req("a" * 40, [])
    with pytest.raises(ValidationError):
        Author(name="x", email="not-an-email")


def test_restore_whole_workspace_and_single_file(db, gsettings, workspace, origin):
    first = workspace.head_sha
    _commit(db, gsettings, first, [{"op": "put", "path": "login.yaml", "content": FLOW + "- back\n"},
                                   {"op": "put", "path": "added.yaml", "content": FLOW},
                                   {"op": "delete", "path": "search.yaml"}])
    one = restore(db, gsettings, "app", RestoreRequest(sha=first, paths=["login.yaml"], author=Author(**AUTHOR)))
    assert origin.show(one["sha"], ".maestro/login.yaml") == FLOW.strip()
    assert "added.yaml" in git("--git-dir", str(origin.bare), "ls-tree", "-r", "--name-only", one["sha"])
    message = git("--git-dir", str(origin.bare), "log", "-1", "--format=%B", one["sha"])
    assert message.startswith(f"Restore login.yaml to {first[:7]}")
    full = restore(db, gsettings, "app", RestoreRequest(sha=first, author=Author(**AUTHOR)))
    assert git("--git-dir", str(origin.bare), "diff", "--name-only", first, full["sha"]) == ""
    with pytest.raises(WorkspaceError) as exc:
        restore(db, gsettings, "app", RestoreRequest(sha=first, author=Author(**AUTHOR)))
    assert exc.value.code == "no_changes"


def test_pathspec_magic_names_are_literal(db, gsettings, workspace, origin):
    # A file literally named ":(exclude)*" must not be read as git pathspec magic in the conflict check.
    update_workspace(db, gsettings, "app", {"path": ""})  # root workspace: the repo path starts with ":"
    base = origin.commit({":(exclude)*": "base"})
    origin.commit({":(exclude)*": "remote edit"})
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, base, [{"op": "put", "path": ":(exclude)*", "content": "stale edit"}])
    assert (exc.value.code, exc.value.extra["paths"]) == ("conflict", [":(exclude)*"])


def test_file_where_a_directory_is_needed_conflicts(db, gsettings, workspace, origin):
    origin.commit({".maestro/sub/helper.yaml": None})
    (origin.work / ".maestro/sub").rmdir()
    remote = origin.commit({".maestro/sub": "IMPORTANT REMOTE CONTENT"})
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "sub/new.yaml", "content": FLOW}])
    assert (exc.value.status, exc.value.code) == (409, "conflict")
    assert exc.value.extra == {"paths": ["sub"], "remote_head": remote}
    assert origin.show(origin.head(), ".maestro/sub") == "IMPORTANT REMOTE CONTENT"


def test_directory_where_a_file_is_written_conflicts(db, gsettings, workspace):
    with pytest.raises(WorkspaceError) as exc:
        _commit(db, gsettings, workspace.head_sha, [{"op": "put", "path": "sub", "content": "x"}])
    assert (exc.value.code, exc.value.extra["paths"]) == ("conflict", ["sub"])


def test_move_into_yaml_is_validated(db, gsettings, workspace, origin):
    base = origin.commit({".maestro/invalid.txt": "invalid: [\n", ".maestro/notes.txt": "- notACommand: 1\n"})
    for source, target in (("invalid.txt", "invalid.yaml"), ("notes.txt", "notes.yaml")):
        with pytest.raises(WorkspaceError) as exc:
            _commit(db, gsettings, base, [{"op": "move", "path": source, "to": target}])
        assert (exc.value.status, exc.value.code) == (422, "invalid_flow")
        assert exc.value.extra["issues"][0]["path"] == target
    assert origin.head() == base
