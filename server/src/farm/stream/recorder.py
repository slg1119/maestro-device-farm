import asyncio
import logging
from dataclasses import dataclass, field

from sqlalchemy import select

from farm.db.models import Recording, Task
from farm.events import emit
from farm.recording.steps import StepClassifier, append_step, parse_hierarchy
from farm.recording.yaml import steps_to_yaml
from farm.runner.procs import run_capture
from farm.stream.events import ControlEvent
from farm.timeutil import now

log = logging.getLogger(__name__)


def recording_updated(session, row):
    emit(session, "recording.updated", {"id": row.id, "status": row.status, "steps": len(row.steps)})


def finalize_recording(session, row):
    if row.status in {"active", "stopping"}:
        row.yaml = steps_to_yaml(row.steps, row.app_package)
        row.status, row.finished_at = "done", now()
        recording_updated(session, row)


@dataclass
class _Active:
    id: str
    classifier: StepClassifier = field(default_factory=lambda: StepClassifier([]))
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    capture: asyncio.Task | None = None
    generation: int = 0
    ready_at: float | None = None
    driver_release_attempted: bool = False
    hierarchy_warning_logged: bool = False


class Recorder:
    """Persist every completed action immediately; memory holds only gestures and hierarchy."""

    def __init__(self, db, streams, adb, owned_serials, *, settle_sec=1.0, capture_timeout_sec=10):
        self.db, self.streams, self.adb = db, streams, adb
        self.owned_serials, self.settle_sec = owned_serials, settle_sec
        self.capture_timeout_sec = capture_timeout_sec
        self._active: dict[str, _Active] = {}
        self._captures: set[asyncio.Task] = set()

    def _rows(self, owned):
        with self.db.session() as session:
            rows = list(session.scalars(select(Recording).where(
                Recording.device_serial.in_(owned), Recording.status.in_(["active", "stopping"]))))
            for row in rows:
                if row.status == "stopping":
                    finalize_recording(session, row)
            return [row for row in rows if row.status == "active"]

    async def poll_once(self):
        rows = await asyncio.to_thread(self._rows, set(self.owned_serials()))
        wanted = {row.device_serial: row for row in rows}
        for serial, active in list(self._active.items()):
            if serial not in wanted or wanted[serial].id != active.id:
                await self._release(serial, active)
        for serial, row in wanted.items():
            if serial in self._active:
                continue
            active = _Active(row.id)
            self._active[serial] = active
            try:
                await self.streams.hold(serial, f"recording:{row.id}")
                await self._capture(serial, active)
            except Exception:  # noqa: BLE001 - device errors must not stop other recordings
                log.warning("recording could not attach to device %s", serial)
                await self._release(serial, active)

    async def _run_adb(self, serial, active, *args):
        # run_capture handles timeout cleanup but not cancellation. Shield and
        # drain every adb command so children/pipes never outlive shutdown.
        capture = asyncio.create_task(run_capture(
            self.adb._argv(serial, *args), timeout=self.capture_timeout_sec),
            name=f"recording-adb-{active.id}")
        try:
            return await asyncio.shield(capture)
        except asyncio.CancelledError:
            await asyncio.gather(capture, return_exceptions=True)
            raise

    def _running_task_id(self, serial):
        # Match StreamManager's task lookup, rather than a potentially stale device pointer.
        with self.db.session() as session:
            return session.scalar(select(Task.id).where(
                Task.device_serial == serial, Task.status == "running").limit(1))

    async def _release_maestro(self, serial, active):
        # Maestro starts its driver at the beginning of each run, so releasing a
        # leftover UiAutomation connection between runs is safe.
        for package in ("dev.mobile.maestro", "dev.mobile.maestro.test"):
            result = await self._run_adb(serial, active, "shell", "am", "force-stop", package)
            if result.returncode != 0:
                raise ValueError("Maestro driver release failed")
        result = await self._run_adb(serial, active, "shell", "pkill", "-f", "dev[.]mobile[.]maestro")
        if result.returncode not in (0, 1):  # pkill exits 1 when force-stop already removed every match.
            raise ValueError("Maestro instrumentation release failed")
        log.info("recording released leftover Maestro driver for device %s", serial)

    async def _capture(self, serial, active):
        generation, nodes = active.generation, []
        for attempt in range(2):
            try:
                result = await self._run_adb(serial, active, "exec-out", "uiautomator", "dump", "/dev/tty")
                if result.returncode != 0:
                    raise ValueError("hierarchy dump failed")
                nodes = parse_hierarchy(result.text, strict=True)
                break
            except Exception:  # noqa: BLE001 - selectors are best effort; never log private child output
                if not active.hierarchy_warning_logged:
                    active.hierarchy_warning_logged = True
                    log.warning("recording hierarchy unavailable for device %s; using point fallback", serial)
                if attempt or active.driver_release_attempted or self._active.get(serial) is not active:
                    break
                try:
                    task_id = await asyncio.to_thread(self._running_task_id, serial)
                    # Another capture can finish the same DB check while this one waits.
                    if (task_id is not None or active.driver_release_attempted
                            or self._active.get(serial) is not active):
                        break
                    active.driver_release_attempted = True
                    await self._release_maestro(serial, active)
                except Exception:  # noqa: BLE001 - DB/device failures must preserve point fallback too
                    break
        if self._active.get(serial) is active and active.generation == generation:
            active.classifier.nodes = nodes

    async def _settled_capture(self, serial, active):
        while self._active.get(serial) is active and active.ready_at is not None:
            delay = active.ready_at - asyncio.get_running_loop().time()
            if delay > 0:
                await asyncio.sleep(delay)
                continue
            generation = active.generation
            await self._capture(serial, active)
            if generation == active.generation:
                return

    def _append(self, recording_id, step, event):
        with self.db.session() as session:
            row = session.get(Recording, recording_id)
            if row is None or row.status != "active" or event.ts < row.created_at:
                return
            row.steps = append_step(row.steps, step)
            recording_updated(session, row)

    async def on_control(self, event: ControlEvent):
        active = self._active.get(event.serial)
        if active is None:
            return
        async with active.lock:
            step = active.classifier.feed(event)
            if step is not None:
                await asyncio.to_thread(self._append, active.id, step, event)
            # Wait until the gesture ends before refreshing the hierarchy; repeated
            # actions reset the debounce so navigation sees a settled screen.
            active.generation += 1
            active.ready_at = None
            if event.message["type"] != "touch" or event.message["action"] == "up":
                active.ready_at = asyncio.get_running_loop().time() + self.settle_sec
                if active.capture is None or active.capture.done():
                    active.capture = asyncio.create_task(self._settled_capture(event.serial, active),
                                                        name=f"recording-capture-{active.id}")
                    self._captures.add(active.capture)
                    active.capture.add_done_callback(self._captures.discard)

    async def _release(self, serial, active):
        self._active.pop(serial, None)
        if active.capture:
            active.capture.cancel()
            await asyncio.gather(active.capture, return_exceptions=True)
        await self.streams.release(serial, f"recording:{active.id}")

    async def stop(self):
        for serial, active in list(self._active.items()):
            await self._release(serial, active)
        await asyncio.gather(*self._captures, return_exceptions=True)
