import asyncio
import hashlib
import secrets
from typing import Annotated
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import update
from starlette.websockets import WebSocketState
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake

from farm.api.deps import Writer, get_db, get_writer
from farm.api.errors import ApiError
from farm.db.engine import Database
from farm.db.models import Device, StreamTicket
from farm.timeutil import now, shift

router = APIRouter(tags=["stream"])


class TicketRequest(BaseModel):
    author_name: str | None = Field(default=None, max_length=100)


class TicketOut(BaseModel):
    ticket: str
    expires_at: str
    path: str


@router.post("/devices/{serial}/stream-ticket", response_model=TicketOut, status_code=201)
def create_ticket(serial: str, db: Annotated[Database, Depends(get_db)],
                  writer: Annotated[Writer, Depends(get_writer)], body: TicketRequest | None = None) -> dict:
    ticket = secrets.token_urlsafe(32)
    created_at = now()
    expires_at = shift(created_at, 60)
    with db.session() as session:
        if session.get(Device, serial) is None:
            raise ApiError(404, "device_not_found", "Live-screen device not found.")
        session.add(StreamTicket(
            ticket_hash=hashlib.sha256(ticket.encode()).hexdigest(), device_serial=serial,
            actor=writer.name, author_name=(body.author_name or "").strip() if body else "",
            created_at=created_at, expires_at=expires_at,
        ))
    return {"ticket": ticket, "expires_at": expires_at,
            "path": f"/api/v1/devices/{quote(serial, safe='')}/stream?ticket={ticket}"}


def _consume_ticket(db: Database, serial: str, ticket: str | None) -> tuple[bool, str]:
    if not ticket:
        return False, ""
    # The guarded update consumes the ticket atomically, including concurrent handshakes.
    with db.session() as session:
        row = session.execute(update(StreamTicket).where(
            StreamTicket.ticket_hash == hashlib.sha256(ticket.encode()).hexdigest(),
            StreamTicket.device_serial == serial, StreamTicket.used_at.is_(None),
            StreamTicket.expires_at > now(),
        ).values(used_at=now()).returning(StreamTicket.author_name, StreamTicket.actor)).first()
        return (True, row.author_name or row.actor) if row else (False, "")


async def _browser_to_agent(browser: WebSocket, agent: ClientConnection) -> None:
    while True:
        message = await browser.receive()
        if message["type"] == "websocket.disconnect":
            return
        if message.get("bytes") is not None:
            await agent.send(message["bytes"])
        elif message.get("text") is not None:
            await agent.send(message["text"])


async def _agent_to_browser(agent: ClientConnection, browser: WebSocket) -> None:
    async for message in agent:
        if isinstance(message, bytes):
            await browser.send_bytes(message)
        else:
            await browser.send_text(message)


@router.websocket("/devices/{serial}/stream")
async def stream_device(browser: WebSocket, serial: str, ticket: str | None = None) -> None:
    control, actor = _consume_ticket(browser.app.state.db, serial, ticket)
    await browser.accept()
    if ticket and not control:
        await browser.send_json({"type": "status", "viewers": 0, "controller": None,
                                 "running_task_id": None, "recording": False, "control": False})
    settings = browser.app.state.settings
    query = urlencode({"control": int(control), "actor": actor})
    url = (f"ws://{settings.agent_stream_host}:{settings.agent_stream_port}"
           f"/devices/{quote(serial, safe='')}/stream?{query}")
    close_code = 1000
    try:
        # Disable proxy discovery for this localhost-only connection. Frames may exceed
        # websockets' default 1 MiB limit; the agent controls its own bounded queues.
        async with connect(url, open_timeout=3, max_size=None, proxy=None) as agent:
            pipes = [asyncio.create_task(_browser_to_agent(browser, agent)),
                     asyncio.create_task(_agent_to_browser(agent, browser))]
            try:
                done, _ = await asyncio.wait(pipes, return_when=asyncio.FIRST_COMPLETED)
                for pipe in done:
                    pipe.result()
                close_code = agent.close_code or 1000
            finally:
                for pipe in pipes:
                    pipe.cancel()
                await asyncio.gather(*pipes, return_exceptions=True)
    except (OSError, TimeoutError, InvalidHandshake):
        await browser.send_json({"type": "ended", "reason": "agent_unavailable",
                                 "message": "Cannot connect to the agent live screen."})
        close_code = 1011
    except ConnectionClosed as exc:
        close_code = exc.rcvd.code if exc.rcvd else 1011
    except WebSocketDisconnect:
        return
    finally:
        if (browser.client_state != WebSocketState.DISCONNECTED
                and browser.application_state != WebSocketState.DISCONNECTED):
            await browser.close(code=close_code)
