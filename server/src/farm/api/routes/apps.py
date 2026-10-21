import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from farm.api.deps import Writer, get_db, get_settings, get_writer
from farm.api.errors import ApiError
from farm.api.uploads import MB, UploadTooLarge, save_upload
from farm.apps.apk import ApkParseError
from farm.apps.library import ingest_apk
from farm.db.models import AppBuild
from farm.ids import new_id

router = APIRouter()


class AppOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    package_name: str
    version_name: str
    version_code: int
    min_sdk: int
    label: str
    sha256: str
    size_bytes: int
    source: str
    ci_meta: dict
    uploaded_by: str
    pinned: bool
    purged: bool
    created_at: str


class AppPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pinned: bool


def _get_app(session, app_id: str) -> AppBuild:
    build = session.get(AppBuild, app_id)
    if build is None:
        raise ApiError(404, "app_not_found", f"app build {app_id} not found")
    return build


@router.get("/apps")
def list_apps(request: Request, package: str | None = None, limit: int = Query(100, ge=1, le=500)) -> list[AppOut]:
    with get_db(request).session() as s:
        query = select(AppBuild)
        if package:
            query = query.where(AppBuild.package_name == package)
        rows = s.scalars(query.order_by(AppBuild.created_at.desc(), AppBuild.id.desc()).limit(limit))
        return [AppOut.model_validate(row) for row in rows]


@router.post("/apps")
def upload_app(
    request: Request,
    response: Response,
    apk: UploadFile = File(...),
    ci_meta: str | None = Form(None),
    source: Literal["ci", "dashboard"] = Form("ci"),
    writer: Writer = Depends(get_writer),
) -> AppOut:
    settings = get_settings(request)
    try:
        meta = json.loads(ci_meta) if ci_meta else {}
    except json.JSONDecodeError as exc:
        raise ApiError(400, "invalid_ci_meta", "ci_meta must be a JSON object") from exc
    if not isinstance(meta, dict):
        raise ApiError(400, "invalid_ci_meta", "ci_meta must be a JSON object")
    tmp = settings.path("tmp", f"{new_id()}.apk")
    try:
        save_upload(apk, tmp, settings.max_apk_mb * MB)
        with get_db(request).session() as s:
            build, created = ingest_apk(s, settings.path("apks"), tmp, request.app.state.apk_parser, source=source,
                                        uploaded_by=writer.name, ci_meta=meta)
            out = AppOut.model_validate(build)
    except UploadTooLarge as exc:
        raise ApiError(413, "upload_too_large", str(exc)) from exc
    except ApkParseError as exc:
        raise ApiError(400, "invalid_apk", str(exc)) from exc
    finally:
        tmp.unlink(missing_ok=True)
    response.status_code = 201 if created else 200
    return out


@router.patch("/apps/{app_id}")
def patch_app(app_id: str, body: AppPatch, request: Request, _writer: Writer = Depends(get_writer)) -> AppOut:
    with get_db(request).session() as s:
        build = _get_app(s, app_id)
        build.pinned = body.pinned
        return AppOut.model_validate(build)


@router.get("/apps/{app_id}/download")
def download_app(app_id: str, request: Request) -> FileResponse:
    with get_db(request).session() as s:
        build = _get_app(s, app_id)
    path = Path(build.file_path)
    if build.purged or not path.is_file():
        raise ApiError(404, "app_file_missing", f"the APK for {app_id} is no longer stored")
    return FileResponse(path, filename=f"{build.package_name}-{build.version_name or build.version_code}.apk",
                        media_type="application/vnd.android.package-archive")
