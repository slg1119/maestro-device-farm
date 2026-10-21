import pytest
from sqlalchemy import select

from farm.db.models import Device, Event, Recording, Workspace
from farm.devices.registry import heartbeat
from farm.timeutil import now


@pytest.fixture
def online(db):
    with db.session() as s:
        s.add(Device(serial="fake-1", state="available", last_seen_at=now()))
        s.add(Workspace(id="ws", name="example", repo="acme/app", branch="main", default_app_package="com.example.app"))
        heartbeat(s, "test-agent", "test", now())


def test_recording_lifecycle_without_agent_and_events(client, db, online):
    response = client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": True, "workspace": "example"})
    assert response.status_code == 201
    row = response.json()
    assert row["status"] == "active" and row["workspace_id"] == "ws"
    assert row["app_package"] == "com.example.app"
    assert row["steps"] == [{"kind": "launch", "ts": row["created_at"]}]
    assert client.get(f"/api/v1/recordings/{row['id']}").json() == row
    assert client.get("/api/v1/devices/fake-1/recordings?status=active").json() == [row]
    conflict = client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": False})
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "recording_active"
    stopped = client.post(f"/api/v1/recordings/{row['id']}/stop", json={"ai_polish": False})
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "done"
    assert stopped.json()["yaml"] == "appId: com.example.app\n---\n- launchApp\n"
    assert stopped.json()["finished_at"]
    assert client.post(f"/api/v1/recordings/{row['id']}/stop", json={"ai_polish": False}).json() == stopped.json()
    assert client.get("/api/v1/devices/fake-1/recordings?status=active").json() == []
    second = client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": False}).json()
    cancelled = client.delete(f"/api/v1/recordings/{second['id']}")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert client.delete(f"/api/v1/recordings/{second['id']}").json() == cancelled.json()
    assert client.post(f"/api/v1/recordings/{second['id']}/stop", json={"ai_polish": False}).status_code == 409
    with db.session() as s:
        events = list(s.scalars(select(Event).where(Event.type == "recording.updated").order_by(Event.id)))
    assert [(event.payload["status"], event.payload["steps"]) for event in events] == [
        ("active", 1), ("done", 1), ("active", 0), ("cancelled", 0)]


def test_recording_validates_device_workspace_and_explicit_package(client, db, online):
    assert client.post("/api/v1/devices/missing/recordings", json={"include_launch_app": False}).status_code == 404
    assert client.get("/api/v1/recordings/missing").status_code == 404
    with db.session() as s:
        s.get(Device, "fake-1").state = "offline"
    assert client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": False}).status_code == 409
    with db.session() as s:
        s.get(Device, "fake-1").state = "reserved"
    assert client.post("/api/v1/devices/fake-1/recordings", json={
        "include_launch_app": True, "workspace": "missing"}).status_code == 404
    response = client.post("/api/v1/devices/fake-1/recordings", json={
        "include_launch_app": True, "workspace": "example", "app_package": "com.explicit.app"})
    assert response.status_code == 201 and response.json()["app_package"] == "com.explicit.app"


def test_all_recording_mutations_require_writer(secured_client, db, online):
    with db.session() as s:
        row = Recording(device_serial="fake-1")
        s.add(row)
        s.flush()
    assert secured_client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": False}).status_code == 401
    assert secured_client.post(f"/api/v1/recordings/{row.id}/stop", json={"ai_polish": False}).status_code == 401
    assert secured_client.delete(f"/api/v1/recordings/{row.id}").status_code == 401


def test_ai_disabled_stop_does_not_finish_recording(client, db, online):
    row = client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": False, "workspace": "example"}).json()
    response = client.post(f"/api/v1/recordings/{row['id']}/stop", json={"ai_polish": True})
    assert response.status_code == 503 and response.json()["error"]["code"] == "ai_disabled"
    assert client.get(f"/api/v1/recordings/{row['id']}").json()["status"] == "active"
