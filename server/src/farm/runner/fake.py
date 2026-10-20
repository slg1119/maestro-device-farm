import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

from farm.flows.enumerate import enumerate_flows
from farm.results import CaseResult, TaskOutcome
from farm.runner.base import CancelToken, PrecheckFailed, TaskSpec
from farm.runner.junit import merge_junit


@dataclass
class FakeRunner:
    """Runner without devices: waits `delay` seconds, then passes every flow unless told otherwise."""

    delay: float = 0.05
    fail_flows: set[str] = field(default_factory=set)
    errors: list[TaskOutcome] = field(default_factory=list)
    precheck_failures: dict[str, str] = field(default_factory=dict)
    runs: list[TaskSpec] = field(default_factory=list)

    async def precheck(self, serial: str) -> str | None:
        return self.precheck_failures.get(serial)

    async def run(self, spec: TaskSpec, cancel: CancelToken) -> TaskOutcome:
        self.runs.append(spec)
        reason = await self.precheck(spec.serial)
        if reason:
            raise PrecheckFailed(reason)
        try:
            await asyncio.wait_for(cancel.wait(), timeout=self.delay)
        except TimeoutError:
            pass
        if cancel.is_cancelled:
            if cancel.reason == "disconnected":
                return TaskOutcome("error", error_code="device_disconnected", error_message="device disconnected")
            return TaskOutcome("cancelled")
        if self.errors:
            return self.errors.pop(0)
        cases = [
            CaseResult(name, "failed", 10, "fake failure") if name in self.fail_flows else CaseResult(name, "passed", 10)
            for name in self._flow_names(spec)
        ]
        spec.artifacts_dir.mkdir(parents=True, exist_ok=True)
        (spec.artifacts_dir / "junit.xml").write_text(merge_junit([(spec.serial, cases)]), encoding="utf-8")
        (spec.artifacts_dir / "maestro.log").write_text(f"fake run on {spec.serial}\n", encoding="utf-8")
        failed = any(case.status == "failed" for case in cases)
        return TaskOutcome("failed" if failed else "passed", exit_code=1 if failed else 0, cases=cases)

    @staticmethod
    def _flow_names(spec: TaskSpec) -> list[str]:
        flows = spec.flows
        if not flows and spec.flows_dir.is_dir():
            flows = enumerate_flows(spec.flows_dir, spec.include_tags, spec.exclude_tags)
        return [Path(flow).stem for flow in flows] or ["all-flows"]


class FakeInspector:
    async def inspect(self, serial: str, out_dir: Path) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "screen.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
        hierarchy = {"attributes": {"resource-id": "root", "bounds": "[0,0][1080,2400]"}, "children": []}
        (out_dir / "hierarchy.json").write_text(json.dumps(hierarchy), encoding="utf-8")
