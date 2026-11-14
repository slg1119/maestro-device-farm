import threading
import time

from sqlalchemy import func, select

from farm.db.models import ApiToken


def test_sqlite_pragmas(db):
    with db.engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000


def test_concurrent_writers_are_serialized(db):
    errors: list[Exception] = []

    def writer(i: int) -> None:
        try:
            with db.session() as s:
                s.execute(select(1))  # starts BEGIN IMMEDIATE and holds the write lock
                time.sleep(0.05)
                s.add(ApiToken(name=f"t{i}", token_hash=f"h{i}"))
        except Exception as exc:  # noqa: BLE001 - collected so the assertion shows the real error
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(ApiToken)) == 5


def test_session_rolls_back_on_error(db):
    try:
        with db.session() as s:
            s.add(ApiToken(name="x", token_hash="h"))
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(ApiToken)) == 0
