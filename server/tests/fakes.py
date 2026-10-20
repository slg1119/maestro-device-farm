import json
from pathlib import Path

from farm.apps.apk import ApkInfo, ApkParseError


def fake_apk_bytes(package: str = "com.example.app", version_code: int = 1, min_sdk: int = 21,
                   version_name: str = "1.0") -> bytes:
    """A fake "APK": JSON that FakeApkParser understands. Different arguments give different sha256."""
    return json.dumps({"package_name": package, "version_name": version_name, "version_code": version_code,
                       "min_sdk": min_sdk, "label": "Example"}).encode()


class FakeApkParser:
    def parse(self, path: Path) -> ApkInfo:
        try:
            return ApkInfo(**json.loads(path.read_bytes()))
        except (ValueError, TypeError, UnicodeDecodeError) as exc:
            raise ApkParseError("not an APK") from exc
