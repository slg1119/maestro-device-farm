import asyncio
from pathlib import Path

import pytest

from farm.results import TaskOutcome
from farm.runner.base import CancelToken, PrecheckFailed, TaskSpec
from farm.runner.fake import FakeInspector, FakeRunner
from farm.runner.junit import parse_junit
from tests.factories import flow_yaml, write_flows


def _spec(tmp_path, flows=("a.yaml",), serial="d1") -> TaskSpec:
    flows_dir = write_flows(tmp_path / "flows", {"a.yaml": flow_yaml(), "b.yaml": flow_yaml()})
    return TaskSpec(task_id="t1", run_id="r1", serial=serial, attempt=1, apk_path=Path("/tmp/app.apk"),
                    package_name="com.example.app", flows_dir=flows_dir, flows=list(flows), include_tags=[],
                    exclude_tags=[], env={}, timeout_sec=60, artifacts_dir=tmp_path / "art",
                    first_run_on_device=True)


async def test_passes_and_writes_junit(tmp_path):
    runner = FakeRunner()
    outcome = await runner.run(_spec(tmp_path), CancelToken())
    assert outcome.status == "passed" and [c.name for c in outcome.cases] == ["a"]
    assert [c.name for c in parse_junit(tmp_path / "art" / "junit.xml")] == ["a"]
    assert runner.runs[0].task_id == "t1"


async def test_all_flows_when_task_has_none(tmp_path):
    outcome = await FakeRunner().run(_spec(tmp_path, flows=()), CancelToken())
    assert [c.name for c in outcome.cases] == ["a", "b"]


async def test_fail_flows(tmp_path):
    outcome = await FakeRunner(fail_flows={"a"}).run(_spec(tmp_path), CancelToken())
    assert outcome.status == "failed" and outcome.cases[0].failure_message == "fake failure"


async def test_queued_errors_come_first(tmp_path):
    runner = FakeRunner(errors=[TaskOutcome("error", error_code="timeout")])
    assert (await runner.run(_spec(tmp_path), CancelToken())).error_code == "timeout"
    assert (await runner.run(_spec(tmp_path), CancelToken())).status == "passed"


@pytest.mark.parametrize(("reason", "status", "code"), [("disconnected", "error", "device_disconnected"),
                                                        ("user", "cancelled", None)])
async def test_cancellation(tmp_path, reason, status, code):
    token = CancelToken()
    runner = FakeRunner(delay=30)
    task = asyncio.create_task(runner.run(_spec(tmp_path), token))
    await asyncio.sleep(0.05)
    token.cancel(reason)
    outcome = await asyncio.wait_for(task, 2)
    assert (outcome.status, outcome.error_code) == (status, code)


async def test_precheck_failure_raises(tmp_path):
    runner = FakeRunner(precheck_failures={"d1": "battery low"})
    assert await runner.precheck("d1") == "battery low"
    with pytest.raises(PrecheckFailed):
        await runner.run(_spec(tmp_path), CancelToken())


async def test_fake_inspector(tmp_path):
    await FakeInspector().inspect("d1", tmp_path / "inspect")
    assert (tmp_path / "inspect" / "screen.png").read_bytes().startswith(b"\x89PNG")
    assert (tmp_path / "inspect" / "hierarchy.json").is_file()
