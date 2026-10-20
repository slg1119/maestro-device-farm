import time
from pathlib import Path

from farm.devices.provider import DeviceInfo
from farm.runner.procs import Captured, run_capture

ANIMATION_SETTINGS = ("window_animation_scale", "transition_animation_scale", "animator_duration_scale")


class AdbError(RuntimeError):
    pass


def parse_devices(text: str) -> list[tuple[str, str]]:
    devices = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("List of devices", "*")):
            continue
        parts = line.split()
        if len(parts) >= 2:
            devices.append((parts[0], parts[1]))
    return devices


class Adb:
    def __init__(self, binary: str = "adb") -> None:
        self.binary = binary

    def _argv(self, serial: str | None, *args: str) -> list[str]:
        return [self.binary, *(["-s", serial] if serial else []), *args]

    async def devices(self) -> list[tuple[str, str]]:
        out = await run_capture(self._argv(None, "devices", "-l"), timeout=15)
        if out.returncode != 0:
            raise AdbError(f"adb devices failed: {out.text.strip()}")
        return parse_devices(out.text)

    async def shell(self, serial: str, *args: str, timeout: float = 30.0) -> Captured:
        return await run_capture(self._argv(serial, "shell", *args), timeout=timeout)

    async def get_state(self, serial: str) -> str:
        out = await run_capture(self._argv(serial, "get-state"), timeout=10)
        text = out.text.strip()
        if out.returncode == 0 and text:
            return text.splitlines()[-1].strip()
        for state in ("unauthorized", "offline", "not found"):
            if state in text:
                return state.replace(" ", "_")
        return "unknown"

    async def getprop(self, serial: str, name: str) -> str:
        return (await self.shell(serial, "getprop", name, timeout=10)).text.strip()

    async def battery(self, serial: str) -> int | None:
        out = await self.shell(serial, "dumpsys", "battery", timeout=15)
        for line in out.text.splitlines():
            key, _, value = line.strip().partition(":")
            if key == "level" and value.strip().isdigit():
                return int(value.strip())
        return None

    async def install(self, serial: str, apk: Path) -> tuple[bool, str]:
        out = await run_capture(self._argv(serial, "install", "-r", "-d", "-g", str(apk)), timeout=300)
        return out.returncode == 0 and "Success" in out.text, out.text

    async def uninstall(self, serial: str, package: str) -> bool:
        out = await run_capture(self._argv(serial, "uninstall", package), timeout=120)
        return out.returncode == 0

    async def screencap_png(self, serial: str) -> bytes:
        out = await run_capture(self._argv(serial, "exec-out", "screencap", "-p"), timeout=30, merge_stderr=False)
        if out.returncode != 0 or not out.stdout.startswith(b"\x89PNG"):
            raise AdbError(f"screencap failed on {serial}")
        return out.stdout

    async def logcat_clear(self, serial: str) -> None:
        await run_capture(self._argv(serial, "logcat", "-c"), timeout=15)

    def logcat_argv(self, serial: str) -> list[str]:
        return self._argv(serial, "logcat", "-v", "threadtime")


class AndroidAdbProvider:
    def __init__(self, adb: Adb, battery_refresh_sec: float = 60.0) -> None:
        self.adb = adb
        self.battery_refresh_sec = battery_refresh_sec
        self._props: dict[str, tuple[str, str, str, int]] = {}
        self._battery: dict[str, tuple[float, int | None]] = {}

    async def list_devices(self) -> list[DeviceInfo]:
        infos = []
        for serial, state in await self.adb.devices():
            if state != "device":
                self._props.pop(serial, None)
                infos.append(DeviceInfo(serial, state))
                continue
            model, manufacturer, release, sdk = await self._props_for(serial)
            infos.append(DeviceInfo(serial, "device", model=model, manufacturer=manufacturer, os_version=release,
                                    sdk_int=sdk, battery=await self._battery_for(serial)))
        return infos

    async def prepare(self, serial: str) -> None:
        await self.adb.shell(serial, "svc", "power", "stayon", "usb")
        for key in ANIMATION_SETTINGS:
            await self.adb.shell(serial, "settings", "put", "global", key, "0")

    async def _props_for(self, serial: str) -> tuple[str, str, str, int]:
        if serial not in self._props:
            model = await self.adb.getprop(serial, "ro.product.model")
            manufacturer = await self.adb.getprop(serial, "ro.product.manufacturer")
            release = await self.adb.getprop(serial, "ro.build.version.release")
            sdk = await self.adb.getprop(serial, "ro.build.version.sdk")
            self._props[serial] = (model, manufacturer, release, int(sdk) if sdk.isdigit() else 0)
        return self._props[serial]

    async def _battery_for(self, serial: str) -> int | None:
        cached = self._battery.get(serial)
        now = time.monotonic()
        if cached is not None and now - cached[0] < self.battery_refresh_sec:
            return cached[1]
        level = await self.adb.battery(serial)
        self._battery[serial] = (now, level)
        return level
