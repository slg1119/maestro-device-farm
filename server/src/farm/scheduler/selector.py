from pydantic import BaseModel, ConfigDict

from farm.db.models import Device


class DeviceSelector(BaseModel):
    model_config = ConfigDict(extra="forbid")

    serials: list[str] | None = None
    tags: list[str] | None = None
    min_sdk: int | None = None
    max_sdk: int | None = None
    models: list[str] | None = None


def device_matches(device: Device, selector: DeviceSelector, app_min_sdk: int = 0) -> bool:
    if selector.serials is not None and device.serial not in selector.serials:
        return False
    if selector.tags and not set(selector.tags) <= set(device.tags or []):
        return False
    if selector.min_sdk is not None and device.sdk_int < selector.min_sdk:
        return False
    if selector.max_sdk is not None and device.sdk_int > selector.max_sdk:
        return False
    if selector.models is not None and device.model not in selector.models:
        return False
    return device.sdk_int >= app_min_sdk
