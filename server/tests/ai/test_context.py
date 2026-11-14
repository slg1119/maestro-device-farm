import pytest

from farm.ai.context import materialize, workspace_context
from farm.workspaces.errors import WorkspaceError
from tests.gitfixtures import FLOW


def test_workspace_context_follows_relative_subflows_and_trims_unrelated(tmp_path):
    root = tmp_path / "snapshot"
    (root / "flows" / "sub").mkdir(parents=True)
    (root / "config.yaml").write_text("flows:\n  - flows/*.yaml\n")
    target = "appId: example\n---\n- runFlow: sub/login.yaml\n- runFlow:\n    file: sub/login.yaml\n"
    helper = "appId: example\n---\n- runFlow: ../shared.yaml\n- inputText: résumé\n"
    shared = "appId: example\n---\n- back\n- runFlow: sub/login.yaml\n"
    (root / "flows/main.yaml").write_text(target)
    (root / "flows/sub/login.yaml").write_text(helper)
    (root / "flows/shared.yaml").write_text(shared)
    for n in range(12):
        (root / f"unrelated-{n}.yaml").write_text("appId: " + "z" * 500 + "\n---\n- tapOn: OMIT_BODY\n")
    full = workspace_context(root, "flows/main.yaml")
    assert "OMIT_BODY" not in full
    assert "unrelated-0.yaml" in full
    trimmed = workspace_context(root, "flows/main.yaml", budget=1500)
    assert len(trimmed.encode()) <= 1500
    assert target in trimmed and helper in trimmed and shared in trimmed
    assert "omitted" in trimmed.lower()
    assert "flows:" in trimmed


def test_context_does_not_follow_external_reference_or_symlink(tmp_path):
    root = tmp_path / "snapshot"
    root.mkdir()
    (tmp_path / "outside.yaml").write_text("EXTERNAL_SECRET")
    (root / "linked.yaml").symlink_to(tmp_path / "outside.yaml")
    (root / "main.yaml").write_text("appId: example\n---\n- runFlow: ../outside.yaml\n- runFlow: linked.yaml\n")
    assert "EXTERNAL_SECRET" not in workspace_context(root, "main.yaml")


def test_materialize_uses_draft_without_changing_git(workspace, tmp_path):
    settings, ws, origin = workspace
    root = materialize(settings, ws, ws.head_sha, [
        {"op": "put", "path": "login.yaml", "content": FLOW + "- back\n"},
        {"op": "delete", "path": "search.yaml"},
    ], tmp_path / "snapshot")
    assert (root / "login.yaml").read_text() == FLOW + "- back\n"
    assert not (root / "search.yaml").exists()
    assert origin.show(ws.head_sha, ".maestro/login.yaml") == FLOW.strip()


@pytest.mark.parametrize("path", ["../escaped.yaml", ".git/config", "sub/.git/config"])
def test_materialize_rejects_unsafe_draft_paths(workspace, tmp_path, path):
    settings, ws, _ = workspace
    with pytest.raises(WorkspaceError):
        materialize(settings, ws, ws.head_sha, [{"op": "put", "path": path, "content": "unsafe"}],
                    tmp_path / "snapshot")
    assert not (tmp_path / "escaped.yaml").exists()


def test_required_context_over_budget_fails_explicitly(tmp_path):
    (tmp_path / "main.yaml").write_text("appId: example\n---\n- inputText: " + "a" * 2000)
    with pytest.raises(ValueError, match="exceed.*budget"):
        workspace_context(tmp_path, "main.yaml", budget=1000)


@pytest.mark.parametrize("unsafe", ["missing", "symlink", "inside_symlink", "outside", "invalid"])
def test_failure_hierarchy_skips_missing_or_unsafe_artifacts(workspace, db, failed_task, tmp_path, unsafe):
    import json
    from pathlib import Path

    from farm.ai.context import failure_context

    settings, _, _ = workspace
    root = Path(failed_task.artifacts_dir)
    flow = root / "maestro/session/login"
    folder = flow / "screen-hierarchy"
    folder.mkdir(parents=True)
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps({"attributes": {"text": "PRIVATE_OUTSIDE"}}))
    target = folder / "failed.json"
    ref = "screen-hierarchy/failed.json"
    if unsafe == "symlink":
        target.symlink_to(outside)
    elif unsafe == "inside_symlink":
        actual = folder / "actual.json"
        actual.write_text(outside.read_text())
        target.symlink_to(actual)
    elif unsafe == "outside":
        ref = str(outside)
    elif unsafe == "invalid":
        target.write_text("not JSON")
    (flow / "commands.json").write_text(json.dumps([{
        "command": {"tapOnElement": {"selector": {"textRegex": "continue"}}},
        "metadata": {"status": "FAILED", "artifacts": [{"type": "SCREEN_HIERARCHY", "path": ref}]},
    }]))
    context, _ = failure_context(settings, failed_task, db=db)
    assert "Screen hierarchy at failure" not in context and "PRIVATE_OUTSIDE" not in context


def test_failure_hierarchy_redacts_run_and_provider_secrets(workspace, db, failed_task):
    import json
    from pathlib import Path

    from pydantic import SecretStr

    from farm.ai.context import failure_context

    settings, _, _ = workspace
    settings.openai_api_key = SecretStr("private-provider-key")
    root = Path(failed_task.artifacts_dir)
    flow = root / "maestro/session/login"
    folder = flow / "screen-hierarchy"
    folder.mkdir(parents=True)
    (folder / "failed.json").write_text(json.dumps({"attributes": {
        "text": "private-run-password private-provider-key", "resource-id": "continue"}}))
    (flow / "commands.json").write_text(json.dumps([{
        "command": {"tapOnElement": {}}, "metadata": {"status": "FAILED", "artifacts": [
            {"type": "SCREEN_HIERARCHY", "path": "screen-hierarchy/failed.json"}]},
    }]))
    context, _ = failure_context(settings, failed_task, db=db)
    assert "## Screen hierarchy at failure (max 400 nodes)" in context and 'resource-id="continue"' in context
    assert "private-run-password" not in context and "private-provider-key" not in context
    assert "[REDACTED]" in context
