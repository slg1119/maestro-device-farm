import asyncio
import socket
import threading
import time
from types import SimpleNamespace

import pytest
import uvicorn
from sqlalchemy import func, select

from farm.agent.main import Agent
from farm.api.app import create_app
from farm.auth import create_token
from farm.db.models import Device
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.runner.fake import FakeInspector, FakeRunner
from tests.fakes import FakeApkParser, FakeSyntaxChecker
from tests.gitfixtures import git_settings


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait(predicate, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise RuntimeError("timed out")
        time.sleep(0.05)


@pytest.fixture
def live_farm(settings, db):
    with db.session() as s:
        token = create_token(s, "e2e")
    port = _free_port()
    app = create_app(git_settings(settings, settings.data_dir.parent / "remotes"), db=db, apk_parser=FakeApkParser(),
                     syntax_checker=FakeSyntaxChecker())
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()
    _wait(lambda: server.started)

    runner = FakeRunner(delay=0.2)
    provider = FakeProvider([DeviceInfo(f"fake-{i}", "device", model="Fake Pixel", manufacturer="Fake",
                                        os_version="14", sdk_int=34, battery=100) for i in (1, 2)])
    agent = Agent(settings, db, provider, runner, FakeInspector(), agent_id="e2e-agent", poll_sec=0.2,
                  sweep_sec=1.0, heartbeat_sec=0.5, unhealthy_recheck_sec=1.0, worker_idle_sleep=0.05,
                  cancel_poll_sec=0.1)
    loop = asyncio.new_event_loop()
    agent_thread = threading.Thread(target=loop.run_until_complete, args=(agent.run(),), daemon=True)
    agent_thread.start()

    def two_devices_available() -> bool:
        with db.session() as s:
            return s.scalar(select(func.count()).select_from(Device).where(Device.state == "available")) == 2

    _wait(two_devices_available)
    yield SimpleNamespace(url=f"http://127.0.0.1:{port}", token=token, runner=runner,
                          remotes=settings.data_dir.parent / "remotes")
    loop.call_soon_threadsafe(agent.request_stop)
    agent_thread.join(10)
    loop.close()
    server.should_exit = True
    server_thread.join(10)
