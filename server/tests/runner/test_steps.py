import json

import pytest

from farm.runner.steps import parse_steps


def entry(command, *, seq=0, status="COMPLETED", depth=0, duration=12, evaluated=None, artifacts=None):
    metadata = {"sequenceNumber": seq, "status": status, "depth": depth, "duration": duration}
    if evaluated is not None:
        metadata["evaluatedCommand"] = evaluated
    if artifacts is not None:
        metadata["artifacts"] = artifacts
    return {"command": command, "metadata": metadata}


def write_commands(root, entries, flow="login"):
    path = root / "maestro" / "2026-10-20_191445" / flow / "commands.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries))
    return path


def test_real_shaped_commands_preserve_sequence_depth_and_artifacts(tmp_path):
    # Shapes verified against local real-device commands.json, including flow-relative artifacts.
    write_commands(tmp_path, [
        entry({"defineVariablesCommand": {"env": {}, "optional": False}}),
        entry({"applyConfigurationCommand": {"config": {"appId": "org.wikipedia"}}}, seq=1),
        entry({"launchAppCommand": {"appId": "${APP}"}}, seq=2, duration=779,
              evaluated={"launchAppCommand": {"appId": "org.wikipedia", "clearState": True}}),
        entry({"runFlowCommand": {"sourceDescription": "subflows/login.yaml", "commands": [{}]}}, seq=3),
        entry({"tapOnElement": {"selector": {"textRegex": "Non existent view", "optional": True},
                                "optional": True}}, seq=5, status="WARNED", depth=1, duration=7097,
              artifacts=[{"type": "SCREENSHOT", "path": "screenshots/step-006.png"},
                         {"type": "SCREEN_HIERARCHY", "path": "screen-hierarchy/step-006.json"}]),
        entry({"assertConditionCommand": {"condition": {"visible": {"idRegex": "login", "index": 2}}}},
              seq=6, status="FAILED", depth=1),
        entry({"inputTextCommand": {"text": "hello"}}, seq=7),
        entry({"runScriptCommand": {"sourceDescription": "scripts/setup.js"}}, seq=8),
    ])
    prefix = "maestro/2026-10-20_191445/login/"
    expected = [
        (2, "launchApp", "launchApp org.wikipedia (clearState)", "passed", 779, 0, None, None),
        (3, "runFlow", "runFlow subflows/login.yaml", "passed", 12, 0, None, None),
        (5, "tapOn", 'tapOn text="Non existent view" (optional)', "warned", 7097, 1,
         prefix + "screenshots/step-006.png", prefix + "screen-hierarchy/step-006.json"),
        (6, "assertVisible", 'assertVisible id="login" index=2', "failed", 12, 1, None, None),
        (7, "inputText", "inputText hello", "passed", 12, 0, None, None),
        (8, "runScript", "runScript scripts/setup.js", "passed", 12, 0, None, None),
    ]
    keys = ("seq", "command", "label", "status", "duration_ms", "depth", "screenshot", "hierarchy")
    assert parse_steps(tmp_path) == [{"flow": "login", "steps": [dict(zip(keys, row)) for row in expected]}]


@pytest.mark.parametrize(("command", "label"), [
    ({"assertConditionCommand": {"condition": {"notVisible": {"textRegex": "Gone"}}}},
     'assertNotVisible text="Gone"'),
    ({"runFlowCommand": {"commands": [{}, {}, {}]}}, "runFlow (3 steps)"),
    ({"tapOnElement": {"selector": {"point": "50%,50%"}}}, "tapOn point=50%,50%"),
    ({"scrollUntilVisible": {"selector": {"idRegex": "footer"}}}, 'scrollUntilVisible id="footer"'),
    ({"swipeCommand": {}}, "swipe"),
    ({"backPressCommand": {}}, "back"),
    ({"takeScreenshotCommand": {}}, "takeScreenshot"),
    ({"waitForAnimationToEndCommand": {}}, "waitForAnimationToEnd"),
])
def test_command_labels(tmp_path, command, label):
    write_commands(tmp_path, [entry(command)])
    step = parse_steps(tmp_path)[0]["steps"][0]
    assert step["label"] == label
    assert step["command"] == label.split(" ")[0]


@pytest.mark.parametrize(("status", "expected"), [
    ("COMPLETED", "passed"), ("WARNED", "warned"), ("FAILED", "failed"),
    ("SKIPPED", "skipped"), ("RUNNING", "running"), ("PENDING", "pending"), ("UNKNOWN", "unknown"),
])
def test_status_mapping(tmp_path, status, expected):
    write_commands(tmp_path, [entry({"backPressCommand": {}}, status=status)])
    assert parse_steps(tmp_path)[0]["steps"][0]["status"] == expected


def test_missing_and_unreadable_flows(tmp_path, caplog):
    assert parse_steps(tmp_path) == []
    write_commands(tmp_path, []).write_text("{broken")
    write_commands(tmp_path, [entry({"backPressCommand": {}})], flow="working")
    assert [flow["flow"] for flow in parse_steps(tmp_path)] == ["working"]
    assert "commands.json" in caplog.text


def test_artifact_paths_must_stay_inside_task_directory(tmp_path):
    inside = tmp_path / "maestro/2026-10-20_191445/login/screen.png"
    write_commands(tmp_path, [
        entry({"backPressCommand": {}}, artifacts=[{"type": "SCREENSHOT", "path": str(inside)}]),
        entry({"backPressCommand": {}}, seq=1, artifacts=[
            {"type": "SCREENSHOT", "path": str(tmp_path.parent / "outside.png")},
            {"type": "SCREEN_HIERARCHY", "path": "../../../../outside.json"},
        ]),
    ])
    steps = parse_steps(tmp_path)[0]["steps"]
    assert steps[0]["screenshot"] == "maestro/2026-10-20_191445/login/screen.png"
    assert steps[1]["screenshot"] is steps[1]["hierarchy"] is None
