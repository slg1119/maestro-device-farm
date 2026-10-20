import io
import zipfile

import pytest

from farm.workspaces.git import GitRepo, IndexOp, NoChanges, PushRejected, RefNotFound, SnapshotTooLarge
from tests.gitfixtures import make_origin

FILES = {".maestro/login.yaml": "appId: x\n---\n- launchApp\n", ".maestro/sub/helper.yaml": "- back\n",
         "README.md": "hello\n"}


@pytest.fixture
def origin(tmp_path):
    return make_origin(tmp_path / "remotes", "acme/flows", FILES)


@pytest.fixture
def repo(tmp_path, origin):
    return GitRepo(tmp_path / "cache" / "acme__flows.git", f"file://{origin.bare}")


def test_fetch_branch_creates_cache_and_returns_head(repo, origin):
    assert repo.fetch_branch("main") == origin.head()
    assert (repo.git_dir / "HEAD").exists()


def test_fetch_unknown_branch(repo):
    with pytest.raises(RefNotFound):
        repo.fetch_branch("nope")


def test_resolve_sha_fetches_missing_commit(repo, origin):
    repo.fetch_branch("main")
    new = origin.commit({".maestro/login.yaml": "changed\n"})
    assert not repo.has_commit(new)
    assert repo.resolve(new) == new
    assert repo.has_commit(new)
    with pytest.raises(RefNotFound):
        repo.resolve("f" * 40)


def test_tree_read_and_object_type(repo):
    sha = repo.fetch_branch("main")
    assert [(e.path, e.size) for e in repo.tree(sha, ".maestro")] == [("login.yaml", 25), ("sub/helper.yaml", 7)]
    assert [e.path for e in repo.tree(sha, ".maestro/login.yaml")] == ["login.yaml"]
    assert repo.tree(sha, "missing") == []
    assert {e.path for e in repo.tree(sha, "")} == set(FILES)
    assert repo.read_blob(sha, ".maestro/sub/helper.yaml") == b"- back\n"
    assert repo.read_blob(sha, ".maestro/none.yaml") is None
    assert (repo.object_type(sha, ".maestro"), repo.object_type(sha, "README.md")) == ("tree", "blob")


def test_archive_strips_prefix(repo, tmp_path):
    sha = repo.fetch_branch("main")
    dest = repo.archive_to(sha, ".maestro", tmp_path / "snap", max_bytes=10_000)
    assert sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()) == [
        "login.yaml", "sub/helper.yaml"]
    with pytest.raises(SnapshotTooLarge):
        repo.archive_to(sha, ".maestro", tmp_path / "small", max_bytes=10)
    names = zipfile.ZipFile(io.BytesIO(repo.archive_zip(sha, ".maestro"))).namelist()
    assert "login.yaml" in names and "sub/helper.yaml" in names


def test_build_commit_put_delete_and_log(repo, origin):
    head = repo.fetch_branch("main")
    ops = [IndexOp(".maestro/new flow.yaml", data=b"- launchApp\n"), IndexOp(".maestro/sub/helper.yaml"),
           IndexOp(".maestro/ghost.yaml")]
    sha = repo.build_commit(head, ops, "Add flow\n\nCo-authored-by: Kim <kim@example.com>",
                            author=("bot", "bot@example.com"))
    repo.push(sha, "main")
    assert origin.head() == sha
    assert {e.path for e in repo.tree(sha, ".maestro")} == {"login.yaml", "new flow.yaml"}
    assert repo.changed_paths(head, sha, [".maestro/login.yaml"]) == []
    assert repo.changed_paths(head, sha, [".maestro/sub/helper.yaml"]) == [".maestro/sub/helper.yaml"]
    assert sorted(repo.diff_status(head, sha, ".maestro")) == [(".maestro/new flow.yaml", "A"),
                                                                (".maestro/sub/helper.yaml", "D")]
    latest, first = repo.log(sha, ".maestro", limit=10)
    assert (latest.sha, latest.author_name, latest.files_changed) == (sha, "bot", 2)
    assert latest.co_authors == [{"name": "Kim", "email": "kim@example.com"}]
    assert latest.message.startswith("Add flow")
    assert (first.sha, first.files_changed) == (head, 2)
    assert [c.sha for c in repo.log(sha, ".maestro", limit=1, offset=1)] == [head]
    assert [c.sha for c in repo.log(sha, ".maestro/login.yaml", limit=10)] == [head]


def test_build_commit_without_tree_change(repo):
    head = repo.fetch_branch("main")
    with pytest.raises(NoChanges):
        repo.build_commit(head, [IndexOp(".maestro/ghost.yaml")], "noop", author=("bot", "bot@example.com"))


def test_build_commit_reuses_blob(repo):
    head = repo.fetch_branch("main")
    blob = repo.tree(head, "README.md")[0].blob
    sha = repo.build_commit(head, [IndexOp("copy.md", blob=blob)], "copy", author=("bot", "bot@example.com"))
    assert repo.read_blob(sha, "copy.md") == b"hello\n"


def test_push_rejections(repo, origin):
    head = repo.fetch_branch("main")
    stale = repo.build_commit(head, [IndexOp("a.txt", data=b"a")], "a", author=("bot", "bot@example.com"))
    origin.commit({"other.txt": "x"})
    with pytest.raises(PushRejected) as exc:
        repo.push(stale, "main")
    assert exc.value.kind == "non_fast_forward"
    head = repo.fetch_branch("main")
    fresh = repo.build_commit(head, [IndexOp("b.txt", data=b"b")], "b", author=("bot", "bot@example.com"))
    origin.protect()
    with pytest.raises(PushRejected) as exc:
        repo.push(fresh, "main")
    assert exc.value.kind == "protected"


def test_github_token_goes_only_into_env_and_is_redacted(tmp_path):
    repo = GitRepo(tmp_path / "x.git", "https://github.com/acme/flows.git", "github_pat_SECRET")
    env = repo._env()
    assert env["GIT_CONFIG_KEY_0"] == "http.https://github.com/.extraheader"
    assert env["GIT_CONFIG_VALUE_0"].startswith("AUTHORIZATION: basic ")
    assert "github_pat_SECRET" not in env["GIT_CONFIG_VALUE_0"]
    assert repo.redact(f"bad github_pat_SECRET {env['GIT_CONFIG_VALUE_0']}") == "bad *** AUTHORIZATION: basic ***"
    assert GitRepo(tmp_path / "y.git", "file:///tmp/r.git", "github_pat_SECRET")._env().get("GIT_CONFIG_COUNT") is None


def test_remote_url_is_kept_in_sync(repo, origin):
    repo.fetch_branch("main")
    moved = GitRepo(repo.git_dir, f"file://{origin.bare}/")
    moved.ensure()
    assert moved._out("remote", "get-url", "origin") == f"file://{origin.bare}/"
