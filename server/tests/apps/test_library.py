import os
from pathlib import Path

import pytest
from sqlalchemy import func, select

from farm.apps.apk import AndroguardApkParser, ApkParseError
from farm.apps.library import AppResolveError, ingest_apk, resolve_app
from farm.db.models import AppBuild
from tests.fakes import FakeApkParser, fake_apk_bytes


def _apk(tmp_path, name="app.apk", **kwargs) -> Path:
    path = tmp_path / name
    path.write_bytes(fake_apk_bytes(**kwargs))
    return path


def _ingest(db, settings, src):
    with db.session() as s:
        return ingest_apk(s, settings.path("apks"), src, FakeApkParser(), source="ci", uploaded_by="ci",
                          ci_meta={"branch": "main"})


def test_ingest_new_apk(db, settings, tmp_path):
    src = _apk(tmp_path)
    build, created = _ingest(db, settings, src)
    assert created
    assert (build.package_name, build.version_code, build.min_sdk) == ("com.example.app", 1, 21)
    stored = Path(build.file_path)
    assert stored == settings.path("apks", f"{build.sha256}.apk") and stored.is_file()
    assert not src.exists()
    assert build.size_bytes == stored.stat().st_size
    assert build.ci_meta == {"branch": "main"} and build.source == "ci"


def test_same_bytes_are_deduplicated(db, settings, tmp_path):
    first, _ = _ingest(db, settings, _apk(tmp_path, "a.apk"))
    second_src = _apk(tmp_path, "b.apk")
    second, created = _ingest(db, settings, second_src)
    assert not created and second.id == first.id
    assert not second_src.exists()
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(AppBuild)) == 1


def test_invalid_apk_raises_and_stores_nothing(db, settings, tmp_path):
    src = tmp_path / "bad.apk"
    src.write_bytes(b"garbage")
    with pytest.raises(ApkParseError):
        _ingest(db, settings, src)
    assert not settings.path("apks").exists() or not any(settings.path("apks").iterdir())
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(AppBuild)) == 0


def test_resolve_by_id_and_latest(db, settings, tmp_path):
    v1, _ = _ingest(db, settings, _apk(tmp_path, "v1.apk", version_code=1))
    v2, _ = _ingest(db, settings, _apk(tmp_path, "v2.apk", version_code=2))
    with db.session() as s:
        s.get(AppBuild, v1.id).created_at = "2026-01-01T00:00:00.000000Z"
    with db.session() as s:
        assert resolve_app(s, app_spec="com.example.app@latest").id == v2.id
        assert resolve_app(s, app_build_id=v1.id).id == v1.id


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({}, "invalid_app"),
        ({"app_build_id": "x", "app_spec": "com.x@latest"}, "invalid_app"),
        ({"app_spec": "com.example.app"}, "invalid_app"),
        ({"app_spec": "com.example.app@1.0"}, "invalid_app"),
        ({"app_spec": "com.unknown@latest"}, "app_not_found"),
        ({"app_build_id": "missing"}, "app_not_found"),
    ],
)
def test_resolve_errors(db, kwargs, code):
    with pytest.raises(AppResolveError) as excinfo, db.session() as s:
        resolve_app(s, **kwargs)
    assert excinfo.value.code == code


def test_purged_build_is_not_resolvable(db, settings, tmp_path):
    build, _ = _ingest(db, settings, _apk(tmp_path))
    with db.session() as s:
        s.get(AppBuild, build.id).purged = True
    with pytest.raises(AppResolveError), db.session() as s:
        resolve_app(s, app_build_id=build.id)


def test_androguard_rejects_garbage(tmp_path):
    bad = tmp_path / "bad.apk"
    bad.write_bytes(b"definitely not a zip")
    with pytest.raises(ApkParseError):
        AndroguardApkParser().parse(bad)


@pytest.mark.skipif(not os.environ.get("FARM_TEST_APK"), reason="set FARM_TEST_APK to a real APK path")
def test_androguard_parses_real_apk():
    info = AndroguardApkParser().parse(Path(os.environ["FARM_TEST_APK"]))
    assert info.package_name and info.version_code >= 0 and info.min_sdk >= 0
