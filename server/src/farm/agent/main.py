import asyncio
import logging
import socket

from farm import __version__
from farm.agent.recovery import recover_after_restart
from farm.agent.worker import DeviceWorker
from farm.config import Settings
from farm.db.engine import Database
from farm.devices.provider import DeviceInfo, DeviceProvider
from farm.devices.registry import heartbeat, mark_healthy, sync_devices, unhealthy_serials
from farm.ops.retention import run_retention
from farm.runner.base import Inspector, Runner
from farm.scheduler.reservations import expire_reservations
from farm.scheduler.sweeper import fail_stale_pinned_tasks
from farm.stream.manager import ControlHook, StreamManager
from farm.stream.server import StreamServer
from farm.timeutil import now

log = logging.getLogger(__name__)


class Agent:
    def __init__(self, settings: Settings, db: Database, provider: DeviceProvider, runner: Runner,
                 inspector: Inspector | None = None, *, agent_id: str | None = None, poll_sec: float = 3.0,
                 sweep_sec: float = 30.0, heartbeat_sec: float = 5.0, unhealthy_recheck_sec: float = 60.0,
                 worker_idle_sleep: float = 1.0, cancel_poll_sec: float = 2.0,
                 stream_manager: StreamManager | None = None,
                 control_hooks: list[ControlHook] | None = None) -> None:
        self.settings = settings
        self.db = db
        self.provider = provider
        self.runner = runner
        self.inspector = inspector
        self.agent_id = agent_id or socket.gethostname()
        self.poll_sec = poll_sec
        self.sweep_sec = sweep_sec
        self.heartbeat_sec = heartbeat_sec
        self.unhealthy_recheck_sec = unhealthy_recheck_sec
        self.worker_idle_sleep = worker_idle_sleep
        self.cancel_poll_sec = cancel_poll_sec
        self.stream_manager = stream_manager
        if stream_manager is not None and control_hooks is not None:
            stream_manager.control_hooks = list(control_hooks)
        self.stream_server = StreamServer(stream_manager, settings) if stream_manager is not None else None
        self.started_at = now()
        self.workers: dict[str, DeviceWorker] = {}
        self._retiring: set[asyncio.Task] = set()
        self._stop = asyncio.Event()

    async def start(self) -> None:
        recovered = await asyncio.to_thread(self._recover)
        if recovered:
            log.info("requeued %d task(s) left running by a previous agent", len(recovered))
        await self.heartbeat_once()

    async def run(self) -> None:
        await self.start()
        if self.stream_server:
            try:
                await self.stream_server.start()
            except OSError:
                log.error("agent stream server could not bind 127.0.0.1:%d; continuing without streaming",
                          self.settings.agent_stream_port)
        loops = [
            asyncio.create_task(self._every(self.poll_sec, self.poll_devices_once)),
            asyncio.create_task(self._every(self.sweep_sec, self.sweep_once)),
            asyncio.create_task(self._every(self.heartbeat_sec, self.heartbeat_once)),
            asyncio.create_task(self._every(self.unhealthy_recheck_sec, self.recheck_unhealthy_once)),
            asyncio.create_task(self._retention_loop()),
        ]
        try:
            await self._stop.wait()
        finally:
            for loop in loops:
                loop.cancel()
            await asyncio.gather(*loops, return_exceptions=True)
            if self.stream_server:
                await self.stream_server.stop()
            await self.stop_workers()

    def request_stop(self) -> None:
        self._stop.set()

    async def poll_devices_once(self) -> None:
        infos = await self.provider.list_devices()
        connected = await asyncio.to_thread(self._sync, infos)
        for serial in sorted(connected - self.workers.keys()):
            try:
                await self.provider.prepare(serial)
            except Exception as exc:  # preparation is best effort; the device can still run flows
                log.warning("prepare %s failed: %s", serial, exc)
            worker = DeviceWorker(serial, self.db, self.settings, self.runner, self.inspector,
                                  idle_sleep=self.worker_idle_sleep, cancel_poll_sec=self.cancel_poll_sec)
            worker.start()
            self.workers[serial] = worker
        for serial in sorted(self.workers.keys() - connected):
            if self.stream_manager:
                await self.stream_manager.device_disconnected(serial)
            worker = self.workers.pop(serial)
            worker.notify_disconnected()
            retiring = asyncio.create_task(worker.wait())
            self._retiring.add(retiring)
            retiring.add_done_callback(self._retiring.discard)

    async def sweep_once(self) -> None:
        await asyncio.to_thread(self._sweep)

    async def heartbeat_once(self) -> None:
        await asyncio.to_thread(self._heartbeat)

    async def recheck_unhealthy_once(self) -> None:
        for serial in await asyncio.to_thread(self._unhealthy):
            if serial in self.workers and await self.runner.precheck(serial) is None:
                await asyncio.to_thread(self._mark_healthy, serial)

    async def stop_workers(self) -> None:
        workers = list(self.workers.values())
        self.workers.clear()
        await asyncio.gather(*(worker.stop() for worker in workers), *self._retiring, return_exceptions=True)

    async def _every(self, interval: float, fn) -> None:
        while True:
            try:
                await fn()
            except Exception:  # one failed iteration must not stop the loop
                log.exception("agent loop %s failed", fn.__name__)
            await asyncio.sleep(interval)

    async def _retention_loop(self) -> None:
        await asyncio.sleep(60)
        await self._every(86400, self.retention_once)

    async def retention_once(self) -> None:
        report = await asyncio.to_thread(run_retention, self.db, self.settings)
        log.info("retention complete: %s", report)

    def _recover(self) -> list[str]:
        with self.db.session() as s:
            return recover_after_restart(s)

    def _sync(self, infos: list[DeviceInfo]) -> set[str]:
        with self.db.session() as s:
            return sync_devices(s, infos)

    def _sweep(self) -> None:
        with self.db.session() as s:
            failed = fail_stale_pinned_tasks(s, self.settings.pinned_wait_sec)
            expired = expire_reservations(s)
        if failed or expired:
            log.info("sweeper failed %d stale task(s), expired %d reservation(s)", len(failed), len(expired))

    def _heartbeat(self) -> None:
        with self.db.session() as s:
            heartbeat(s, self.agent_id, __version__, self.started_at)

    def _unhealthy(self) -> list[str]:
        with self.db.session() as s:
            return unhealthy_serials(s)

    def _mark_healthy(self, serial: str) -> None:
        with self.db.session() as s:
            mark_healthy(s, serial)
