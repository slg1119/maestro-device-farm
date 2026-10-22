from farm.db.models import DeviceCommand
from farm.scheduler.commands import finish_command
from tests.factories import add_device, beat


def test_healthz_reports_agent(client, db):
    body = client.get("/api/v1/healthz").json()
    assert body["status"] == "ok" and body["agent"] is None and body["disk_free_bytes"] > 0
    assert body["default_task_timeout_sec"] == 1800
    beat(db)
    agent = client.get("/api/v1/healthz").json()["agent"]
    assert agent["id"] == "test-host" and agent["age_sec"] < 5


def test_healthz_reports_configured_task_timeout(client, app, monkeypatch):
    monkeypatch.setattr(app.state.settings, "task_timeout_sec", 5400)
    assert client.get("/api/v1/healthz").json()["default_task_timeout_sec"] == 5400


def test_devices_look_offline_without_agent_heartbeat(client, db):
    with db.session() as s:
        add_device(s, "d1")
    assert client.get("/api/v1/devices").json()[0]["state"] == "offline"
    beat(db)
    device = client.get("/api/v1/devices").json()[0]
    assert (device["serial"], device["state"], device["model"], device["reservation"]) == ("d1", "available", "Pixel 7", None)


def test_writes_require_a_valid_token_when_enabled(secured_client, db, auth):
    with db.session() as s:
        add_device(s, "d1")
    res = secured_client.patch("/api/v1/devices/d1", json={"tags": ["x"]})
    assert res.status_code == 401 and res.json()["error"]["code"] == "unauthorized"
    res = secured_client.patch("/api/v1/devices/d1", json={"tags": ["x"]}, headers={"Authorization": "Bearer nope"})
    assert res.status_code == 401
    assert secured_client.patch("/api/v1/devices/d1", json={"tags": ["x"]}, headers=auth).status_code == 200
    assert secured_client.get("/api/v1/healthz").json()["auth_required"] is True


def test_writes_are_open_by_default(client, db):
    with db.session() as s:
        add_device(s, "d1")
    assert client.get("/api/v1/healthz").json()["auth_required"] is False
    assert client.patch("/api/v1/devices/d1", json={"tags": ["x"]}).json()["tags"] == ["x"]
    # A stale or unknown token is ignored rather than rejected while tokens are optional.
    res = client.patch("/api/v1/devices/d1", json={"tags": ["y"]}, headers={"Authorization": "Bearer nope"})
    assert res.json()["tags"] == ["y"]


def test_patch_tags_and_disable(client, db, auth):
    with db.session() as s:
        add_device(s, "d1")
    beat(db)
    body = client.patch("/api/v1/devices/d1", json={"tags": ["tablet", "smoke", "smoke"]}, headers=auth).json()
    assert body["tags"] == ["smoke", "tablet"]
    body = client.patch("/api/v1/devices/d1", json={"disabled": True}, headers=auth).json()
    assert (body["disabled"], body["state"]) == (True, "disabled")
    body = client.patch("/api/v1/devices/d1", json={"disabled": False}, headers=auth).json()
    assert (body["disabled"], body["state"]) == (False, "offline")
    assert client.patch("/api/v1/devices/nope", json={}, headers=auth).status_code == 404
    res = client.patch("/api/v1/devices/d1", json={"bogus": 1}, headers=auth)
    assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_request"


def test_reservation_endpoints(client, db, auth):
    with db.session() as s:
        add_device(s, "d1")
    beat(db)
    res = client.post("/api/v1/devices/d1/reservations", json={"holder_name": "alice"}, headers=auth)
    assert res.status_code == 201
    reservation = res.json()
    assert (reservation["device_serial"], reservation["status"]) == ("d1", "active")
    assert client.get("/api/v1/devices").json()[0]["reservation"]["holder_name"] == "alice"

    conflict = client.post("/api/v1/devices/d1/reservations", json={"holder_name": "bob"}, headers=auth)
    assert conflict.status_code == 409
    assert conflict.json()["error"] == {"code": "already_reserved", "message": conflict.json()["error"]["message"],
                                        "holder": "alice"}

    renewed = client.post(f"/api/v1/reservations/{reservation['id']}/renew", headers=auth).json()
    assert renewed["expires_at"] >= reservation["expires_at"]

    command = client.post(f"/api/v1/reservations/{reservation['id']}/inspect", headers=auth)
    assert command.status_code == 202
    command_id = command.json()["id"]
    assert client.get(f"/api/v1/device-commands/{command_id}").json()["status"] == "queued"

    released = client.delete(f"/api/v1/reservations/{reservation['id']}", headers=auth).json()
    assert released["status"] == "released"
    assert client.get("/api/v1/devices").json()[0]["state"] == "available"
    assert client.post("/api/v1/devices/nope/reservations", json={"holder_name": "a"}, headers=auth).status_code == 404


def test_command_files(client, db, settings, auth):
    with db.session() as s:
        add_device(s, "d1")
    reservation = client.post("/api/v1/devices/d1/reservations", json={"holder_name": "a"}, headers=auth).json()
    command_id = client.post(f"/api/v1/reservations/{reservation['id']}/inspect", headers=auth).json()["id"]
    out_dir = settings.path("inspect", command_id)
    out_dir.mkdir(parents=True)
    (out_dir / "screen.png").write_bytes(b"\x89PNGfake")
    (out_dir / "hierarchy.json").write_text("{}")
    with db.session() as s:
        s.get(DeviceCommand, command_id).status = "running"
        finish_command(s, command_id, ok=True, result_dir=str(out_dir))
    body = client.get(f"/api/v1/device-commands/{command_id}").json()
    assert body["status"] == "done"
    assert body["files"] == {
        "screen.png": f"/api/v1/device-commands/{command_id}/files/screen.png",
        "hierarchy.json": f"/api/v1/device-commands/{command_id}/files/hierarchy.json",
    }
    assert client.get(body["files"]["screen.png"]).content == b"\x89PNGfake"
    assert client.get(f"/api/v1/device-commands/{command_id}/files/other.txt").status_code == 404
