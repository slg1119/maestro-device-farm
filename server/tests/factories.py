import io
import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from farm.db.models import AppBuild, Device, Run
from farm.ids import new_id
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.submit import RunRequest, create_run


def add_device(session: Session, serial: str = "d1", *, state: str = "available", sdk_int: int = 34,
               model: str = "Pixel 7", tags: tuple[str, ...] = (), reservation_id: str | None = None,
               disabled: bool = False) -> Device:
    device = Device(serial=serial, state=state, sdk_int=sdk_int, model=model, manufacturer="Google",
                    os_version="14", tags=list(tags), reservation_id=reservation_id, disabled=disabled)
    session.add(device)
    session.flush()
    return device


def add_app(session: Session, *, package: str = "com.example.app", min_sdk: int = 21,
            file_path: str = "/tmp/app.apk") -> AppBuild:
    build = AppBuild(package_name=package, version_name="1.0", version_code=1, min_sdk=min_sdk, label="Example",
                     sha256=new_id(), file_path=file_path, size_bytes=1, source="ci")
    session.add(build)
    session.flush()
    return build


def flow_yaml(*tags: str) -> str:
    header = "appId: com.example.app\n" + (f"tags: [{', '.join(tags)}]\n" if tags else "")
    return header + "---\n- launchApp\n"


def write_flows(root: Path, files: dict[str, str]) -> Path:
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return root


def zip_bytes(files: dict[str, str | bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buffer.getvalue()


def submit(session: Session, *, app: AppBuild, flows_dir: Path, mode: str = "split",
           selector: DeviceSelector | None = None, flow_paths: list[str] | None = None,
           include_tags: tuple[str, ...] = (), exclude_tags: tuple[str, ...] = (),
           reservation_id: str | None = None, origin: str = "ci", env: dict | None = None,
           timeout: int = 1800) -> Run:
    return create_run(session, RunRequest(
        run_id=new_id(), mode=mode, selector=selector or DeviceSelector(), app_build=app, flows_dir=flows_dir,
        flow_paths=flow_paths, include_tags=list(include_tags), exclude_tags=list(exclude_tags), env=env or {},
        task_timeout_sec=timeout, origin=origin, created_by="test", reservation_id=reservation_id,
    ))
