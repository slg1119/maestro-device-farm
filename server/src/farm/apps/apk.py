from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class ApkInfo:
    package_name: str
    version_name: str
    version_code: int
    min_sdk: int
    label: str


class ApkParseError(ValueError):
    pass


class ApkParser(Protocol):
    def parse(self, path: Path) -> ApkInfo: ...


class AndroguardApkParser:
    def parse(self, path: Path) -> ApkInfo:
        try:
            from loguru import logger

            logger.disable("androguard")  # androguard logs every manifest detail at DEBUG
        except ImportError:
            pass
        from androguard.core.apk import APK

        try:
            apk = APK(str(path))
        except Exception as exc:  # androguard raises assorted zip/XML errors for non-APK input
            raise ApkParseError(f"not an APK: {exc}") from exc
        if not apk.is_valid_APK() or not apk.get_package():
            raise ApkParseError("not an APK")
        return ApkInfo(
            package_name=apk.get_package(),
            version_name=apk.get_androidversion_name() or "",
            version_code=int(apk.get_androidversion_code() or 0),
            min_sdk=int(apk.get_min_sdk_version() or 0),
            label=apk.get_app_name() or "",
        )
