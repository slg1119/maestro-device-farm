import shutil

from fastapi import APIRouter, Request
from sqlalchemy import select

from farm.api.deps import get_db, get_settings
from farm.db.models import AgentStatus
from farm.timeutil import age_seconds

router = APIRouter()


@router.get("/healthz")
def healthz(request: Request) -> dict:
    settings = get_settings(request)
    with get_db(request).session() as s:
        row = s.scalar(select(AgentStatus).order_by(AgentStatus.last_heartbeat_at.desc()).limit(1))
        agent = None if row is None else {
            "id": row.id, "version": row.version, "started_at": row.started_at,
            "last_heartbeat_at": row.last_heartbeat_at, "age_sec": round(age_seconds(row.last_heartbeat_at), 1),
        }
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "agent": agent, "disk_free_bytes": shutil.disk_usage(settings.data_dir).free}
