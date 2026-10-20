import asyncio
import json
from pathlib import Path

from farm.devices.adb import Adb
from farm.runner.procs import run_capture


class InspectError(RuntimeError):
    pass


class AdbInspector:
    def __init__(self, adb: Adb, maestro: str = "maestro", timeout: float = 60.0) -> None:
        self.adb = adb
        self.maestro = maestro
        self.timeout = timeout

    async def inspect(self, serial: str, out_dir: Path) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        png = await asyncio.wait_for(self.adb.screencap_png(serial), self.timeout)
        (out_dir / "screen.png").write_bytes(png)
        result = await run_capture([self.maestro, "--device", serial, "hierarchy"], timeout=self.timeout,
                                   merge_stderr=False)
        if result.timed_out or result.returncode != 0:
            raise InspectError(f"maestro hierarchy failed on {serial}")
        text = result.text
        start = text.find("{")  # maestro may print status lines before the JSON document
        try:
            hierarchy = json.loads(text[start:]) if start >= 0 else None
        except json.JSONDecodeError:
            hierarchy = None
        if not isinstance(hierarchy, dict):
            raise InspectError("maestro hierarchy did not return a JSON object")
        (out_dir / "hierarchy.json").write_text(json.dumps(hierarchy), encoding="utf-8")
