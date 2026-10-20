import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from farm.api.deps import get_db
from farm.db.engine import Database
from farm.events import events_since, latest_event_id

router = APIRouter()
POLL_INTERVAL = 1.0
PING_EVERY = 15.0


def format_sse(event_id: int, event_type: str, data: dict) -> str:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event_id}\nevent: {event_type}\ndata: {body}\n\n"


def _fetch(db: Database, since: int, run_id: str | None) -> list[dict]:
    with db.session() as s:
        return [{"id": e.id, "type": e.type, "ts": e.ts, "run_id": e.run_id, "payload": e.payload}
                for e in events_since(s, since, run_id=run_id)]


def _latest(db: Database) -> int:
    with db.session() as s:
        return latest_event_id(s)


async def event_stream(db: Database, start_id: int, run_id: str | None,
                       is_disconnected: Callable[[], Awaitable[bool]], *, poll_interval: float = POLL_INTERVAL,
                       ping_every: float = PING_EVERY) -> AsyncIterator[str]:
    last = start_id
    idle = 0.0
    yield ": connected\n\n"
    while not await is_disconnected():
        rows = await asyncio.to_thread(_fetch, db, last, run_id)
        for row in rows:
            last = row["id"]
            yield format_sse(row["id"], row["type"], {"ts": row["ts"], "run_id": row["run_id"], "payload": row["payload"]})
        idle = 0.0 if rows else idle + poll_interval
        if idle >= ping_every:
            idle = 0.0
            yield ": ping\n\n"
        await asyncio.sleep(poll_interval)


@router.get("/events")
async def stream_events(request: Request, since: int | None = None, run_id: str | None = None) -> StreamingResponse:
    db = get_db(request)
    header = request.headers.get("last-event-id", "")
    if since is None and header.isdigit():
        since = int(header)
    if since is None:
        since = await asyncio.to_thread(_latest, db)
    return StreamingResponse(
        event_stream(db, since, run_id, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
