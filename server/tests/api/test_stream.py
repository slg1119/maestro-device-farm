import hashlib
import json
import queue
import socket
import threading
from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from starlette.websockets import WebSocketDisconnect
from websockets.sync.server import serve

from farm.db.migrate import alembic_config
from farm.db.models import Task
from farm.scheduler.payloads import task_payload
from farm.timeutil import now, shift
from tests.factories import add_app, add_device, submit, write_flows


@pytest.fixture
def device(db):
    with db.session() as s:
        return add_device(s)


def issue(client, serial="d1", **kwargs):
    response = client.post(f"/api/v1/devices/{serial}/stream-ticket", **kwargs)
    assert response.status_code == 201, response.text
    return response.json()


@contextmanager
def fake_agent(app):
    paths = queue.Queue()
    closed = threading.Event()
    binary = b"\x01\x00\x80\x00\x80\x00"
    status = json.dumps({"type": "status", "viewers": 1, "control": False})

    def handle(ws):
        paths.put(ws.request.path)
        try:
            ws.send(binary)
            ws.send(status)
            for message in ws:
                if message == "close-agent":
                    ws.close(1000)
                    return
                ws.send(message)
        finally:
            closed.set()

    with serve(handle, "127.0.0.1", 0) as server:
        app.state.settings = app.state.settings.model_copy(
            update={"agent_stream_port": server.socket.getsockname()[1]})
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            yield paths, closed, binary, status
        finally:
            server.shutdown()
            thread.join(timeout=5)
            assert not thread.is_alive()


def test_ticket_hash_expiry_author_and_writer(client, db, device):
    from farm.db.models import StreamTicket

    before = now()
    result = issue(client, json={"author_name": "Operator"}, headers={"X-Farm-User": "writer"})
    after = now()
    assert result["path"] == f'/api/v1/devices/d1/stream?ticket={result["ticket"]}'
    with db.session() as s:
        row = s.get(StreamTicket, hashlib.sha256(result["ticket"].encode()).hexdigest())
        assert row is not None
        assert row.ticket_hash != result["ticket"]
        assert row.actor == "writer" and row.author_name == "Operator"
        assert row.device_serial == "d1" and row.used_at is None
        assert before <= row.created_at <= after
        assert shift(before, 60) <= row.expires_at <= shift(after, 60)
        assert row.expires_at == result["expires_at"]


def test_ticket_requires_writer_and_existing_device(client, secured_client, device):
    assert secured_client.post("/api/v1/devices/d1/stream-ticket", json={}).status_code == 401
    response = client.post("/api/v1/devices/missing/stream-ticket", json={})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "device_not_found"


def test_proxy_passes_binary_text_and_author_and_closes_agent(client, app, db, device):
    from farm.db.models import StreamTicket

    ticket = issue(client, json={"author_name": "Zoë & Jamie"})
    with fake_agent(app) as (paths, closed, binary, status):
        with client.websocket_connect(ticket["path"]) as ws:
            assert ws.receive_bytes() == binary
            assert ws.receive_text() == status
            ws.send_bytes(b"\x02\x00\xff")
            assert ws.receive_bytes() == b"\x02\x00\xff"
            ws.send_text('{"type":"key","key":"HOME"}')
            assert ws.receive_text() == '{"type":"key","key":"HOME"}'
            path = urlsplit(paths.get(timeout=2))
            assert path.path == "/devices/d1/stream"
            assert parse_qs(path.query) == {"control": ["1"], "actor": ["Zoë & Jamie"]}
        assert closed.wait(2), "browser disconnect must close the agent socket"
    with db.session() as s:
        assert s.get(StreamTicket, hashlib.sha256(ticket["ticket"].encode()).hexdigest()).used_at


@pytest.mark.parametrize("kind", ["absent", "invalid", "used", "expired", "wrong_serial"])
def test_unusable_tickets_are_view_only(client, app, db, device, kind):
    from farm.db.models import StreamTicket

    ticket = None
    if kind in {"used", "expired", "wrong_serial"}:
        ticket = issue(client)["ticket"]
        with db.session() as s:
            row = s.get(StreamTicket, hashlib.sha256(ticket.encode()).hexdigest())
            if kind == "used":
                row.used_at = now()
            elif kind == "expired":
                row.expires_at = shift(now(), -1)
            else:
                row.device_serial = "another-device"
    elif kind == "invalid":
        ticket = "bad-ticket"
    path = "/api/v1/devices/d1/stream" + (f"?ticket={ticket}" if ticket else "")
    with fake_agent(app) as (paths, closed, binary, _status):
        with client.websocket_connect(path) as ws:
            messages = [ws.receive()]
            if messages[0].get("bytes") != binary:
                assert json.loads(messages[0]["text"])["control"] is False
                messages.append(ws.receive())
            assert messages[-1]["bytes"] == binary
            assert json.loads(ws.receive_text())["control"] is False
            assert parse_qs(urlsplit(paths.get(timeout=2)).query)["control"] == ["0"]
        assert closed.wait(2)
    if kind in {"expired", "wrong_serial"}:
        with db.session() as s:
            assert s.get(StreamTicket, hashlib.sha256(ticket.encode()).hexdigest()).used_at is None


def test_ticket_is_consumed_once_and_actor_falls_back_to_writer(client, app, device):
    ticket = issue(client, headers={"X-Farm-User": "writer"})
    with fake_agent(app) as (paths, _closed, _binary, _status):
        for expected in ["1", "0"]:
            with client.websocket_connect(ticket["path"]) as ws:
                # Wait for the upstream handler, regardless of any local invalid-ticket status.
                query = parse_qs(urlsplit(paths.get(timeout=2)).query)
                assert query["control"] == [expected]
                if expected == "1":
                    assert query["actor"] == ["writer"]
                ws.receive()


def test_agent_disconnect_closes_browser(client, app, device):
    with fake_agent(app) as (_paths, closed, binary, _status):
        with client.websocket_connect("/api/v1/devices/d1/stream") as ws:
            assert ws.receive_bytes() == binary
            ws.receive_text()
            ws.send_text("close-agent")
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_text()
            assert exc.value.code == 1000
        assert closed.wait(2)


def test_agent_unavailable_ends_and_closes_1011(client, app, device):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    app.state.settings = app.state.settings.model_copy(update={"agent_stream_port": port})
    with client.websocket_connect("/api/v1/devices/d1/stream") as ws:
        ended = ws.receive_json()
        assert ended["type"] == "ended" and ended["reason"] == "agent_unavailable"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == 1011


def test_interfered_in_run_detail_and_task_payload(client, db, tmp_path, device):
    with db.session() as s:
        run = submit(s, app=add_app(s), flows_dir=write_flows(tmp_path / "flows", {"a.yaml": "appId: app\n---\n- launchApp\n"}))
        task = s.scalar(select(Task).where(Task.run_id == run.id))
        assert task.interfered is False
        assert task_payload(task)["interfered"] is False
        task.interfered = True
        assert task_payload(task)["interfered"] is True
    response = client.get(f"/api/v1/runs/{run.id}")
    assert response.status_code == 200
    assert response.json()["tasks"][0]["interfered"] is True


def test_recording_partial_unique_index_and_defaults(db, device):
    from farm.db.models import Recording

    with db.session() as s:
        first = Recording(device_serial="d1", created_by="writer")
        s.add(first)
        s.flush()
        assert first.status == "active" and first.steps == []
        assert first.include_launch_app is True
        assert first.yaml is None and first.finished_at is None
    with pytest.raises(IntegrityError), db.session() as s:
        s.add(Recording(device_serial="d1", status="stopping", created_by="writer"))
        s.flush()
    with db.session() as s:
        s.get(Recording, first.id).status = "done"
    with db.session() as s:
        s.add(Recording(device_serial="d1", status="active", created_by="writer"))
        s.add(Recording(device_serial="d1", status="cancelled", created_by="writer"))


def test_migration_upgrade_downgrade_preserves_existing_tasks(tmp_path):
    path = tmp_path / "migration.db"
    cfg = alembic_config(path)
    command.upgrade(cfg, "0004")
    engine = create_engine(f"sqlite:///{path}")
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tasks (id,run_id,seq,pinned,flows,status,attempt,cancel_requested,created_at) "
                           "VALUES ('old','run',1,0,'[]','running',1,0,'then')"))
        command.upgrade(cfg, "0005")
        insp = inspect(engine)
        assert {"recordings", "stream_tickets"} <= set(insp.get_table_names())
        assert "uq_recordings_active_device" in {i["name"] for i in insp.get_indexes("recordings")}
        with engine.connect() as c:
            assert c.scalar(text("SELECT interfered FROM tasks WHERE id='old'")) == 0
        command.downgrade(cfg, "0004")
        insp = inspect(engine)
        assert not {"recordings", "stream_tickets"} & set(insp.get_table_names())
        assert "interfered" not in {c["name"] for c in insp.get_columns("tasks")}
        command.upgrade(cfg, "0005")
    finally:
        engine.dispose()
