import yaml

from farm.flows.syntax import MaestroSyntaxChecker
from farm.recording.yaml import steps_to_yaml


def test_yaml_golden_and_fake_maestro_check_syntax(fakebin):
    steps = [{"kind": "launch"}, {"kind": "tap", "selector": {"id": "app:id/login"}},
             {"kind": "tap", "selector": {"text": "로그인: 확인"}}, {"kind": "tap", "point": "50%,25%"},
             {"kind": "swipe", "from": "50%,80%", "to": "50%,20%"},
             {"kind": "input", "text": 'yes: "ok"\n다음'}, {"kind": "back"},
             *({"kind": "key", "key": key} for key in ["HOME", "APP_SWITCH", "ENTER", "DEL",
                                                        "VOLUME_UP", "VOLUME_DOWN", "POWER"])]
    text = steps_to_yaml(steps, "com.example.app")
    assert text == '''appId: com.example.app
---
- launchApp
- tapOn:
    id: app:id/login
- tapOn:
    text: '로그인: 확인'
- tapOn:
    point: 50%,25%
- swipe:
    start: 50%,80%
    end: 50%,20%
- inputText: "yes: \\"ok\\"\\n다음"
- back
- pressKey: Home
- pressKey: Recent Apps
- pressKey: Enter
- pressKey: Backspace
- pressKey: Volume Up
- pressKey: Volume Down
- pressKey: Power
'''
    assert list(yaml.safe_load_all(text))[1][5] == {"inputText": 'yes: "ok"\n다음'}
    assert MaestroSyntaxChecker().check(text) == []
    assert fakebin.calls("maestro")[0][:1] == ["check-syntax"]


def test_unknown_package_uses_explicit_maestro_variable():
    assert steps_to_yaml([], None) == 'appId: ${APP_ID}\n---\n[]\n'
