import pytest

from farm.flows.enumerate import FlowSelectionError, enumerate_flows, read_flow_tags


def _write(root, files: dict[str, str]):
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return root


def _flow(*tags: str) -> str:
    header = "appId: com.example.app\n" + (f"tags: [{', '.join(tags)}]\n" if tags else "")
    return header + "---\n- launchApp\n"


def test_read_flow_tags(tmp_path):
    _write(tmp_path, {"a.yaml": _flow("smoke", "login"), "b.yaml": "- launchApp\n", "c.yaml": ": : bad"})
    assert read_flow_tags(tmp_path / "a.yaml") == ["smoke", "login"]
    assert read_flow_tags(tmp_path / "b.yaml") == []
    assert read_flow_tags(tmp_path / "c.yaml") == []


def test_default_is_top_level_yaml_without_config(tmp_path):
    _write(tmp_path, {"b.yaml": _flow(), "a.yml": _flow(), "config.yaml": "flows: []\n", "sub/c.yaml": _flow(),
                      "notes.txt": "x"})
    assert enumerate_flows(tmp_path, [], []) == ["a.yml", "b.yaml"]


def test_config_flow_globs(tmp_path):
    _write(tmp_path, {"config.yaml": "flows:\n  - auth/*\n  - checkout.yaml\n", "auth/login.yaml": _flow(),
                      "auth/logout.yaml": _flow(), "checkout.yaml": _flow(), "other.yaml": _flow()})
    assert enumerate_flows(tmp_path, [], []) == ["auth/login.yaml", "auth/logout.yaml", "checkout.yaml"]


def test_tag_filters_use_any_match(tmp_path):
    _write(tmp_path, {"a.yaml": _flow("smoke"), "b.yaml": _flow("smoke", "slow"), "c.yaml": _flow("regression")})
    assert enumerate_flows(tmp_path, ["smoke"], []) == ["a.yaml", "b.yaml"]
    assert enumerate_flows(tmp_path, ["smoke", "regression"], ["slow"]) == ["a.yaml", "c.yaml"]


def test_config_tags_are_merged(tmp_path):
    _write(tmp_path, {"config.yaml": "excludeTags: [wip]\n", "a.yaml": _flow("smoke"), "b.yaml": _flow("wip")})
    assert enumerate_flows(tmp_path, [], []) == ["a.yaml"]


def test_flow_paths_pass_through_without_filtering(tmp_path):
    _write(tmp_path, {"a.yaml": _flow("wip"), "sub/b.yaml": _flow()})
    assert enumerate_flows(tmp_path, ["smoke"], [], flow_paths=["sub/b.yaml", "a.yaml"]) == ["sub/b.yaml", "a.yaml"]


@pytest.mark.parametrize("bad", ["missing.yaml", "../outside.yaml", "config.yaml"])
def test_flow_paths_must_be_flows_inside_root(tmp_path, bad):
    _write(tmp_path / "root", {"a.yaml": _flow(), "config.yaml": "{}\n"})
    (tmp_path / "outside.yaml").write_text(_flow())
    with pytest.raises(FlowSelectionError):
        enumerate_flows(tmp_path / "root", [], [], flow_paths=[bad])
