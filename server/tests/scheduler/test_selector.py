import pytest
from pydantic import ValidationError

from farm.db.models import Device
from farm.scheduler.selector import DeviceSelector, device_matches


def _device(serial="d1", sdk_int=34, model="Pixel 7", tags=()):
    return Device(serial=serial, sdk_int=sdk_int, model=model, tags=list(tags))


def test_empty_selector_matches_everything():
    assert device_matches(_device(), DeviceSelector())


def test_serials():
    assert device_matches(_device("a"), DeviceSelector(serials=["a", "b"]))
    assert not device_matches(_device("c"), DeviceSelector(serials=["a", "b"]))


def test_tags_must_all_be_present():
    sel = DeviceSelector(tags=["smoke", "tablet"])
    assert device_matches(_device(tags=("smoke", "tablet", "x")), sel)
    assert not device_matches(_device(tags=("smoke",)), sel)


def test_sdk_bounds_and_models():
    assert not device_matches(_device(sdk_int=28), DeviceSelector(min_sdk=29))
    assert not device_matches(_device(sdk_int=35), DeviceSelector(max_sdk=34))
    assert device_matches(_device(model="Pixel 7"), DeviceSelector(models=["Pixel 7"]))
    assert not device_matches(_device(model="Pixel 7a"), DeviceSelector(models=["Pixel 7"]))


def test_app_min_sdk():
    assert not device_matches(_device(sdk_int=28), DeviceSelector(), app_min_sdk=30)
    assert device_matches(_device(sdk_int=30), DeviceSelector(), app_min_sdk=30)


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        DeviceSelector.model_validate({"serial": ["x"]})
