import asyncio
import time

import pytest
from sqlalchemy import func, select

from farm.agent.main import Agent
from farm.db.models import AgentStatus, Device, DeviceCommand, Reservation, Run, Task, TestResult
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.runner.fake import FakeInspector, FakeRunner
from farm.scheduler.claim import claim_next
from farm.scheduler.commands import create_inspect_command
from farm.scheduler.finish import cancel_run
from farm.scheduler.reservations import create_reservation
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


def _info(serial: str) -> DeviceInfo:
    return DeviceInfo(serial, "device", model="Pixel 7", manufacturer="Google", os_version="14", sdk_int=34,
                      battery=90)


@pytest.fixture
def flows(tmp_path):
    return write_flows(tmp_path / "flows", {"a.yaml": flow_yaml(), "b.yaml": flow_yaml(), "c.yaml": flow_yaml()})


@pytest.fixture
async def make_agent(settings, db):
    agents: list[Agent] = []

    def factory(provider, runner, inspector=None) -> Agent:
        agent = Agent(settings, db, provider, runner, inspector, agent_id="test-agent", poll_sec=0.05,
                      sweep_sec=0.2, heartbeat_sec=0.2, unhealthy_recheck_sec=0.2, worker_idle_sleep=0.02,
                      cancel_poll_sec=0.05)
        agents.append(agent)
        return agent

    yield factory
    for agent in agents:
        await agent.stop_workers()


async def wait_for(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if await asyncio.to_thread(predicate):
            return
        await asyncio.sleep(0.02)
    raise AssertionError("condition not met in time")


def _submit(db, flows, **kwargs) -> str:
    with db.session() as s:
        return submit(s, app=add_app(s), flows_dir=flows, **kwargs).id


def _run_status(db, run_id):
    with db.session() as s:
        return s.get(Run, run_id).status


def _device_state(db, serial):
    with db.session() as s:
        device = s.get(Device, serial)
        return device.state if device else None


def _running_serial(db, run_id):
    with db.session() as s:
        task = s.scalar(select(Task).where(Task.run_id == run_id, Task.status == "running"))
        return task.device_serial if task else None


async def test_agent_runs_split_run_to_completion(db, flows, make_agent):
    provider = FakeProvider([_info("d1"), _info("d2")])
    runner = FakeRunner()
    agent = make_agent(provider, runner)
    await agent.start()
    await agent.poll_devices_once()
    assert provider.prepared == ["d1", "d2"]
    run_id = _submit(db, flows)
    await wait_for(lambda: _run_status(db, run_id) == "passed")
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(TestResult).where(TestResult.run_id == run_id)) == 3
    assert {spec.serial for spec in runner.runs} <= {"d1", "d2"}
    assert runner.runs[0].first_run_on_device is True


async def test_disconnect_mid_run_retries_on_other_device(db, flows, make_agent):
    provider = FakeProvider([_info("d1"), _info("d2")])
    runner = FakeRunner(delay=30)
    agent = make_agent(provider, runner)
    await agent.start()
    await agent.poll_devices_once()
    run_id = _submit(db, flows, flow_paths=["a.yaml"])
    await wait_for(lambda: _running_serial(db, run_id) is not None)
    serial = _running_serial(db, run_id)
    runner.delay = 0.05
    provider.remove(serial)
    await agent.poll_devices_once()
    await wait_for(lambda: _run_status(db, run_id) == "passed")
    with db.session() as s:
        task = s.scalars(select(Task).where(Task.run_id == run_id)).one()
        assert task.attempt == 2 and task.device_serial != serial
        assert s.get(Device, serial).state == "offline"


async def test_restart_recovery_requeues_running_tasks(db, settings, flows, make_agent):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    with db.session() as s:
        claim_next(s, "d1", settings.data_dir)
    agent = make_agent(FakeProvider([_info("d1")]), FakeRunner())
    await agent.start()
    with db.session() as s:
        task = s.scalars(select(Task).where(Task.run_id == run.id)).one()
        assert (task.status, task.attempt, task.error_code) == ("queued", 2, "agent_restarted")
        assert s.get(Device, "d1").state == "offline"
    await agent.poll_devices_once()
    await wait_for(lambda: _run_status(db, run.id) == "passed")


async def test_user_cancel_stops_running_task(db, flows, make_agent):
    agent = make_agent(FakeProvider([_info("d1")]), FakeRunner(delay=30))
    await agent.start()
    await agent.poll_devices_once()
    run_id = _submit(db, flows, flow_paths=["a.yaml"])
    await wait_for(lambda: _running_serial(db, run_id) is not None)
    with db.session() as s:
        cancel_run(s, run_id)
    await wait_for(lambda: _run_status(db, run_id) == "cancelled")
    await wait_for(lambda: _device_state(db, "d1") == "available")


async def test_precheck_failure_then_recovery(db, flows, make_agent):
    runner = FakeRunner(precheck_failures={"d1": "battery 5% below 20%"})
    agent = make_agent(FakeProvider([_info("d1")]), runner)
    await agent.start()
    await agent.poll_devices_once()
    run_id = _submit(db, flows, flow_paths=["a.yaml"])
    await wait_for(lambda: _device_state(db, "d1") == "unhealthy")
    with db.session() as s:
        task = s.scalars(select(Task).where(Task.run_id == run_id)).one()
        assert (task.status, task.attempt) == ("queued", 1)
    runner.precheck_failures.clear()
    await agent.recheck_unhealthy_once()
    await wait_for(lambda: _run_status(db, run_id) == "passed")


async def test_worker_runs_inspect_command(db, settings, make_agent):
    agent = make_agent(FakeProvider([_info("d1")]), FakeRunner(), FakeInspector())
    await agent.start()
    await agent.poll_devices_once()
    with db.session() as s:
        reservation = create_reservation(s, "d1", "alice", 900)
        command_id = create_inspect_command(s, reservation.id).id

    def done():
        with db.session() as s:
            return s.get(DeviceCommand, command_id).status == "done"

    await wait_for(done)
    assert (settings.data_dir / "inspect" / command_id / "screen.png").is_file()


async def test_heartbeat_and_sweep(db, make_agent):
    agent = make_agent(FakeProvider([]), FakeRunner())
    await agent.start()
    with db.session() as s:
        assert s.get(AgentStatus, "test-agent") is not None
        add_device(s, "d1")
        reservation = create_reservation(s, "d1", "alice", 900)
        s.get(Reservation, reservation.id).expires_at = "2020-01-01T00:00:00.000000Z"
    await agent.sweep_once()
    with db.session() as s:
        assert s.get(Reservation, reservation.id).status == "expired"


async def test_run_loop_stops_cleanly(db, make_agent):
    agent = make_agent(FakeProvider([_info("d1")]), FakeRunner())
    loop_task = asyncio.create_task(agent.run())
    await wait_for(lambda: _device_state(db, "d1") == "available")
    agent.request_stop()
    await asyncio.wait_for(loop_task, 5)
    assert agent.workers == {}
