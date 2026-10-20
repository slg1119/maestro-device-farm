import json

import pytest

from farm.devices.adb import Adb
from farm.runner.inspect import AdbInspector, InspectError


async def test_inspect_writes_screenshot_and_hierarchy(fakebin, tmp_path):
    out = tmp_path / "inspect"
    await AdbInspector(Adb()).inspect("A1", out)
    assert (out / "screen.png").read_bytes().startswith(b"\x89PNG")
    assert json.loads((out / "hierarchy.json").read_text())["attributes"]["resource-id"] == "root"
    assert ["--device", "A1", "hierarchy"] in fakebin.calls("maestro")


async def test_inspect_rejects_non_json_hierarchy(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "badhierarchy")
    with pytest.raises(InspectError):
        await AdbInspector(Adb()).inspect("A1", tmp_path / "inspect")
