import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from farm.results import TaskOutcome


class CancelToken:
    """Cancellation signal carrying why: "user", "disconnected" or "shutdown"."""

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self.reason: str | None = None

    def cancel(self, reason: str) -> None:
        if self.reason is None:
            self.reason = reason
        self._event.set()

    @property
    def is_cancelled(self) -> bool:
        return self._event.is_set()

    async def wait(self) -> None:
        await self._event.wait()


class PrecheckFailed(Exception):
    """The device cannot run tasks right now; the task is requeued and the device marked unhealthy."""


@dataclass(frozen=True)
class TaskSpec:
    task_id: str
    run_id: str
    serial: str
    attempt: int
    apk_path: Path
    package_name: str
    flows_dir: Path
    flows: list[str]
    include_tags: list[str]
    exclude_tags: list[str]
    env: dict[str, str]
    timeout_sec: int
    artifacts_dir: Path
    first_run_on_device: bool


class Runner(Protocol):
    async def precheck(self, serial: str) -> str | None: ...

    async def run(self, spec: TaskSpec, cancel: CancelToken) -> TaskOutcome: ...


class Inspector(Protocol):
    async def inspect(self, serial: str, out_dir: Path) -> None: ...
