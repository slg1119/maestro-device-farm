"""AI authoring jobs with validation, screen context and reserved-device auto-repair."""
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from farm.ai.client import RESULT_SCHEMA, AiRequest, TextPart
from farm.ai.context import (
    failure_context,
    failure_target,
    materialize,
    redact,
    screen_context,
    workspace_context,
)
from farm.api.errors import ApiError
from farm.apps.library import resolve_app
from farm.db.models import AiJob, DeviceCommand, Recording, Reservation, Run, Task, TestResult, Workspace
from farm.events import emit
from farm.flows.enumerate import CONFIG_NAMES, FLOW_SUFFIXES
from farm.ids import new_id
from farm.scheduler.commands import create_inspect_command
from farm.scheduler.finish import TERMINAL_STATUSES, cancel_run
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.submit import RunRequest, create_run
from farm.timeutil import now
from farm.workspaces.changes import Change, Issue, validate_changes
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.paths import normalize_rel
from farm.workspaces.registry import find_workspace
from farm.workspaces.snapshot import apply_changes


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["generate", "fix", "record"]
    recording_id: str | None = None
    workspace: str | None = None
    base_sha: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{40}$")
    source_task_id: str | None = None
    prompt: str = ""
    target_path: str | None = None
    draft_changes: list[Change] = Field(default_factory=list)
    include_screen: bool = False
    auto_repair: bool = False
    reservation_id: str | None = None
    app_build_id: str | None = None
    app: str | None = None
    author_name: str = ""


class JobCancelled(Exception):
    pass


def updated(session, job) -> None:
    emit(session, "ai_job.updated", {"id": job.id, "status": job.status, "attempts": len(job.attempts)})


def create_record_job(session, settings, writer, recording, model=None) -> AiJob:
    """Create the polish job in the same transaction that finishes the recording."""
    ws = session.get(Workspace, recording.workspace_id) if recording.workspace_id else None
    if ws is None:
        raise ApiError(400, "recording_needs_workspace", "A workspace is required to refine a recording with AI.")
    if not ws.head_sha:
        raise ApiError(409, "workspace_not_synced", "Sync the workspace first.")
    target = f"flows/recorded-{recording.id}.yaml"
    options = {"target_path": target, "include_screen": False, "auto_repair": False, "reservation_id": None,
               "app_build_id": None, "app": None, "draft_changes": [], "recording_id": recording.id,
               "steps": recording.steps, "yaml": recording.yaml}
    job = AiJob(kind="record", workspace_id=ws.id, base_sha=ws.head_sha,
                prompt="Refine the recorded actions into a reusable Maestro flow.",
                options=redact(settings, options), model=model or settings.openai_model,
                created_by=redact(settings, writer.name), author_name=redact(settings, writer.name))
    session.add(job)
    session.flush()
    updated(session, job)
    return job


def create_job(db, settings, writer, body) -> AiJob:
    body = body if isinstance(body, JobRequest) else JobRequest.model_validate(body)
    if body.kind == "record":
        with db.session() as session:
            recording = session.get(Recording, body.recording_id) if body.recording_id else None
            if recording is None or recording.status != "done":
                raise ApiError(400, "invalid_request", "record needs a completed recording")
            if recording.ai_job_id:
                return session.get(AiJob, recording.ai_job_id)
            job = create_record_job(session, settings, writer, recording)
            recording.ai_job_id = job.id
            from farm.stream.recorder import recording_updated

            recording_updated(session, recording)
            return job
    if body.kind == "generate" and (not body.workspace or not body.base_sha or
                                    not body.target_path or not body.prompt.strip() or body.source_task_id):
        raise ApiError(400, "invalid_request", "generate needs workspace, base_sha, target_path and prompt")
    if (body.include_screen or body.auto_repair) and not body.reservation_id:
        raise ApiError(400, "invalid_request", "screen and auto_repair need reservation_id")
    if body.auto_repair and not (body.app_build_id or body.app):
        raise ApiError(400, "invalid_request", "auto_repair needs app_build_id or app")
    with db.session() as s:
        secrets = []
        if body.kind == "fix":
            task = s.get(Task, body.source_task_id) if body.source_task_id else None
            if not task:
                raise ApiError(400, "invalid_request", "fix needs a source task")
            run = s.get(Run, task.run_id)
            if not run.workspace_id or not run.commit_sha or run.flow_source not in {"workspace", "draft"}:
                raise ApiError(400, "fix_needs_workspace", "fix needs a workspace or draft run")
            ws = s.get(Workspace, run.workspace_id)
            if ws is None:
                raise ApiError(400, "fix_needs_workspace", "the source workspace no longer exists")
            results = list(s.scalars(select(TestResult).where(TestResult.task_id == task.id).order_by(TestResult.id)))
            try:
                target_path = failure_target(task, run, results)
            except ValueError as exc:
                raise ApiError(400, "invalid_request", str(exc)) from exc
            base_sha = run.commit_sha
            secrets = list(run.env.values())
        else:
            try:
                ws = find_workspace(s, body.workspace)
            except WorkspaceError as exc:
                raise ApiError(exc.status, exc.code, str(exc)) from exc
            target_path, base_sha = body.target_path, body.base_sha
        try:
            target_path = normalize_rel(target_path)
            if ".git" in target_path.split("/"):
                raise ValueError(".git paths are forbidden")
        except ValueError as exc:
            raise ApiError(400, "invalid_request", str(exc)) from exc
        options = body.model_dump(include={"target_path", "include_screen", "auto_repair", "reservation_id",
                                           "app_build_id", "app", "draft_changes"})
        options["target_path"] = target_path
        job = AiJob(kind=body.kind, workspace_id=ws.id, base_sha=base_sha, prompt=redact(settings, body.prompt, secrets),
                    options=redact(settings, options, secrets), model=settings.openai_model,
                    created_by=redact(settings, writer.name, secrets),
                    author_name=redact(settings, body.author_name or writer.name, secrets), reservation_id=body.reservation_id,
                    source_task_id=body.source_task_id)
        s.add(job)
        s.flush()
        updated(s, job)
    return job


class AiJobRunner:
    def __init__(self, db, settings, client, checker):
        self.db, self.settings, self.client, self.checker = db, settings, client, checker
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="farm-ai")

    def start(self):
        """Recover jobs abandoned by the previous API process before accepting new work."""
        with self.db.session() as s:
            for job in s.scalars(select(AiJob).where(AiJob.status.in_(["queued", "running"]))):
                job.status, job.error_message, job.finished_at = "failed", "api restarted", now()
                updated(s, job)

    def submit(self, job_id):
        return self.pool.submit(self.run_job, job_id)

    def stop(self):
        self.pool.shutdown(wait=True, cancel_futures=True)
        if hasattr(self.client, "close"):
            self.client.close()

    def _attempt(self, job_id, attempt, model=None):
        with self.db.session() as s:
            job = s.get(AiJob, job_id)
            job.attempts = [*job.attempts, attempt]
            job.input_tokens += attempt.get("input_tokens", 0)
            job.output_tokens += attempt.get("output_tokens", 0)
            if model:
                job.model = model
            updated(s, job)

    def _finish(self, job_id, status, *, result=None, error=None):
        with self.db.session() as s:
            job = s.get(AiJob, job_id)
            if job.cancel_requested:
                status, result, error = "cancelled", None, None
            elif status == "succeeded":
                self._check(s, job_id)
            job.status, job.result, job.error_message = status, result, error
            job.finished_at = now()
            updated(s, job)

    def _check(self, session, job_id):
        """Check cancellation and wall-clock expiry even before the reservation sweeper runs."""
        job = session.get(AiJob, job_id)
        if job.cancel_requested:
            raise JobCancelled()
        if not job.reservation_id:
            return None
        reservation = session.get(Reservation, job.reservation_id)
        if reservation is None or reservation.status != "active" or reservation.expires_at <= now():
            raise ValueError("reservation ended")
        return reservation

    def _checkpoint(self, job_id):
        with self.db.session() as s:
            self._check(s, job_id)

    def _screen(self, job_id):
        with self.db.session() as s:
            reservation = self._check(s, job_id)
            command = create_inspect_command(s, reservation.id)
        deadline = monotonic() + 90
        while True:
            with self.db.session() as s:
                self._check(s, job_id)
                command = s.get(DeviceCommand, command.id)
            if command.status == "done":
                try:
                    if not command.result_dir:
                        raise ValueError("snapshot result directory is missing")
                    context = screen_context(Path(command.result_dir))
                except (OSError, ValueError, TypeError) as exc:
                    raise ValueError(f"screen snapshot failed: {exc}") from exc
                self._checkpoint(job_id)
                return context
            if command.status == "error":
                raise ValueError(f"screen snapshot failed: {command.error_message or 'inspect command failed'}")
            if monotonic() >= deadline:
                raise ValueError("screen snapshot failed: timed out after 90 seconds")
            sleep(0.5)

    def _draft_run(self, job, candidate):
        run_id = new_id()
        flows = self.settings.path("uploads", run_id, "flows")
        flows.parent.mkdir(parents=True)
        try:
            # Copy the base + user draft + this answer outside SQLite's write transaction.
            shutil.copytree(candidate, flows)
            target = Path(job.options["target_path"])
            flow_paths = [target.as_posix()] if target.suffix in FLOW_SUFFIXES and target.name not in CONFIG_NAMES else None
            with self.db.session() as s:
                reservation = self._check(s, job.id)
                app = resolve_app(s, app_build_id=job.options["app_build_id"],
                                  app_spec=None if job.options["app_build_id"] else job.options["app"])
                run = create_run(s, RunRequest(
                    run_id=run_id, origin="ai", mode="matrix",
                    selector=DeviceSelector(serials=[reservation.device_serial]), reservation_id=reservation.id,
                    app_build=app, flows_dir=flows, flow_source="draft", flow_paths=flow_paths, env={},
                    workspace_id=job.workspace_id, commit_sha=job.base_sha, created_by=job.created_by,
                ))
            return run
        except Exception:
            shutil.rmtree(flows.parent, ignore_errors=True)
            raise

    def _run_attempt(self, job_id, n, run_id, status):
        """Expose the run link while waiting, then update the same attempt on completion."""
        attempt = {"n": n, "kind": "run", "status": "ok" if status in {"queued", "running", "passed"} else "failed",
                   "detail": status, "run_id": run_id, "issues": [], "input_tokens": 0, "output_tokens": 0}
        with self.db.session() as s:
            job = s.get(AiJob, job_id)
            attempts = list(job.attempts)
            index = next((i for i, a in enumerate(attempts) if a.get("run_id") == run_id), None)
            if index is None:
                attempts.append(attempt)
            else:
                attempts[index] = attempt
            job.attempts = attempts
            updated(s, job)

    def _wait_run(self, job_id, n, run):
        try:
            self._run_attempt(job_id, n, run.id, run.status)
            while True:
                with self.db.session() as s:
                    self._check(s, job_id)
                    run = s.get(Run, run.id)
                if run.status in TERMINAL_STATUSES:
                    self._run_attempt(job_id, n, run.id, run.status)
                    return run
                sleep(2)
        except Exception:
            with self.db.session() as s:
                cancel_run(s, run.id)
            self._run_attempt(job_id, n, run.id, "cancelled")
            raise

    def run_job(self, job_id):
        """Share one repair budget between validation retries and reserved-device runs."""
        with self.db.session() as s:
            job = s.get(AiJob, job_id)
            if job is None or job.status != "queued":
                return
            job.status = "running"
            updated(s, job)
            ws = s.get(Workspace, job.workspace_id)
            task = s.get(Task, job.source_task_id) if job.source_task_id else None
            run = s.get(Run, task.run_id) if task else None
            secrets = list(run.env.values()) if run else []
        try:
            self._checkpoint(job.id)
            with TemporaryDirectory(prefix="farm-ai-") as temp:
                root = materialize(self.settings, ws, job.base_sha, job.options["draft_changes"],
                                   Path(temp) / "workspace")
                text = (f"## Workspace\ndefault_app_package: {ws.default_app_package}\n"
                        f"{workspace_context(root, job.options['target_path'])}")
                if job.kind == "record":
                    text += (f"\n\n## Recorded flow\nOutput exactly one file: {job.options['target_path']}\n"
                             + json.dumps({"steps": job.options["steps"], "yaml": job.options["yaml"]}, ensure_ascii=False))
                failure, images = failure_context(self.settings, task, db=self.db) if task else ("", [])
                if job.options["include_screen"]:
                    screen, screen_images = self._screen(job.id)
                    failure += "\n\n" + screen
                    images += screen_images
                text = redact(self.settings, text + "\n\n" + failure + "\n\n## User description\n" + job.prompt, secrets)
                folder = self.settings.path("ai", job.id)
                folder.mkdir(parents=True, exist_ok=True)
                prompts = Path(__file__).with_name("prompts")
                prompt_names = ["system.md", "maestro-reference.md"] + (["record.md"] if job.kind == "record" else [])
                system = redact(self.settings, "\n\n".join((prompts / name).read_text(encoding="utf-8")
                                                           for name in prompt_names), secrets)
                feedback = ""
                last_answer = None
                limit = 1 + self.settings.ai_max_repairs
                for n in range(1, limit + 1):
                    self._checkpoint(job.id)
                    request = AiRequest(system=system, parts=[TextPart(text + feedback), *images])
                    (folder / f"request-{n}.json").write_text(json.dumps({"system": request.system,
                                                                          "text": text + feedback}))
                    response = self.client.complete(request, RESULT_SCHEMA)
                    (folder / f"response-{n}.json").write_text(redact(self.settings, response.raw, secrets))
                    self._attempt(job.id, {"n": n, "kind": "generate", "status": "ok", "detail": "",
                                          "run_id": None, "issues": [], "input_tokens": response.input_tokens,
                                          "output_tokens": response.output_tokens}, redact(self.settings, response.model, secrets))
                    self._checkpoint(job.id)
                    data = redact(self.settings, response.data, secrets)
                    changes = [Change(op="put", **f) for f in data["files"]]
                    normalized, issues = validate_changes(
                        changes, max_bytes=self.settings.max_flows_mb * 1024 * 1024, checker=self.checker)
                    for change in normalized:
                        if ".git" in change.path.split("/"):
                            issues.append(Issue(path=change.path, message=".git paths are forbidden"))
                    if job.kind == "record" and (len(normalized) != 1 or
                                                  normalized[0].path != job.options["target_path"]):
                        issues.append(Issue(path=job.options["target_path"],
                                            message="record must return exactly the requested flow file"))
                    if not issues:
                        candidate = Path(temp) / "candidate"
                        shutil.rmtree(candidate, ignore_errors=True)
                        shutil.copytree(root, candidate, symlinks=True)
                        try:
                            apply_changes(candidate, normalized, self.settings.max_flows_mb * 1024 * 1024)
                        except (WorkspaceError, OSError) as exc:
                            issues.append(Issue(path="", message=redact(self.settings, str(exc), secrets)))
                    self._attempt(job.id, {"n": n, "kind": "validation",
                                          "status": "failed" if issues else "ok", "detail": "",
                                          "run_id": None, "issues": [i.model_dump() for i in issues],
                                          "input_tokens": 0, "output_tokens": 0})
                    if not issues:
                        data = {**data, "files": [{"path": c.path, "content": c.content}
                                                          for c in normalized], "passed_run_id": None}
                        last_answer = data
                        self._checkpoint(job.id)
                        if not job.options["auto_repair"]:
                            self._finish(job.id, "succeeded", result=data)
                            return
                        draft = self._draft_run(job, candidate)
                        completed = self._wait_run(job.id, n, draft)
                        if completed.status == "passed":
                            self._checkpoint(job.id)
                            self._finish(job.id, "succeeded", result={**data, "passed_run_id": completed.id})
                            return
                        if completed.status == "cancelled":
                            raise ValueError("draft run cancelled")
                        if n == limit:
                            break
                        with self.db.session() as s:
                            failed = s.scalar(select(Task).where(Task.run_id == completed.id,
                                              Task.status.in_(["failed", "error"])).order_by(Task.seq))
                        failure, images = failure_context(self.settings, failed, db=self.db,
                                                          target_path=job.options["target_path"])
                        feedback = redact(self.settings, "\n\n## Device: the flow failed on the device\n"
                                          + json.dumps({"previous_answer": data}) + "\n" + failure, secrets)
                        continue
                    feedback = redact(self.settings, "\n\n## Validation: the previous answer failed validation\n"
                                      + json.dumps({"previous_answer": data,
                                                    "issues": [i.model_dump() for i in issues]}), secrets)
                self._checkpoint(job.id)
                if job.options["auto_repair"] and last_answer:
                    note = f"Auto-repair limit reached ({self.settings.ai_max_repairs}); the run did not pass."
                    result = {**last_answer, "summary": last_answer["summary"] + "\n\n" + note}
                    self._finish(job.id, "succeeded", result=result)
                else:
                    self._finish(job.id, "failed", error=f"validation kept failing after {limit} attempts")
        except JobCancelled:
            self._finish(job.id, "cancelled")
        except Exception as exc:  # noqa: BLE001 - background jobs must persist provider and validation failures
            self._finish(job.id, "failed", error=redact(self.settings, str(exc), secrets))
