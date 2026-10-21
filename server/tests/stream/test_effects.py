import pytest
from sqlalchemy import select

from farm.db.models import Event, Task
from farm.stream.effects import record_control
from farm.stream.events import ControlEvent
from farm.timeutil import now
from tests.factories import add_app, add_device, submit, write_flows


def control(serial="d1", actor="operator"):
    return ControlEvent(serial, actor, {"type": "text", "text": "never log input"}, (720, 1280), now())


def test_marks_only_running_tasks_and_does_not_leak_control_payload(db, tmp_path):
    with db.session() as s:
        add_device(s)
        run = submit(s, app=add_app(s), flows_dir=write_flows(tmp_path / "flows", {"a.yaml": "appId: app\n---\n- launchApp\n"}))
        running = s.scalar(select(Task).where(Task.run_id == run.id))
        running.status, running.device_serial = "running", "d1"
        s.add(Task(id="queued", run_id=run.id, seq=2, status="queued", device_serial="d1"))
        s.add(Task(id="done", run_id=run.id, seq=3, status="passed", device_serial="d1"))
        s.add(Task(id="other", run_id=run.id, seq=4, status="running", device_serial="d2"))
    event = control()
    record_control(db, event)
    with db.session() as s:
        tasks = {t.id: t.interfered for t in s.scalars(select(Task))}
        assert tasks == {running.id: True, "queued": False, "done": False, "other": False}
        events = list(s.scalars(select(Event).where(Event.type == "device.control")))
        assert len(events) == 1
        assert events[0].payload == {"serial": "d1", "actor": "operator", "ts": event.ts}


def test_throttle_is_per_device_and_marks_new_task_even_when_throttled(db, tmp_path, monkeypatch):
    monkeypatch.setattr("farm.stream.effects.time.monotonic", lambda: 100.0)
    record_control(db, control())
    with db.session() as s:
        add_device(s)
        run = submit(s, app=add_app(s), flows_dir=write_flows(tmp_path / "flows", {"a.yaml": "appId: app\n---\n- launchApp\n"}))
        task = s.scalar(select(Task).where(Task.run_id == run.id))
        task.status, task.device_serial = "running", "d1"
    monkeypatch.setattr("farm.stream.effects.time.monotonic", lambda: 109.9)
    record_control(db, control())
    record_control(db, control("d2"))
    with db.session() as s:
        assert s.get(Task, task.id).interfered is True
        assert len(list(s.scalars(select(Event).where(Event.type == "device.control")))) == 2
    monkeypatch.setattr("farm.stream.effects.time.monotonic", lambda: 110.0)
    record_control(db, control())
    with db.session() as s:
        assert len(list(s.scalars(select(Event).where(Event.type == "device.control")))) == 3


def test_control_event_is_frozen():
    from dataclasses import FrozenInstanceError

    with pytest.raises(FrozenInstanceError):
        control().actor = "changed"
