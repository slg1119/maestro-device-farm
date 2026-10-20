import hashlib
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.apps.apk import ApkParser
from farm.db.models import AppBuild


class AppResolveError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ingest_apk(
    session: Session, apks_dir: Path, src: Path, parser: ApkParser, *, source: str, uploaded_by: str,
    ci_meta: dict | None = None,
) -> tuple[AppBuild, bool]:
    digest = sha256_file(src)
    existing = session.scalar(select(AppBuild).where(AppBuild.sha256 == digest))
    if existing is not None and not existing.purged:
        src.unlink(missing_ok=True)
        return existing, False
    info = parser.parse(src)
    apks_dir.mkdir(parents=True, exist_ok=True)
    dest = apks_dir / f"{digest}.apk"
    size = src.stat().st_size
    shutil.move(src, dest)
    if existing is not None:  # a purged build uploaded again: bring its file back
        existing.purged = False
        existing.file_path = str(dest)
        return existing, False
    build = AppBuild(
        package_name=info.package_name, version_name=info.version_name, version_code=info.version_code,
        min_sdk=info.min_sdk, label=info.label, sha256=digest, file_path=str(dest), size_bytes=size,
        source=source, ci_meta=ci_meta or {}, uploaded_by=uploaded_by,
    )
    session.add(build)
    session.flush()
    return build, True


def resolve_app(session: Session, *, app_build_id: str | None = None, app_spec: str | None = None) -> AppBuild:
    if bool(app_build_id) == bool(app_spec):
        raise AppResolveError("invalid_app", "specify exactly one of app_build_id or app")
    if app_build_id:
        build = session.get(AppBuild, app_build_id)
        if build is None or build.purged:
            raise AppResolveError("app_not_found", f"app build {app_build_id} not found")
        return build
    package, sep, tag = app_spec.partition("@")
    if not package or not sep or tag != "latest":
        raise AppResolveError("invalid_app", "app must look like <package>@latest")
    build = session.scalar(
        select(AppBuild)
        .where(AppBuild.package_name == package, AppBuild.purged.is_(False))
        .order_by(AppBuild.created_at.desc(), AppBuild.id.desc())
        .limit(1)
    )
    if build is None:
        raise AppResolveError("app_not_found", f"no build for {package}")
    return build
