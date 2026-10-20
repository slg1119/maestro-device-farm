import re

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
BRANCH_RE = re.compile(r"^(?!-)(?!.*\.\.)(?!.*//)[A-Za-z0-9._/-]+(?<![./])$")


class InvalidPath(ValueError):
    pass


def normalize_rel(raw: str, *, allow_empty: bool = False) -> str:
    """A clean POSIX path relative to a root: no absolute paths, '..', backslashes or empty segments."""
    text = raw.strip().strip("/") if allow_empty else raw.strip()
    if not text:
        if allow_empty:
            return ""
        raise InvalidPath("path is empty")
    parts = text.split("/")
    if "\\" in text or "\0" in text or any(part in ("", ".", "..") for part in parts) or parts[0] == ".git":
        raise InvalidPath(f"invalid path: {raw}")
    return text


def repo_path(root: str, rel: str) -> str:
    """Joins a workspace root (repo-relative, may be empty) with a workspace-relative path."""
    return f"{root}/{rel}" if root and rel else root or rel


def strip_root(root: str, path: str) -> str:
    return path[len(root) + 1:] if root and path.startswith(root + "/") else path
