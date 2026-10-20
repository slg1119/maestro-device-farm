import asyncio
import os
import sys
import time

from farm.runner.base import CancelToken
from farm.runner.procs import run_capture, run_process, start_background, terminate_group

SPAWNS_CHILD = (
    "import subprocess, sys, time\n"
    "p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
    "open(sys.argv[1], 'w').write(str(p.pid))\n"
    "time.sleep(60)\n"
)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def _wait_dead(pid: int, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        await asyncio.sleep(0.05)
    return False


async def test_run_process_exit_code_and_log(tmp_path):
    log = tmp_path / "out.log"
    res = await run_process([sys.executable, "-c", "import sys; print('hi'); sys.exit(3)"], log_path=log, timeout=10)
    assert (res.returncode, res.timed_out, res.cancelled) == (3, False, False)
    assert "hi" in log.read_text()


async def test_timeout_kills_the_whole_process_group(tmp_path):
    pidfile = tmp_path / "child.pid"
    res = await run_process([sys.executable, "-c", SPAWNS_CHILD, str(pidfile)], timeout=1.0, grace=1.0)
    assert res.timed_out and not res.cancelled
    assert await _wait_dead(int(pidfile.read_text()))


async def test_cancel_terminates_with_reason():
    token = CancelToken()

    async def cancel_soon():
        await asyncio.sleep(0.3)
        token.cancel("user")

    asyncio.create_task(cancel_soon())
    res = await run_process([sys.executable, "-c", "import time; time.sleep(60)"], timeout=30, cancel=token, grace=1)
    assert res.cancelled and not res.timed_out
    assert token.reason == "user"


def test_cancel_token_keeps_first_reason():
    token = CancelToken()
    token.cancel("disconnected")
    token.cancel("user")
    assert token.is_cancelled and token.reason == "disconnected"


async def test_run_capture():
    out = await run_capture([sys.executable, "-c", "print('ok')"])
    assert out.returncode == 0 and out.text.strip() == "ok"


async def test_run_capture_timeout():
    out = await run_capture([sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.5)
    assert out.timed_out and out.returncode is None


async def test_background_process_can_be_terminated(tmp_path):
    log = tmp_path / "bg.log"
    proc = await start_background([sys.executable, "-u", "-c", "print('up'); import time; time.sleep(60)"], log)
    await asyncio.sleep(0.3)
    await terminate_group(proc, grace=1)
    assert proc.returncode is not None
    assert "up" in log.read_text()
