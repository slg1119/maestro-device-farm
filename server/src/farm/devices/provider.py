from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class DeviceInfo:
    serial: str
    adb_state: str  # "device", "unauthorized", "offline", ...
    model: str = ""
    manufacturer: str = ""
    os_version: str = ""
    sdk_int: int = 0
    battery: int | None = None


class DeviceProvider(Protocol):
    async def list_devices(self) -> list[DeviceInfo]: ...

    async def prepare(self, serial: str) -> None: ...
