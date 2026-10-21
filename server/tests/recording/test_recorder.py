import asyncio
import os
import sys
from types import SimpleNamespace

import pytest

from farm.db.models import Event, Recording
from farm.stream.events import ControlEvent
from farm.stream.recorder import Recorder
from farm.timeutil import now, shift
from tests.recording.test_steps import XML


class FakeStreams:
    def __init__(self):
        self.holds = set()

    async def hold(self, serial, reason):
        self.holds.add((serial, reason))

    async def release(self, serial, reason):
        self.holds.discard((serial, reason))


class FakeAdb:
    binary = "unused-test-adb"

    def _argv(self, serial, *args):
        return [self.binary, "-s", serial, *args]


@pytest.fixture
def capture(monkeypatch):
    calls = []

    async def run(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0, text=XML)

    monkeypatch.setattr("farm.stream.recorder.run_capture", run)
    return calls


@pytest.mark.asyncio
async def test_poll_capture_persist_merge_stop_and_release(db, capture):
    from sqlalchemy import select
    with db.session() as s:
        row = Recording(device_serial="owned", app_package="com.example.app")
        other = Recording(device_serial="elsewhere")
        s.add_all([row, other])
        s.flush()
    streams = FakeStreams()
    recorder = Recorder(db, streams, FakeAdb(), lambda: {"owned"}, settle_sec=.01)
    try:
        await recorder.poll_once()
        assert streams.holds == {("owned", f"recording:{row.id}")}
        assert capture == [["unused-test-adb", "-s", "owned", "exec-out", "uiautomator", "dump", "/dev/tty"]]
        ts = now()
        for message, time in [({"type": "touch", "action": "down", "x": 20, "y": 30}, ts),
                              ({"type": "touch", "action": "up", "x": 20, "y": 30}, shift(ts, .1)),
                              ({"type": "text", "text": "hel"}, shift(ts, .2)),
                              ({"type": "text", "text": "lo"}, shift(ts, .3))]:
            await recorder.on_control(ControlEvent("owned", "tester", message, (100, 200), time))
        with db.session() as s:
            saved = s.get(Recording, row.id)
            assert saved.steps == [{"kind": "tap", "selector": {"id": "app:id/login"}, "ts": shift(ts, .1)},
                                   {"kind": "input", "text": "hello", "ts": shift(ts, .2)}]
            assert s.get(Recording, other.id).steps == []
            events = list(s.scalars(select(Event).where(Event.type == "recording.updated")))
            assert [event.payload["steps"] for event in events] == [1, 2, 2]
        await asyncio.sleep(.03)
        assert len(capture) == 2  # one settled capture despite several consecutive inputs
        with db.session() as s:
            s.get(Recording, row.id).status = "stopping"
        await recorder.poll_once()
        with db.session() as s:
            saved = s.get(Recording, row.id)
            assert saved.status == "done" and "inputText: hello" in saved.yaml
        assert streams.holds == set()
        await recorder.on_control(ControlEvent("owned", "tester", {"type": "key", "key": "BACK"}, (100, 200), now()))
        with db.session() as s:
            assert len(s.get(Recording, row.id).steps) == 2
    finally:
        await recorder.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["done", "cancelled"])
async def test_terminal_rows_drop_late_input_and_release_and_shutdown_cleans_tasks(db, capture, status):
    with db.session() as s:
        row = Recording(device_serial="owned")
        s.add(row)
        s.flush()
    streams = FakeStreams()
    recorder = Recorder(db, streams, FakeAdb(), lambda: {"owned"}, settle_sec=60)
    try:
        await recorder.poll_once()
        await recorder.on_control(ControlEvent("owned", "tester", {"type": "key", "key": "BACK"}, (100, 200), now()))
        with db.session() as s:
            s.get(Recording, row.id).status = status
        await recorder.on_control(ControlEvent("owned", "tester", {"type": "text", "text": "late"}, (100, 200), now()))
        await recorder.poll_once()
        assert streams.holds == set()
        with db.session() as s:
            assert len(s.get(Recording, row.id).steps) == 1
    finally:
        await recorder.stop()
    assert not [t for t in asyncio.all_tasks() if t.get_name().startswith("recording-")]


@pytest.mark.asyncio
async def test_shutdown_during_hierarchy_capture_drains_adb_child(db, tmp_path):
    marker = tmp_path / "capture.pid"

    class HangingAdb:
        def _argv(self, *args):
            return [sys.executable, "-c", ("import os,sys,time; "
                    "open(sys.argv[1], 'w').write(str(os.getpid())); time.sleep(60)"), str(marker)]

    with db.session() as s:
        s.add(Recording(device_serial="owned"))
    streams = FakeStreams()
    recorder = Recorder(db, streams, HangingAdb(), lambda: {"owned"}, capture_timeout_sec=.2)
    poll = asyncio.create_task(recorder.poll_once())
    try:
        async with asyncio.timeout(2):
            while not marker.exists() or not marker.read_text():
                await asyncio.sleep(.005)
        child_pid = int(marker.read_text())
        poll.cancel()
        await asyncio.gather(poll, return_exceptions=True)
    finally:
        await recorder.stop()
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
    assert streams.holds == set()
    assert not [t for t in asyncio.all_tasks() if t.get_name().startswith("recording-")]
