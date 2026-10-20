import logging
import threading

from farm.config import Settings
from farm.db.engine import Database
from farm.workspaces.registry import sync_all

log = logging.getLogger(__name__)


class WorkspacePoller:
    """Fetches every workspace branch at start-up and then every `interval` seconds, on its own thread."""

    def __init__(self, db: Database, settings: Settings, interval: float | None = None) -> None:
        self.db = db
        self.settings = settings
        self.interval = interval if interval is not None else settings.git_poll_sec
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="workspace-poller", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 10) -> None:
        self._stop.set()
        self._thread.join(timeout)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                sync_all(self.db, self.settings)
            except Exception:  # keep polling; the next round may succeed
                log.exception("workspace sync failed")
            self._stop.wait(self.interval)
