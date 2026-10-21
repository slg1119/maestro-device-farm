import time
from threading import Lock
from weakref import WeakKeyDictionary

from sqlalchemy import update

from farm.db.engine import Database
from farm.db.models import Task
from farm.events import emit
from farm.stream.events import ControlEvent

_lock = Lock()
_last_emitted: WeakKeyDictionary[Database, dict[str, float]] = WeakKeyDictionary()


def record_control(db: Database, event: ControlEvent) -> None:
    """Persist interference on every input, but limit device.control notifications."""
    with _lock:
        last = _last_emitted.setdefault(db, {})
        current = time.monotonic()
        should_emit = event.serial not in last or current - last[event.serial] >= 10
        with db.session() as session:
            session.execute(update(Task).where(
                Task.device_serial == event.serial, Task.status == "running",
            ).values(interfered=True))
            if should_emit:
                # Input text and coordinates deliberately stay out of the event log.
                emit(session, "device.control", {"serial": event.serial, "actor": event.actor, "ts": event.ts})
        if should_emit:
            last[event.serial] = current
