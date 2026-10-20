import asyncio
import contextlib
import os
import signal
import subprocess
from dataclasses import dataclass
from pathlib import Path

from farm.runner.base import CancelToken


@dataclass
class ProcResult:
    returncode: int | None
    timed_out: bool = False
    cancelled: bool = False


@dataclass
class Captured:
    returncode: int | None
    stdout: bytes
    timed_out: bool = False

    @property
    def text(self) -> str:
        return self.stdout.decode("utf-8", "replace")


async def terminate_group(proc: asyncio.subprocess.Process, grace: float = 10.0) -> None:
    if proc.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), grace)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        await proc.wait()


async def run_process(argv: list[str], *, timeout: float, log_path: Path | None = None,
                      cancel: CancelToken | None = None, grace: float = 10.0) -> ProcResult:
    log = log_path.open("ab") if log_path else None
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdin=subprocess.DEVNULL, stdout=log or subprocess.DEVNULL,
            stderr=subprocess.STDOUT if log else subprocess.DEVNULL, start_new_session=True,
        )
    finally:
        if log:
            log.close()  # the child keeps its own copy of the descriptor
    waiter = asyncio.create_task(proc.wait())
    cancel_waiter = asyncio.create_task(cancel.wait()) if cancel else None
    try:
        pending = {waiter} | ({cancel_waiter} if cancel_waiter else set())
        done, _ = await asyncio.wait(pending, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if waiter in done:
            return ProcResult(proc.returncode)
        cancelled = cancel_waiter is not None and cancel_waiter in done
        await terminate_group(proc, grace)
        return ProcResult(proc.returncode, timed_out=not cancelled, cancelled=cancelled)
    finally:
        for task in (waiter, cancel_waiter):
            if task is not None and not task.done():
                task.cancel()


async def run_capture(argv: list[str], *, timeout: float = 30.0, merge_stderr: bool = True) -> Captured:
    proc = await asyncio.create_subprocess_exec(
        *argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT if merge_stderr else subprocess.DEVNULL, start_new_session=True,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        await terminate_group(proc, grace=2)
        return Captured(None, b"", timed_out=True)
    return Captured(proc.returncode, out)


async def start_background(argv: list[str], log_path: Path) -> asyncio.subprocess.Process:
    with log_path.open("ab") as log:
        return await asyncio.create_subprocess_exec(
            *argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
