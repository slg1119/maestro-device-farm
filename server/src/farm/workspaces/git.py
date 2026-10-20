"""Bare-repository git plumbing for workspaces. Never touches a work tree."""
import base64
import io
import os
import re
import subprocess
import tarfile
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ZERO_SHA = "0" * 40
GITHUB_PREFIX = "https://github.com/"
CO_AUTHOR_RE = re.compile(r"^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$", re.IGNORECASE | re.MULTILINE)
_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


class GitError(Exception):
    pass


class RefNotFound(GitError):
    pass


class NoChanges(GitError):
    pass


class SnapshotTooLarge(GitError):
    pass


class PushRejected(GitError):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind  # "non_fast_forward" | "protected"


@dataclass(frozen=True)
class TreeEntry:
    path: str  # relative to the listed directory
    mode: str
    blob: str
    size: int


@dataclass(frozen=True)
class IndexOp:
    path: str  # repo-relative
    data: bytes | None = None  # new content to hash
    blob: str | None = None  # existing blob to reuse (restore)
    mode: str = "100644"

    @property
    def is_delete(self) -> bool:
        return self.data is None and self.blob is None


@dataclass(frozen=True)
class CommitInfo:
    sha: str
    author_name: str
    author_email: str
    authored_at: str
    message: str
    co_authors: list[dict[str, str]]
    files_changed: int


def repo_lock(git_dir: Path) -> threading.RLock:
    key = str(git_dir.resolve())
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


def subtree(sha: str, path: str) -> str:
    return f"{sha}:{path}" if path else sha


class GitRepo:
    def __init__(self, git_dir: Path, remote_url: str, token: str | None = None, *, timeout: float = 120) -> None:
        self.git_dir = git_dir
        self.remote_url = remote_url
        self.timeout = timeout
        self.lock = repo_lock(git_dir)
        self._secrets: list[str] = []
        self._auth_env: dict[str, str] = {}
        if token and remote_url.startswith(GITHUB_PREFIX):
            header = base64.b64encode(f"x-access-token:{token}".encode()).decode()
            self._auth_env = {
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": f"http.{GITHUB_PREFIX}.extraheader",
                "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {header}",
            }
            self._secrets = [token, header]

    def redact(self, text: str) -> str:
        for secret in self._secrets:
            text = text.replace(secret, "***")
        return text

    def _env(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        env.update({
            "GIT_DIR": str(self.git_dir), "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull, "LC_ALL": "C",
        })
        env.update(self._auth_env)
        env.update(extra or {})
        return env

    def _git(self, *args: str, input: bytes | None = None, env: dict[str, str] | None = None,
             check: bool = True) -> subprocess.CompletedProcess:
        try:
            proc = subprocess.run(["git", *args], input=input, capture_output=True, env=self._env(env),
                                  timeout=self.timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            raise GitError(f"git {args[0]} timed out after {self.timeout:.0f}s") from exc
        if check and proc.returncode != 0:
            stderr = self.redact(proc.stderr.decode(errors="replace").strip())
            raise GitError(f"git {args[0]} failed: {stderr[-1000:]}")
        return proc

    def _out(self, *args: str, **kwargs) -> str:
        return self._git(*args, **kwargs).stdout.decode().strip()

    def ensure(self) -> None:
        if not (self.git_dir / "HEAD").exists():
            self.git_dir.parent.mkdir(parents=True, exist_ok=True)
            env = self._env()
            del env["GIT_DIR"]
            subprocess.run(["git", "init", "--quiet", "--bare", str(self.git_dir)], check=True, capture_output=True,
                           env=env)
        proc = self._git("remote", "get-url", "origin", check=False)
        if proc.returncode != 0:
            self._git("remote", "add", "origin", self.remote_url)
        elif proc.stdout.decode().strip() != self.remote_url:
            self._git("remote", "set-url", "origin", self.remote_url)

    def fetch_branch(self, branch: str) -> str:
        """Fetches the branch and returns its head commit."""
        with self.lock:
            self.ensure()
            try:
                self._git("fetch", "--quiet", "--no-tags", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}")
            except GitError as exc:
                if "couldn't find remote ref" in str(exc):
                    raise RefNotFound(f"branch {branch} not found") from exc
                raise
            return self._out("rev-parse", f"refs/remotes/origin/{branch}^{{commit}}")

    def has_commit(self, sha: str) -> bool:
        if not (self.git_dir / "HEAD").exists():
            return False
        return self._git("cat-file", "-e", f"{sha}^{{commit}}", check=False).returncode == 0

    def fetch_commit(self, sha: str) -> None:
        with self.lock:
            if self.has_commit(sha):
                return
            self.ensure()
            try:
                self._git("fetch", "--quiet", "--no-tags", "origin", sha)
            except GitError as exc:
                raise RefNotFound(f"commit {sha} not found") from exc
            if not self.has_commit(sha):
                raise RefNotFound(f"commit {sha} not found")

    def resolve(self, ref: str) -> str:
        """A 40-hex SHA is fetched only when missing; anything else is a branch name that is fetched first."""
        if SHA_RE.match(ref):
            self.fetch_commit(ref)
            return ref
        return self.fetch_branch(ref)

    def object_type(self, sha: str, path: str) -> str | None:
        if not path:
            return "tree"
        proc = self._git("cat-file", "-t", f"{sha}:{path}", check=False)
        return proc.stdout.decode().strip() if proc.returncode == 0 else None

    def tree(self, sha: str, path: str) -> list[TreeEntry]:
        """Files under `path` at `sha` (paths relative to it). A file path lists just that file; a missing path is empty."""
        kind = self.object_type(sha, path)
        if kind is None:
            return []
        if kind == "blob":
            parent, _, name = path.rpartition("/")
            return [entry for entry in self.tree(sha, parent) if entry.path == name]
        entries = []
        out = self._git("ls-tree", "-r", "-l", "-z", subtree(sha, path)).stdout.decode()
        for record in filter(None, out.split("\0")):
            meta, rel = record.split("\t", 1)
            mode, kind, blob, size = meta.split()
            if kind == "blob":
                entries.append(TreeEntry(rel, mode, blob, int(size)))
        return entries

    def read_blob(self, sha: str, path: str) -> bytes | None:
        proc = self._git("cat-file", "blob", f"{sha}:{path}", check=False)
        return proc.stdout if proc.returncode == 0 else None

    def archive_to(self, sha: str, path: str, dest: Path, max_bytes: int) -> Path:
        """Extracts the directory `path` at `sha` into `dest` without the path prefix."""
        data = self._git("archive", "--format=tar", subtree(sha, path)).stdout
        with tarfile.open(fileobj=io.BytesIO(data)) as tar:
            members = tar.getmembers()
            if sum(member.size for member in members) > max_bytes:
                raise SnapshotTooLarge(f"the snapshot is larger than {max_bytes} bytes")
            dest.mkdir(parents=True, exist_ok=True)
            tar.extractall(dest, members=members, filter="data")
        return dest

    def archive_zip(self, sha: str, path: str) -> bytes:
        return self._git("archive", "--format=zip", subtree(sha, path)).stdout

    def log(self, sha: str, path: str, *, limit: int, offset: int = 0) -> list[CommitInfo]:
        args = ["log", f"--max-count={limit}", f"--skip={offset}", "--name-only",
                "--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1f", sha]
        if path:
            args += ["--", path]
        commits = []
        for chunk in self._git(*args).stdout.decode(errors="replace").split("\x1e")[1:]:
            sha_, name, email, when, body, files = chunk.split("\x1f", 5)
            commits.append(CommitInfo(
                sha=sha_, author_name=name, author_email=email, authored_at=when, message=body.strip(),
                co_authors=[{"name": n, "email": e} for n, e in CO_AUTHOR_RE.findall(body)],
                files_changed=len([line for line in files.splitlines() if line.strip()]),
            ))
        return commits

    def changed_paths(self, old: str, new: str, paths: list[str]) -> list[str]:
        if old == new or not paths:
            return []
        out = self._git("diff", "--name-only", "--no-renames", "-z", old, new, "--", *paths).stdout.decode()
        return [p for p in out.split("\0") if p]

    def diff_status(self, old: str, new: str, path: str) -> list[tuple[str, str]]:
        args = ["diff", "--name-status", "--no-renames", "-z", old, new]
        if path:
            args += ["--", path]
        fields = [f for f in self._git(*args).stdout.decode().split("\0") if f]
        return list(zip(fields[1::2], fields[0::2], strict=True))  # (path, status letter)

    def build_commit(self, parent: str, ops: list[IndexOp], message: str, *, author: tuple[str, str]) -> str:
        """Writes a commit on top of `parent` using a throwaway index. Raises NoChanges if the tree is unchanged."""
        with tempfile.TemporaryDirectory() as tmp:
            index_env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
            self._git("read-tree", parent, env=index_env)
            records = []
            for op in ops:
                if op.is_delete:
                    records.append(f"0 {ZERO_SHA}\t{op.path}")
                    continue
                blob = op.blob or self._out("hash-object", "-w", "--stdin", input=op.data)
                records.append(f"{op.mode} {blob}\t{op.path}")
            if records:
                self._git("update-index", "-z", "--index-info", input="".join(r + "\0" for r in records).encode(),
                          env=index_env)
            tree = self._out("write-tree", env=index_env)
        if tree == self._out("rev-parse", f"{parent}^{{tree}}"):
            raise NoChanges("the changes leave the tree unchanged")
        name, email = author
        identity = {"GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email,
                    "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email}
        return self._out("commit-tree", tree, "-p", parent, "-F", "-", input=message.encode(), env=identity)

    def push(self, sha: str, branch: str) -> None:
        proc = self._git("push", "origin", f"{sha}:refs/heads/{branch}", check=False)
        if proc.returncode == 0:
            return
        output = self.redact((proc.stdout + proc.stderr).decode(errors="replace"))
        if "GH006" in output or "pre-receive hook declined" in output or "protected branch" in output.lower():
            raise PushRejected("protected", output.strip()[-1000:])
        if "non-fast-forward" in output or "fetch first" in output:
            raise PushRejected("non_fast_forward", output.strip()[-1000:])
        raise GitError(f"git push failed: {output.strip()[-1000:]}")
