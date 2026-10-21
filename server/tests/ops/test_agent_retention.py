import asyncio

import pytest

from farm.agent.main import Agent
from farm.devices.fake import FakeProvider
from farm.runner.fake import FakeRunner


async def test_retention_first_runs_after_60_seconds_then_daily_and_logs_failures(db, settings, monkeypatch, caplog):
    from farm.agent import main
    agent = Agent(settings, db, FakeProvider([]), FakeRunner())
    delays, calls = [], []

    async def sleep(seconds):
        delays.append(seconds)
        if len(delays) == 3:
            raise asyncio.CancelledError

    def retention(db_arg, settings_arg):
        calls.append((db_arg, settings_arg))
        raise RuntimeError("retention failed")

    monkeypatch.setattr(main.asyncio, "sleep", sleep)
    monkeypatch.setattr(main, "run_retention", retention)
    with pytest.raises(asyncio.CancelledError):
        await agent._retention_loop()
    assert delays == [60, 86400, 86400]
    assert calls == [(db, settings), (db, settings)]
    assert "retention" in caplog.text


async def test_agent_starts_and_cancels_retention_loop(db, settings, monkeypatch):
    agent = Agent(settings, db, FakeProvider([]), FakeRunner())
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def retention():
        entered.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    monkeypatch.setattr(agent, "_retention_loop", retention)
    task = asyncio.create_task(agent.run())
    try:
        await asyncio.wait_for(entered.wait(), 2)
    finally:
        agent.request_stop()
        await asyncio.wait_for(task, 2)
    assert cancelled.is_set()
