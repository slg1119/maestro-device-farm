"""Local bare repositories that stand in for GitHub (file:// remotes)."""
import os
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

GIT_ENV = {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_AUTHOR_NAME": "Dev",
           "GIT_AUTHOR_EMAIL": "dev@example.com", "GIT_COMMITTER_NAME": "Dev", "GIT_COMMITTER_EMAIL": "dev@example.com"}


def git(*args: str, cwd: Path | None = None) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")} | GIT_ENV
    proc = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True)
    return proc.stdout.strip()


@dataclass
class Origin:
    """A bare repo at <remotes>/<owner>/<name>.git plus a work clone used to push "external" commits."""

    bare: Path
    work: Path
    branch: str

    def commit(self, files: Mapping[str, str | None], message: str = "external change") -> str:
        for rel, content in files.items():
            path = self.work / rel
            if content is None:
                path.unlink()
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
        git("add", "-A", cwd=self.work)
        git("commit", "-q", "-m", message, cwd=self.work)
        git("push", "-q", "origin", f"HEAD:{self.branch}", cwd=self.work)
        return self.head()

    def head(self) -> str:
        return git("--git-dir", str(self.bare), "rev-parse", f"refs/heads/{self.branch}")

    def show(self, sha: str, path: str) -> str:
        return git("--git-dir", str(self.bare), "show", f"{sha}:{path}")

    def protect(self) -> None:
        hook = self.bare / "hooks" / "pre-receive"
        hook.write_text("#!/bin/sh\necho 'GH006: Protected branch update failed for refs/heads/main.' >&2\nexit 1\n")
        hook.chmod(0o755)


def make_origin(remotes: Path, repo: str, files: dict[str, str], branch: str = "main") -> Origin:
    bare = remotes / f"{repo}.git"
    bare.parent.mkdir(parents=True, exist_ok=True)
    git("init", "-q", "--bare", "-b", branch, str(bare))
    work = remotes / "_work" / repo
    work.parent.mkdir(parents=True, exist_ok=True)
    git("clone", "-q", str(bare), str(work))
    git("checkout", "-q", "-b", branch, cwd=work)
    origin = Origin(bare, work, branch)
    origin.commit(files, "initial")
    return origin


FLOW = "appId: com.example.app\n---\n- launchApp\n"
SAMPLE_FILES = {".maestro/login.yaml": FLOW, ".maestro/search.yaml": FLOW, ".maestro/sub/helper.yaml": "- back\n",
                "README.md": "app repo\n"}


def git_settings(settings, remotes: Path):
    """Settings whose workspace remotes point at local bare repos under `remotes`."""
    return settings.model_copy(update={"git_remote_template": f"file://{remotes}/{{repo}}.git"})
