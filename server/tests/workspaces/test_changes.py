import base64

import pytest
from pydantic import ValidationError

from farm.workspaces.changes import Change, Issue, decode, touched_paths, validate_changes
from tests.fakes import FakeSyntaxChecker

GOOD = "appId: x\n---\n- launchApp\n"


def _validate(changes, checker=None, max_bytes=1024):
    return validate_changes([Change(**c) for c in changes], max_bytes=max_bytes, checker=checker)


def test_change_model_requires_fields_per_op():
    with pytest.raises(ValidationError):
        Change(op="put", path="a.yaml")
    with pytest.raises(ValidationError):
        Change(op="move", path="a.yaml")
    with pytest.raises(ValidationError):
        Change(op="put", path="a.yaml", content="x", extra=1)
    assert decode(Change(op="put", path="m.png", content=base64.b64encode(b"\x89PNG").decode(),
                         encoding="base64")) == b"\x89PNG"


def test_valid_changes_are_normalized_and_syntax_checked():
    checker = FakeSyntaxChecker()
    changes, issues = _validate([
        {"op": "put", "path": " flows/a.yaml", "content": GOOD},
        {"op": "put", "path": "config.yaml", "content": "flows:\n  - flows/*\n"},
        {"op": "put", "path": "scripts/x.js", "content": "output.x = 1"},
        {"op": "delete", "path": "old.yaml"},
        {"op": "move", "path": "b.yaml", "to": "flows/b.yaml"},
    ], checker)
    assert issues == []
    assert [c.path for c in changes] == ["flows/a.yaml", "config.yaml", "scripts/x.js", "old.yaml", "b.yaml"]
    assert checker.checked == [GOOD]  # config.yaml, JS and non-put changes skip check-syntax
    assert touched_paths(changes) == ["flows/a.yaml", "config.yaml", "scripts/x.js", "old.yaml", "b.yaml",
                                      "flows/b.yaml"]


def test_every_problem_is_reported():
    _, issues = _validate([
        {"op": "put", "path": "../evil.yaml", "content": GOOD},
        {"op": "put", "path": "broken.yaml", "content": "a: [1, 2\n"},
        {"op": "put", "path": "bad.yaml", "content": "appId: x\n---\n- notACommand: 1\n"},
        {"op": "put", "path": "big.png", "content": base64.b64encode(b"x" * 2048).decode(), "encoding": "base64"},
        {"op": "put", "path": "junk.png", "content": "%%%", "encoding": "base64"},
        {"op": "delete", "path": "bad.yaml"},
    ], FakeSyntaxChecker())
    by_path = {issue.path: issue for issue in issues}
    assert set(by_path) == {"../evil.yaml", "broken.yaml", "bad.yaml", "big.png", "junk.png"}
    assert by_path["broken.yaml"].line == 2 and by_path["broken.yaml"].message.startswith("YAML:")
    assert [i for i in issues if i.path == "bad.yaml"] == [
        Issue(path="bad.yaml", message="path appears in more than one change"),
        Issue(path="bad.yaml", message="Invalid Command: notACommand", line=3, column=3)]
    assert by_path["big.png"].message == "file is larger than 0 MB"


def test_checker_none_skips_syntax_but_not_yaml():
    _, issues = _validate([{"op": "put", "path": "bad.yaml", "content": "- notACommand: 1\n"},
                           {"op": "put", "path": "broken.yaml", "content": "a: [\n"}])
    assert [issue.path for issue in issues] == ["broken.yaml"]
