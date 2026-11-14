import asyncio
import logging
import os
import sys
import threading
from types import SimpleNamespace

import pytest

from farm.db.models import Event, Recording, Task
from farm.devices.adb import Adb
from farm.stream.events import ControlEvent
from farm.stream.recorder import Recorder
from farm.timeutil import now, shift
from tests.factories import add_app, add_device, submit, write_flows
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


@pytest.fixture
def maestro_adb(fakebin, monkeypatch, tmp_path):
    hierarchy = tmp_path / "hierarchy.xml"
    hierarchy.write_text(XML)
    monkeypatch.setenv("FAKE_ADB_HIERARCHY", str(hierarchy))
    (fakebin.state_dir / "maestro-alive").touch()
    return fakebin, hierarchy


@pytest.mark.parametrize("x,selector", [(20, {"id": "app:id/login"}), (60, {"text": "Settings"})])
async def test_leftover_maestro_release_retries_dump_and_records_selector(db, maestro_adb, caplog, x, selector):
    fakebin, _ = maestro_adb
    caplog.set_level(logging.INFO, logger="farm.stream.recorder")
    with db.session() as s:
        row = Recording(device_serial="owned")
        s.add(row)
        s.flush()
    recorder = Recorder(db, FakeStreams(), Adb(), lambda: {"owned"}, settle_sec=60)
    try:
        await recorder.poll_once()
        commands = [call[2:] for call in fakebin.calls("adb")]
        assert commands[:3] == [
            ["exec-out", "uiautomator", "dump", "/dev/tty"],
            ["shell", "am", "force-stop", "dev.mobile.maestro"],
            ["shell", "am", "force-stop", "dev.mobile.maestro.test"],
        ]
        assert commands[3][:3] == ["shell", "pkill", "-f"]
        assert "maestro" in commands[3][3]
        assert commands[4] == commands[0]
        ts = now()
        for action, time in [("down", ts), ("up", shift(ts, .1))]:
            await recorder.on_control(ControlEvent("owned", "tester",
                {"type": "touch", "action": action, "x": x, "y": 30}, (100, 200), time))
        with db.session() as s:
            assert s.get(Recording, row.id).steps == [{"kind": "tap", "selector": selector, "ts": shift(ts, .1)}]
        assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
        assert any(r.levelno == logging.INFO and "Maestro" in r.message for r in caplog.records)
        assert "Sign in" not in caplog.text and "<hierarchy" not in caplog.text
    finally:
        await recorder.stop()


async def test_running_task_prevents_driver_release_until_finished(db, maestro_adb, tmp_path, caplog):
    fakebin, _ = maestro_adb
    with db.session() as s:
        add_device(s, "owned")
        run = submit(s, app=add_app(s), flows_dir=write_flows(tmp_path / "flows",
                     {"test.yaml": "appId: com.example.app\n---\n- launchApp\n"}))
        task = s.query(Task).filter_by(run_id=run.id).one()
        task.device_serial, task.status = "owned", "running"
        row = Recording(device_serial="owned")
        s.add(row)
        s.flush()
    recorder = Recorder(db, FakeStreams(), Adb(), lambda: {"owned"}, settle_sec=60)
    try:
        await recorder.poll_once()
        active = recorder._active["owned"]
        await recorder._capture("owned", active)
        assert active.classifier.nodes == []
        assert all(call[2] == "exec-out" for call in fakebin.calls("adb"))
        assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
        ts = now()
        for action, time in [("down", ts), ("up", shift(ts, .1))]:
            await recorder.on_control(ControlEvent("owned", "tester",
                {"type": "touch", "action": action, "x": 20, "y": 30}, (100, 200), time))
        with db.session() as s:
            assert s.get(Recording, row.id).steps[0]["point"] == "20%,15%"
            s.get(Task, task.id).status = "passed"
        await recorder._capture("owned", active)
        assert active.classifier.nodes
        assert len([call for call in fakebin.calls("adb") if call[2:4] == ["shell", "am"]]) == 2
        assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
    finally:
        await recorder.stop()


@pytest.mark.parametrize("output,returncode", [
    ("Killed", 0), ("<hierarchy><node></hierarchy>", 0),
    ("<hierarchy-other></hierarchy-other></hierarchy>", 0), (XML, 1),
])
async def test_unusable_dump_falls_back_warns_once_and_releases_once_per_recording(
        db, monkeypatch, caplog, output, returncode):
    calls = []

    async def run(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=returncode if argv[3] == "exec-out" else 0, text=output)

    monkeypatch.setattr("farm.stream.recorder.run_capture", run)
    with db.session() as s:
        row = Recording(device_serial="owned")
        s.add(row)
        s.flush()
    recorder = Recorder(db, FakeStreams(), FakeAdb(), lambda: {"owned"})
    try:
        for _ in range(2):
            await recorder.poll_once()
            active = recorder._active["owned"]
            await recorder._capture("owned", active)
            assert active.classifier.nodes == []
            with db.session() as s:
                s.get(Recording, row.id).status = "cancelled"
            await recorder.poll_once()
            with db.session() as s:
                row = Recording(device_serial="owned")
                s.add(row)
                s.flush()
        assert len([call for call in calls if call[3:5] == ["shell", "am"]]) == 4
        assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 2
        assert "<hierarchy" not in caplog.text and "Sign in" not in caplog.text
    finally:
        await recorder.stop()


async def test_overlapping_captures_release_driver_only_once(db, capture, monkeypatch):
    with db.session() as s:
        s.add(Recording(device_serial="owned"))
    recorder = Recorder(db, FakeStreams(), FakeAdb(), lambda: {"owned"})
    try:
        await recorder.poll_once()
        active = recorder._active["owned"]
        calls = []

        async def run(argv, **kwargs):
            calls.append(argv)
            return SimpleNamespace(returncode=0, text="Killed")

        barrier = threading.Barrier(2, timeout=2)

        def running_task_id(serial):
            barrier.wait()

        monkeypatch.setattr("farm.stream.recorder.run_capture", run)
        monkeypatch.setattr(recorder, "_running_task_id", running_task_id)
        async with asyncio.timeout(3):
            await asyncio.gather(recorder._capture("owned", active), recorder._capture("owned", active))
        assert len([call for call in calls if call[3:5] == ["shell", "am"]]) == 2
        assert active.classifier.nodes == []
    finally:
        await recorder.stop()
