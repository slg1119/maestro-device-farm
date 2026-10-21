import asyncio
import json
from types import SimpleNamespace

from sqlalchemy import select

from farm.agent.main import Agent
from farm.db.models import Event, Recording, Task
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.runner.fake import FakeRunner
from farm.stream.manager import StreamManager
from tests.factories import add_app, flow_yaml, submit, write_flows
from tests.recording.test_recorder import FakeAdb
from tests.recording.test_steps import XML
from tests.stream.test_manager import Session


async def test_agent_wires_interference_recording_and_custom_hooks_and_stops(db, settings, tmp_path, monkeypatch):
    async def capture(*args, **kwargs):
        return SimpleNamespace(returncode=0, text=XML)

    monkeypatch.setattr("farm.stream.recorder.run_capture", capture)
    settings.agent_stream_port = 0
    seen = []
    manager = StreamManager(FakeAdb(), settings, db, session_factory=Session, status_interval=.02)
    agent = Agent(settings, db, FakeProvider([DeviceInfo("owned", "device", sdk_int=34)]), FakeRunner(),
                  stream_manager=manager, control_hooks=[seen.append], poll_sec=.02)
    loop = asyncio.create_task(agent.run())
    try:
        async with asyncio.timeout(3):
            while not agent.workers:
                await asyncio.sleep(.01)
        with db.session() as s:
            run = submit(s, app=add_app(s), flows_dir=write_flows(tmp_path / "flows", {"a.yaml": flow_yaml()}))
            task = s.scalar(select(Task).where(Task.run_id == run.id))
            task.status, task.device_serial = "running", "owned"
            recording = Recording(device_serial="owned")
            s.add(recording)
            s.flush()
            task_id, recording_id = task.id, recording.id
        viewer = await manager.subscribe("owned", control=True, actor="tester")
        async with asyncio.timeout(3):
            while not json.loads(await viewer.recv()).get("recording"):
                pass
        assert await manager.handle_control(viewer, {"type": "key", "key": "BACK"})
        with db.session() as s:
            assert s.get(Task, task_id).interfered
            assert s.get(Recording, recording_id).steps[0]["kind"] == "back"
            assert s.scalar(select(Event).where(Event.type == "device.control")).payload["actor"] == "tester"
        assert seen[0].message == {"type": "key", "key": "BACK"}
    finally:
        agent.request_stop()
        await asyncio.wait_for(loop, 3)
    assert not [t for t in asyncio.all_tasks() if t.get_name().startswith("recording-")]
    assert agent.workers == {} and agent.stream_server._server is None
