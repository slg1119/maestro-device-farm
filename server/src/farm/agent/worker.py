import asyncio
import logging
from pathlib import Path

from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import AppBuild, Run
from farm.results import TaskOutcome
from farm.runner.base import CancelToken, Inspector, PrecheckFailed, Runner, TaskSpec
from farm.scheduler.claim import claim_next
from farm.scheduler.commands import claim_command, finish_command
from farm.scheduler.finish import finish_task, is_cancel_requested, requeue_after_precheck

log = logging.getLogger(__name__)


class DeviceWorker:
    """Claims and executes tasks (and inspect commands) for one device until stopped."""

    def __init__(self, serial: str, db: Database, settings: Settings, runner: Runner,
                 inspector: Inspector | None = None, *, idle_sleep: float = 1.0, cancel_poll_sec: float = 2.0) -> None:
        self.serial = serial
        self.db = db
        self.settings = settings
        self.runner = runner
        self.inspector = inspector
        self.idle_sleep = idle_sleep
        self.cancel_poll_sec = cancel_poll_sec
        self._stopping = False
        self._token: CancelToken | None = None
        self._ran_once = False
        self._loop_task: asyncio.Task | None = None

    def start(self) -> None:
        self._loop_task = asyncio.create_task(self.run_forever(), name=f"worker-{self.serial}")

    def notify_disconnected(self) -> None:
        self._stopping = True
        if self._token is not None:
            self._token.cancel("disconnected")

    async def stop(self) -> None:
        self._stopping = True
        if self._token is not None:
            self._token.cancel("shutdown")
        await self.wait()

    async def wait(self) -> None:
        if self._loop_task is not None:
            await self._loop_task

    async def run_forever(self) -> None:
        while not self._stopping:
            try:
                worked = await self.step()
            except Exception:  # keep the device loop alive; the next iteration retries
                log.exception("worker %s step failed", self.serial)
                worked = False
            if not worked and not self._stopping:
                await asyncio.sleep(self.idle_sleep)

    async def step(self) -> bool:
        if self.inspector is not None and await self._run_command():
            return True
        spec = await asyncio.to_thread(self._claim)
        if spec is None:
            return False
        await self._execute(spec)
        return True

    def _claim(self) -> TaskSpec | None:
        with self.db.session() as s:
            task = claim_next(s, self.serial, self.settings.data_dir)
            if task is None:
                return None
            run = s.get(Run, task.run_id)
            app = s.get(AppBuild, run.app_build_id)
            return TaskSpec(
                task_id=task.id, run_id=run.id, serial=self.serial, attempt=task.attempt,
                apk_path=Path(app.file_path), package_name=app.package_name, flows_dir=Path(run.flows_dir),
                flows=list(task.flows), include_tags=list(run.include_tags), exclude_tags=list(run.exclude_tags),
                env=dict(run.env), timeout_sec=run.task_timeout_sec, artifacts_dir=Path(task.artifacts_dir),
                first_run_on_device=not self._ran_once,
            )

    async def _execute(self, spec: TaskSpec) -> None:
        token = CancelToken()
        self._token = token
        if self._stopping:  # disconnect arrived between claim and start
            token.cancel("disconnected")
        watcher = asyncio.create_task(self._watch_cancel(spec.task_id, token))
        try:
            outcome = await self.runner.run(spec, token)
        except PrecheckFailed as exc:
            await asyncio.to_thread(self._requeue, spec.task_id, str(exc))
            return
        except Exception as exc:  # a runner bug fails the task instead of killing the worker
            log.exception("runner crashed on task %s", spec.task_id)
            outcome = TaskOutcome("error", error_code="runner_error", error_message=str(exc))
        finally:
            watcher.cancel()
            self._token = None
        self._ran_once = True
        if token.reason == "shutdown":
            return  # recover_after_restart() requeues the task when the agent starts again
        await asyncio.to_thread(self._finish, spec.task_id, outcome)

    async def _watch_cancel(self, task_id: str, token: CancelToken) -> None:
        while not token.is_cancelled:
            await asyncio.sleep(self.cancel_poll_sec)
            if await asyncio.to_thread(self._cancel_requested, task_id):
                token.cancel("user")
                return

    async def _run_command(self) -> bool:
        command_id = await asyncio.to_thread(self._claim_command)
        if command_id is None:
            return False
        out_dir = self.settings.data_dir / "inspect" / command_id
        try:
            await self.inspector.inspect(self.serial, out_dir)
            ok, error = True, None
        except Exception as exc:  # inspection failures are reported on the command
            log.warning("inspect %s on %s failed: %s", command_id, self.serial, exc)
            ok, error = False, str(exc)
        await asyncio.to_thread(self._finish_command, command_id, ok, str(out_dir) if ok else None, error)
        return True

    def _cancel_requested(self, task_id: str) -> bool:
        with self.db.session() as s:
            return is_cancel_requested(s, task_id)

    def _requeue(self, task_id: str, reason: str) -> None:
        with self.db.session() as s:
            requeue_after_precheck(s, task_id, reason)

    def _finish(self, task_id: str, outcome: TaskOutcome) -> None:
        with self.db.session() as s:
            finish_task(s, task_id, outcome)

    def _claim_command(self) -> str | None:
        with self.db.session() as s:
            command = claim_command(s, self.serial)
            return command.id if command else None

    def _finish_command(self, command_id: str, ok: bool, result_dir: str | None, error: str | None) -> None:
        with self.db.session() as s:
            finish_command(s, command_id, ok=ok, result_dir=result_dir, error=error)
