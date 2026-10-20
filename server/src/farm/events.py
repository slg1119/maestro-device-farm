from sqlalchemy import func, select
from sqlalchemy.orm import Session

from farm.db.models import Event
from farm.timeutil import now


def emit(session: Session, type_: str, payload: dict, run_id: str | None = None) -> None:
    session.add(Event(ts=now(), type=type_, run_id=run_id, payload=payload))


def events_since(session: Session, since_id: int, run_id: str | None = None, limit: int = 500) -> list[Event]:
    query = select(Event).where(Event.id > since_id)
    if run_id is not None:
        query = query.where(Event.run_id == run_id)
    return list(session.scalars(query.order_by(Event.id).limit(limit)))


def latest_event_id(session: Session) -> int:
    return session.scalar(select(func.max(Event.id))) or 0
