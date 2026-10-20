from farm.devices.provider import DeviceInfo


class FakeProvider:
    """In-memory device list for tests and `farm agent --fake`."""

    def __init__(self, infos: list[DeviceInfo] | None = None) -> None:
        self.infos = list(infos or [])
        self.prepared: list[str] = []

    async def list_devices(self) -> list[DeviceInfo]:
        return list(self.infos)

    async def prepare(self, serial: str) -> None:
        self.prepared.append(serial)

    def remove(self, serial: str) -> None:
        self.infos = [info for info in self.infos if info.serial != serial]
