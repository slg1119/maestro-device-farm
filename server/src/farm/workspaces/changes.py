"""File changes sent by the editor and AI jobs, and their validation (spec §8.5 step 1)."""
import base64
import binascii
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, model_validator

from farm.flows.enumerate import CONFIG_NAMES, FLOW_SUFFIXES
from farm.flows.syntax import SyntaxChecker
from farm.workspaces.paths import InvalidPath, normalize_rel

MB = 1024 * 1024
SYNTAX_WORKERS = 4


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["put", "delete", "move"]
    path: str
    content: str | None = None
    encoding: Literal["utf-8", "base64"] = "utf-8"
    to: str | None = None

    @model_validator(mode="after")
    def _fields_match_op(self) -> "Change":
        if self.op == "put" and self.content is None:
            raise ValueError("put needs content")
        if self.op == "move" and not self.to:
            raise ValueError("move needs to")
        return self


class Issue(BaseModel):
    path: str
    message: str
    line: int | None = None
    column: int | None = None


def decode(change: Change) -> bytes:
    if change.encoding == "base64":
        return base64.b64decode(change.content or "", validate=True)
    return (change.content or "").encode("utf-8")


def touched_paths(changes: list[Change]) -> list[str]:
    """Workspace-relative paths a change set writes or removes (a move touches both ends)."""
    paths: list[str] = []
    for change in changes:
        paths.append(change.path)
        if change.op == "move" and change.to:
            paths.append(change.to)
    return paths


def _is_flow(path: str) -> bool:
    name = path.rsplit("/", 1)[-1]
    return any(name.endswith(suffix) for suffix in FLOW_SUFFIXES) and name not in CONFIG_NAMES


def _is_yaml(path: str) -> bool:
    return any(path.endswith(suffix) for suffix in FLOW_SUFFIXES)


def _yaml_issue(path: str, text: str) -> Issue | None:
    try:
        list(yaml.safe_load_all(text))
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        problem = getattr(exc, "problem", None) or str(exc)
        return Issue(path=path, message=f"YAML: {problem}", line=mark.line + 1 if mark else None,
                     column=mark.column + 1 if mark else None)
    return None


def normalize_changes(changes: list[Change]) -> tuple[list[Change], list[Issue]]:
    """Normalizes paths in place of the originals and reports unsafe or duplicated paths."""
    issues: list[Issue] = []
    seen: set[str] = set()
    normalized: list[Change] = []
    for change in changes:
        try:
            path = normalize_rel(change.path)
            to = normalize_rel(change.to) if change.op == "move" and change.to else None
        except InvalidPath as exc:
            issues.append(Issue(path=change.path, message=str(exc)))
            continue
        for p in filter(None, (path, to)):
            if p in seen:
                issues.append(Issue(path=p, message="path appears in more than one change"))
            seen.add(p)
        normalized.append(change.model_copy(update={"path": path, "to": to}))
    return normalized, issues


def validate_changes(changes: list[Change], *, max_bytes: int,
                     checker: SyntaxChecker | None) -> tuple[list[Change], list[Issue]]:
    """Returns the normalized changes and every problem found. `checker=None` skips `maestro check-syntax`."""
    normalized, issues = normalize_changes(changes)
    to_check: list[tuple[str, str]] = []
    for change in normalized:
        if change.op != "put":
            continue
        try:
            data = decode(change)
        except (binascii.Error, ValueError):
            issues.append(Issue(path=change.path, message="content is not valid base64"))
            continue
        if len(data) > max_bytes:
            issues.append(Issue(path=change.path, message=f"file is larger than {max_bytes // MB} MB"))
            continue
        if not _is_yaml(change.path):
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            issues.append(Issue(path=change.path, message="YAML files must be UTF-8"))
            continue
        problem = _yaml_issue(change.path, text)
        if problem:
            issues.append(problem)
        elif checker is not None and _is_flow(change.path):
            to_check.append((change.path, text))
    if to_check and checker is not None:
        with ThreadPoolExecutor(max_workers=SYNTAX_WORKERS) as pool:
            results = pool.map(lambda item: (item[0], checker.check(item[1])), to_check)
            for path, found in results:
                issues.extend(Issue(path=path, message=i.message, line=i.line, column=i.column) for i in found)
    return normalized, issues
