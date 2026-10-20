from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from farm.db.models import Base


def _on_connect(dbapi_connection, _record) -> None:
    # Let us emit BEGIN ourselves (see _on_begin); pysqlite would otherwise start deferred transactions.
    dbapi_connection.isolation_level = None
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def _on_begin(connection) -> None:
    # Every transaction takes the write lock up front, so claim/finish logic never races.
    connection.exec_driver_sql("BEGIN IMMEDIATE")


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})
        event.listen(self.engine, "connect", _on_connect)
        event.listen(self.engine, "begin", _on_begin)
        self._factory = sessionmaker(self.engine, expire_on_commit=False)

    @contextmanager
    def session(self) -> Iterator[Session]:
        with self._factory() as session, session.begin():
            yield session

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)
