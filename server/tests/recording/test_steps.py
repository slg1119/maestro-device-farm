from farm.recording.steps import StepClassifier, append_step, parse_hierarchy
from farm.stream.events import ControlEvent
from farm.timeutil import shift

TS = "2026-10-21T00:00:00.000000Z"
XML = '''<?xml version="1.0"?><hierarchy><node bounds="[0,0][1000,2000]" clickable="false">
<node resource-id="app:id/container" clickable="true" bounds="[0,0][500,1000]">
  <node resource-id="app:id/login" text="로그인" content-desc="Sign in" clickable="true" bounds="[100,200][300,400]"/>
</node>
<node resource-id="duplicate" text="설정" clickable="true" bounds="[500,200][700,400]"/>
<node resource-id="duplicate" text="중복" clickable="true" bounds="[700,200][900,400]"/>
<node resource-id="duplicate" text="중복" clickable="true" bounds="[700,500][900,700]"/>
</node></hierarchy>UI hierarchy dumped to: /dev/tty'''


def event(message, seconds=0, actor="tester"):
    return ControlEvent("fake-1", actor, message, (100, 200), shift(TS, seconds))


def touch(classifier, start, end=None, duration=.1):
    classifier.feed(event({"type": "touch", "action": "down", "x": start[0], "y": start[1]}))
    end = end or start
    return classifier.feed(event({"type": "touch", "action": "up", "x": end[0], "y": end[1]}, duration))


def test_taps_choose_smallest_clickable_unique_id_then_text_then_point():
    classifier = StepClassifier(parse_hierarchy(XML))
    assert touch(classifier, (20, 30))["selector"] == {"id": "app:id/login"}
    assert touch(classifier, (60, 30))["selector"] == {"text": "설정"}
    assert touch(classifier, (80, 30))["point"] == "80%,15%"
    assert touch(classifier, (98, 190))["point"] == "98%,95%"
    assert parse_hierarchy(XML)[2]["content-desc"] == "Sign in"


def test_swipe_tracks_movement_and_long_press_and_ignores_other_actor_up():
    classifier = StepClassifier([])
    assert touch(classifier, (10, 20), (80, 160), .5) == {
        "kind": "swipe", "from": "10%,10%", "to": "80%,80%", "ts": shift(TS, .5)}
    assert touch(classifier, (10, 20), duration=.4)["kind"] == "swipe"
    classifier.feed(event({"type": "touch", "action": "down", "x": 10, "y": 20}))
    assert classifier.feed(event({"type": "touch", "action": "up", "x": 10, "y": 20}, .1, "other")) is None
    classifier.feed(event({"type": "touch", "action": "move", "x": 80, "y": 160}, .1))
    assert classifier.feed(event({"type": "touch", "action": "up", "x": 10, "y": 20}, .2))["kind"] == "swipe"


def test_consecutive_text_merges_and_keys_preserve_order():
    classifier, steps = StepClassifier([]), []
    for message in [{"type": "text", "text": "hello "}, {"type": "text", "text": "세계"},
                    {"type": "key", "key": "BACK"}, {"type": "text", "text": "next"},
                    {"type": "key", "key": "HOME"}]:
        steps = append_step(steps, classifier.feed(event(message)))
    assert steps == [{"kind": "input", "text": "hello 세계", "ts": TS}, {"kind": "back", "ts": TS},
                     {"kind": "input", "text": "next", "ts": TS}, {"kind": "key", "key": "HOME", "ts": TS}]
