from pathlib import Path

import pytest

from farm.devices.adb import Adb, AndroidAdbProvider, parse_devices
from farm.devices.provider import DeviceInfo


def test_parse_devices():
    text = ("List of devices attached\n* daemon started successfully\n"
            "R58N\tdevice usb:1 product:x model:SM_S911 transport_id:3\nEMU\tunauthorized transport_id:4\n\n")
    assert parse_devices(text) == [("R58N", "device"), ("EMU", "unauthorized")]


async def test_provider_lists_devices_and_caches_props(fakebin, monkeypatch):
    monkeypatch.setenv("FAKE_ADB_DEVICES", "A1:device,B2:unauthorized")
    provider = AndroidAdbProvider(Adb())
    assert await provider.list_devices() == [
        DeviceInfo("A1", "device", model="Pixel 7", manufacturer="Google", os_version="14", sdk_int=34, battery=80),
        DeviceInfo("B2", "unauthorized"),
    ]
    await provider.list_devices()
    calls = fakebin.calls("adb")
    assert len([c for c in calls if "getprop" in c]) == 4  # props are read once per connection
    assert len([c for c in calls if "battery" in c]) == 1  # battery refreshes every 60 s


async def test_prepare_turns_off_animations(fakebin):
    await AndroidAdbProvider(Adb()).prepare("A1")
    calls = fakebin.calls("adb")
    assert ["-s", "A1", "shell", "svc", "power", "stayon", "usb"] in calls
    for key in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
        assert ["-s", "A1", "shell", "settings", "put", "global", key, "0"] in calls


async def test_install_and_state(fakebin, monkeypatch):
    adb = Adb()
    ok, out = await adb.install("A1", Path("/tmp/app.apk"))
    assert ok and "Success" in out
    monkeypatch.setenv("FAKE_ADB_INSTALL", "fail")
    ok, out = await adb.install("A1", Path("/tmp/app.apk"))
    assert not ok and "INSUFFICIENT_STORAGE" in out
    assert await adb.get_state("A1") == "device"
    monkeypatch.setenv("FAKE_ADB_STATE", "offline")
    assert await adb.get_state("A1") == "offline"


async def test_battery_and_screencap(fakebin, monkeypatch):
    monkeypatch.setenv("FAKE_ADB_BATTERY", "15")
    adb = Adb()
    assert await adb.battery("A1") == 15
    assert (await adb.screencap_png("A1")).startswith(b"\x89PNG")


async def test_missing_adb_binary_raises():
    with pytest.raises(FileNotFoundError):
        await Adb("definitely-not-adb").devices()
