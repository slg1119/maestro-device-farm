from farm.db.models import AgentStatus, Device
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.devices.registry import (
    effective_state,
    heartbeat,
    last_heartbeat,
    mark_healthy,
    sync_devices,
    unhealthy_serials,
)
from farm.events import events_since
from farm.timeutil import shift
from tests.factories import add_device


def _info(serial, state="device", battery=80):
    return DeviceInfo(serial, state, model="Pixel 7", manufacturer="Google", os_version="14", sdk_int=34,
                      battery=battery)


def test_new_device_becomes_available(db):
    with db.session() as s:
        assert sync_devices(s, [_info("d1")]) == {"d1"}
    with db.session() as s:
        d = s.get(Device, "d1")
        assert (d.state, d.model, d.manufacturer, d.sdk_int, d.battery) == ("available", "Pixel 7", "Google", 34, 80)
        assert d.last_seen_at is not None
        assert ("device.updated", "available") in [(e.type, e.payload["state"]) for e in events_since(s, 0)]


def test_unauthorized_device_is_offline_with_reason(db):
    with db.session() as s:
        assert sync_devices(s, [_info("d1", state="unauthorized")]) == set()
    with db.session() as s:
        d = s.get(Device, "d1")
        assert (d.state, d.state_reason) == ("offline", "adb: unauthorized")


def test_disconnected_device_goes_offline(db):
    with db.session() as s:
        sync_devices(s, [_info("d1")])
    with db.session() as s:
        assert sync_devices(s, []) == set()
    with db.session() as s:
        d = s.get(Device, "d1")
        assert (d.state, d.state_reason) == ("offline", "disconnected")


def test_busy_and_unhealthy_states_are_kept(db):
    with db.session() as s:
        add_device(s, "d1", state="busy")
        add_device(s, "d2", state="unhealthy")
    with db.session() as s:
        sync_devices(s, [_info("d1"), _info("d2")])
    with db.session() as s:
        assert (s.get(Device, "d1").state, s.get(Device, "d2").state) == ("busy", "unhealthy")


def test_disabled_device_stays_disabled_until_reenabled(db):
    with db.session() as s:
        add_device(s, "d1", state="offline", disabled=True)
    with db.session() as s:
        sync_devices(s, [_info("d1")])
        assert s.get(Device, "d1").state == "disabled"
    with db.session() as s:
        sync_devices(s, [])
        assert s.get(Device, "d1").state == "disabled"
    with db.session() as s:
        s.get(Device, "d1").disabled = False
    with db.session() as s:
        sync_devices(s, [_info("d1")])
        assert s.get(Device, "d1").state == "available"


def test_reserved_device_returns_to_reserved(db):
    with db.session() as s:
        add_device(s, "d1", state="offline", reservation_id="res1")
    with db.session() as s:
        sync_devices(s, [_info("d1")])
        assert s.get(Device, "d1").state == "reserved"


def test_missing_battery_keeps_previous_value(db):
    with db.session() as s:
        sync_devices(s, [_info("d1", battery=55)])
    with db.session() as s:
        sync_devices(s, [_info("d1", battery=None)])
        assert s.get(Device, "d1").battery == 55


def test_mark_healthy_and_unhealthy_serials(db):
    with db.session() as s:
        add_device(s, "d1", state="unhealthy")
        add_device(s, "d2")
    with db.session() as s:
        assert unhealthy_serials(s) == ["d1"]
        assert mark_healthy(s, "d1") is True
        assert mark_healthy(s, "d2") is False
        assert s.get(Device, "d1").state == "available"


def test_heartbeat_and_effective_state(db):
    with db.session() as s:
        device = add_device(s, "d1")
        assert last_heartbeat(s) is None
        assert effective_state(device, None) == "offline"
        heartbeat(s, "host-a", "0.1.0", "2026-10-20T00:00:00.000000Z")
    with db.session() as s:
        hb = last_heartbeat(s)
        assert s.get(AgentStatus, "host-a").version == "0.1.0"
        device = s.get(Device, "d1")
        assert effective_state(device, hb) == "available"
        assert effective_state(device, hb, ref=shift(hb, 16)) == "offline"


async def test_fake_provider():
    provider = FakeProvider([_info("d1"), _info("d2")])
    provider.remove("d1")
    assert [i.serial for i in await provider.list_devices()] == ["d2"]
    await provider.prepare("d2")
    assert provider.prepared == ["d2"]
