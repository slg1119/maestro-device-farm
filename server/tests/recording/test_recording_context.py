from farm.ai.context import workspace_context


def test_new_flow_can_read_reusable_subflows_and_references_from_other_flows(tmp_path):
    (tmp_path / "subflows").mkdir()
    (tmp_path / "helpers").mkdir()
    (tmp_path / "subflows/launch-clearstate-android.yaml").write_text(
        "appId: com.example.app\n---\n- launchApp:\n    clearState: true\n")
    (tmp_path / "helpers/login.yaml").write_text("appId: com.example.app\n---\n- tapOn: LOGIN_BUTTON\n")
    (tmp_path / "other.yaml").write_text(
        "appId: com.example.app\n---\n- runFlow:\n    when:\n      platform: Android\n    file: helpers/login.yaml\n")
    context = workspace_context(tmp_path, "flows/new.yaml")
    assert "clearState: true" in context
    assert "- tapOn: LOGIN_BUTTON" in context
    assert "File: flows/new.yaml\n(new file)" in context
    limited = workspace_context(tmp_path, "flows/new.yaml", budget=100)
    assert len(limited.encode()) <= 100
    assert "clearState: true" not in limited
