import json

from farm.api.routes.events import event_stream, format_sse
from farm.events import emit


def _disconnect_after(n: int):
    states = iter([False] * n + [True])

    async def is_disconnected() -> bool:
        return next(states)

    return is_disconnected


def test_format_sse():
    assert format_sse(3, "run.updated", {"a": "ü"}) == 'id: 3\nevent: run.updated\ndata: {"a":"ü"}\n\n'


async def test_stream_yields_events_in_order(db):
    with db.session() as s:
        emit(s, "run.updated", {"status": "queued"}, run_id="r1")
        emit(s, "device.updated", {"serial": "d1"})
        emit(s, "task.updated", {"status": "running"}, run_id="r1")
    chunks = [c async for c in event_stream(db, 0, None, _disconnect_after(1), poll_interval=0)]
    events = [c for c in chunks if c.startswith("id:")]
    assert [c.split("\n")[1] for c in events] == ["event: run.updated", "event: device.updated", "event: task.updated"]
    data = json.loads(events[0].split("data: ", 1)[1])
    assert data["run_id"] == "r1" and data["payload"] == {"status": "queued"}


async def test_stream_filters_by_run_and_resumes(db):
    with db.session() as s:
        emit(s, "run.updated", {}, run_id="r1")
        emit(s, "device.updated", {})
        emit(s, "task.updated", {}, run_id="r1")
    chunks = [c async for c in event_stream(db, 1, "r1", _disconnect_after(1), poll_interval=0)]
    assert [c.split("\n")[0] for c in chunks if c.startswith("id:")] == ["id: 3"]


async def test_stream_pings_when_idle(db):
    chunks = [c async for c in event_stream(db, 0, None, _disconnect_after(4), poll_interval=0.01, ping_every=0.02)]
    assert ": ping\n\n" in chunks
