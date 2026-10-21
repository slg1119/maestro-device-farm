"""Delete retained files without holding SQLite's global write lock.

Rows stay available for history. Mark a row only after all its files are gone,
so an interrupted pass can safely repeat the same deletion on the next pass.
"""
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, inspect, select, text

from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import AiJob, AppBuild, Event, Run
from farm.scheduler.finish import TERMINAL_STATUSES
from farm.timeutil import now as timestamp_now
from farm.timeutil import parse, shift, to_iso


@dataclass
class RetentionReport:
    runs: int = 0
    app_builds: int = 0
    inspect: int = 0
    events: int = 0
    stream_tickets: int = 0
    ai_jobs: int = 0


def _remove(path: Path, root: Path) -> None:
    # Unlink a final symlink itself, and reject symlinked parents/path traversal.
    # No retention path may escape its own data subtree.
    root = root.absolute()
    path = path.absolute()
    if path == root or not path.is_relative_to(root):
        raise ValueError("retention path is outside its data subtree")
    if root.is_symlink() or not path.parent.resolve().is_relative_to(root.resolve()):
        raise ValueError("retention parent escapes its data subtree")
    if path.is_symlink():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def run_retention(db: Database, settings: Settings, now: str | datetime | None = None) -> RetentionReport:
    reference = to_iso(now) if isinstance(now, datetime) else now or timestamp_now()
    report = RetentionReport()
    with db.session() as s:
        run_ids = list(s.scalars(select(Run.id).where(
            Run.status.in_(TERMINAL_STATUSES), Run.finished_at < shift(reference, -settings.retention_days * 86400),
            Run.artifacts_purged.is_(False))))
    for run_id in run_ids:
        for directory in ("runs", "uploads"):
            _remove(settings.path(directory, run_id), settings.path(directory))
        with db.session() as s:
            s.get(Run, run_id).artifacts_purged = True
        report.runs += 1

    with db.session() as s:
        referenced = set(s.scalars(select(Run.app_build_id).where(Run.artifacts_purged.is_(False))))
        builds = list(s.scalars(select(AppBuild).where(AppBuild.purged.is_(False)).order_by(
            AppBuild.package_name, AppBuild.created_at.desc(), AppBuild.id.desc())))
    per_package: dict[str, int] = {}
    for build in builds:
        rank = per_package.get(build.package_name, 0)
        per_package[build.package_name] = rank + 1
        if rank < settings.app_keep_per_package or build.pinned or build.id in referenced:
            continue
        _remove(Path(build.file_path), settings.path("apks"))
        with db.session() as s:
            s.get(AppBuild, build.id).purged = True
        report.app_builds += 1

    inspect_dir = settings.path("inspect")
    if inspect_dir.is_symlink():
        raise ValueError("inspect directory must not be a symlink")
    if inspect_dir.exists():
        cutoff = parse(shift(reference, -86400)).timestamp()
        for path in inspect_dir.iterdir():
            try:
                expired = path.lstat().st_mtime < cutoff
            except FileNotFoundError:  # another cleanup already removed it
                continue
            if expired:
                _remove(path, inspect_dir)
                report.inspect += 1

    with db.session() as s:
        report.events = s.execute(delete(Event).where(Event.ts < shift(reference, -7 * 86400))).rowcount
    # A3 can land after A4. Do not import its ORM model or turn a missing table into an error.
    if inspect(db.engine).has_table("stream_tickets"):
        with db.session() as s:
            report.stream_tickets = s.execute(text(
                "DELETE FROM stream_tickets WHERE expires_at < :cutoff"),
                {"cutoff": shift(reference, -86400)}).rowcount

    with db.session() as s:
        job_ids = list(s.scalars(select(AiJob.id).where(
            AiJob.created_at < shift(reference, -30 * 86400), AiJob.prompt_purged.is_(False))))
    for job_id in job_ids:
        _remove(settings.path("ai", job_id), settings.path("ai"))
        with db.session() as s:
            job = s.get(AiJob, job_id)
            job.prompt = ""  # the user description is also prompt source data (§11.5)
            job.prompt_purged = True
        report.ai_jobs += 1
    return report
