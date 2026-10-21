import os
from dataclasses import asdict

import pytest
from sqlalchemy import text

from farm.db.models import AiJob, AppBuild, Device, Event, Run
from farm.ops.retention import run_retention
from farm.timeutil import parse, shift

NOW = "2026-10-21T00:00:00.000000Z"
DAY = 86400


def build(db, settings, key, days, *, package="com.test", pinned=False):
    path = settings.path("apks", f"{key}.apk")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"apk")
    with db.session() as s:
        s.add(AppBuild(id=key, package_name=package, sha256=key, file_path=str(path),
                       size_bytes=3, source="upload", pinned=pinned, created_at=shift(NOW, -days * DAY)))
    return path


def run(db, settings, key, app, days, status="passed", purged=False):
    with db.session() as s:
        s.add(Run(id=key, origin="web", mode="split", app_build_id=app, flow_source="upload",
                  flows_dir="unused", task_timeout_sec=30, status=status, artifacts_purged=purged,
                  finished_at=shift(NOW, -days * DAY)))
    for directory in ("runs", "uploads"):
        path = settings.path(directory, key)
        path.mkdir(parents=True)
        (path / "test.txt").write_text("test")


def test_every_retention_rule_and_idempotency(db, settings):
    settings.app_keep_per_package = 2
    paths = {key: build(db, settings, key, days, pinned=key == "pinned") for key, days in
             (("newest", 0), ("second", 1), ("pinned", 2), ("referenced", 3), ("expired", 4), ("unused", 5))}
    other = build(db, settings, "other", 100, package="com.other")
    run(db, settings, "old", "expired", 31)
    run(db, settings, "recent", "referenced", 1)
    run(db, settings, "running", "referenced", 100, status="running")
    run(db, settings, "boundary", "referenced", 30)
    run(db, settings, "already", "referenced", 31, purged=True)
    with db.session() as s:
        s.add_all([Event(type="test", ts=shift(NOW, -days * DAY)) for days in (8, 7, 1)])
        for key, days in (("old-ai", 31), ("recent-ai", 1), ("boundary-ai", 30)):
            s.add(AiJob(id=key, kind="generate", status="succeeded", workspace_id="ws", base_sha="sha",
                        prompt="description", model="fake", input_tokens=10, output_tokens=20,
                        result={"summary": "result summary"}, created_at=shift(NOW, -days * DAY)))
    for key in ("old-ai", "recent-ai", "boundary-ai"):
        folder = settings.path("ai", key)
        folder.mkdir(parents=True)
        (folder / "request.json").write_text("private")
    for key, seconds in (("old", DAY + 1), ("boundary", DAY), ("recent", 5)):
        folder = settings.path("inspect", key)
        folder.mkdir(parents=True)
        (folder / "screen.png").write_bytes(b"png")
        ts = parse(shift(NOW, -seconds)).timestamp()
        os.utime(folder, (ts, ts))
    # A3 has not necessarily been merged: exercise its table without importing its model.
    with db.session() as s:
        s.add(Device(serial="ticket-device"))
    with db.engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE IF NOT EXISTS stream_tickets (ticket_hash TEXT PRIMARY KEY, "
                             "device_serial TEXT, actor TEXT, author_name TEXT, expires_at TEXT, "
                             "used_at TEXT, created_at TEXT)")
        for key, days in (("expired", 2), ("boundary", 1), ("future", -1)):
            conn.execute(text("INSERT INTO stream_tickets "
                              "(ticket_hash, device_serial, actor, author_name, expires_at, used_at, created_at) "
                              "VALUES (:key, 'ticket-device', 'test', 'test', :ts, NULL, :created)"),
                         {"key": key, "ts": shift(NOW, -days * DAY), "created": NOW})

    report = run_retention(db, settings, now=NOW)
    assert asdict(report) == {"runs": 1, "app_builds": 2, "inspect": 1, "events": 1, "stream_tickets": 1, "ai_jobs": 1}
    assert not settings.path("runs", "old").exists()
    assert not settings.path("uploads", "old").exists()
    assert not paths["expired"].exists() and not paths["unused"].exists()
    assert all(paths[key].exists() for key in ("newest", "second", "pinned", "referenced"))
    assert other.exists()
    assert not settings.path("inspect", "old").exists()
    assert settings.path("inspect", "boundary").exists()
    assert not settings.path("ai", "old-ai").exists()
    assert settings.path("ai", "boundary-ai").exists()
    with db.session() as s:
        assert s.get(Run, "old").artifacts_purged
        assert not s.get(Run, "running").artifacts_purged
        assert not s.get(Run, "boundary").artifacts_purged
        assert s.get(AppBuild, "expired").purged
        assert s.get(AiJob, "old-ai").prompt_purged
        assert s.get(AiJob, "old-ai").prompt == ""
        assert s.get(AiJob, "old-ai").result == {"summary": "result summary"}
        assert s.get(AiJob, "old-ai").input_tokens == 10
        assert s.get(AiJob, "old-ai").output_tokens == 20
    assert all(value == 0 for value in asdict(run_retention(db, settings, now=NOW)).values())


def test_missing_ticket_table_and_files_are_safe(db, settings):
    with db.engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS stream_tickets")
    path = build(db, settings, "missing", 100)
    run(db, settings, "missing", "missing", 31)
    path.unlink()
    import shutil
    shutil.rmtree(settings.path("runs", "missing"))
    shutil.rmtree(settings.path("uploads", "missing"))
    settings.app_keep_per_package = 0
    report = run_retention(db, settings, now=NOW)
    assert report.runs == report.app_builds == 1
    assert report.stream_tickets == 0


def test_file_deletion_is_outside_transactions_and_retries_after_failure(db, settings, monkeypatch):
    import shutil
    build(db, settings, "apk", 100)
    run(db, settings, "run", "apk", 31)
    original = shutil.rmtree
    calls = []

    def remove(path, *args, **kwargs):
        assert db.engine.pool.checkedout() == 0
        calls.append(path)
        if len(calls) == 2:
            raise OSError("temporary failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", remove)
    with pytest.raises(OSError, match="temporary failure"):
        run_retention(db, settings, now=NOW)
    with db.session() as s:
        assert not s.get(Run, "run").artifacts_purged
    assert run_retention(db, settings, now=NOW).runs == 1


def test_retention_does_not_follow_directory_symlinks(db, settings, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep").write_text("keep")
    settings.path("inspect").mkdir(parents=True)
    link = settings.path("inspect", "old-link")
    link.symlink_to(outside, target_is_directory=True)
    ts = parse(shift(NOW, -2 * DAY)).timestamp()
    os.utime(link, (ts, ts), follow_symlinks=False)
    assert run_retention(db, settings, now=NOW).inspect == 1
    assert (outside / "keep").exists()


def test_apk_unlink_happens_outside_db_transactions(db, settings, monkeypatch):
    from pathlib import Path
    path = build(db, settings, "old-apk", 100)
    settings.app_keep_per_package = 0
    original = Path.unlink
    calls = []

    def unlink(target, *args, **kwargs):
        assert db.engine.pool.checkedout() == 0
        calls.append(target)
        return original(target, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", unlink)
    assert run_retention(db, settings, now=NOW).app_builds == 1
    assert path in calls


def test_retention_rejects_symlinked_parent_without_marking_rows(db, settings, tmp_path):
    build(db, settings, "apk", 100)
    run(db, settings, "old", "apk", 31)
    import shutil
    shutil.rmtree(settings.path("uploads"))
    outside = tmp_path / "outside"
    (outside / "old").mkdir(parents=True)
    (outside / "old" / "keep").write_text("keep")
    settings.path("uploads").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes"):
        run_retention(db, settings, now=NOW)
    assert (outside / "old" / "keep").read_text() == "keep"
    with db.session() as s:
        assert not s.get(Run, "old").artifacts_purged


def test_retention_cli(db, settings, monkeypatch, capsys):
    from farm.cli.farm import main
    monkeypatch.setenv("FARM_DATA_DIR", str(settings.data_dir))
    assert main(["retention", "run"]) == 0
    assert "runs=0" in capsys.readouterr().out


def test_settings_defaults_and_nonnegative_limits(settings):
    from pydantic import ValidationError

    from farm.config import Settings
    assert settings.retention_days == 30
    assert settings.app_keep_per_package == 20
    with pytest.raises(ValidationError):
        Settings(retention_days=-1)
    with pytest.raises(ValidationError):
        Settings(app_keep_per_package=-1)


def test_dry_run_reports_every_category_without_changing_files_or_rows(db, settings, monkeypatch):
    import sqlite3
    from contextlib import closing

    settings.app_keep_per_package = 0
    apk = build(db, settings, "expired", 100)
    run(db, settings, "old", "expired", 100)
    with db.session() as s:
        s.add(Event(type="old", ts=shift(NOW, -8 * DAY)))
        s.add(AiJob(id="old-ai", kind="generate", status="succeeded", workspace_id="ws", base_sha="sha",
                    prompt="keep prompt", model="fake", created_at=shift(NOW, -31 * DAY)))
    with db.engine.begin() as conn:
        conn.execute(text("INSERT INTO stream_tickets "
                          "(ticket_hash, device_serial, actor, author_name, expires_at, created_at) "
                          "VALUES ('old', 'fake', 'test', 'test', :ts, :ts)"), {"ts": shift(NOW, -2 * DAY)})
    for folder in (settings.path("ai", "old-ai"), settings.path("inspect", "old")):
        folder.mkdir(parents=True)
        (folder / "keep.txt").write_text("keep")
        ts = parse(shift(NOW, -2 * DAY)).timestamp()
        os.utime(folder, (ts, ts))

    def rows():
        with closing(sqlite3.connect(db.path)) as conn:
            return list(conn.iterdump())

    def files():
        return {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for category in
                ("apks", "runs", "uploads", "ai", "inspect") for p in settings.path(category).rglob("*") if p.is_file()}

    before_rows, before_files = rows(), files()
    paths = []
    report = run_retention(db, settings, now=NOW, dry_run=True, removal_paths=paths)
    assert asdict(report) == {"runs": 1, "app_builds": 1, "inspect": 1, "events": 1, "stream_tickets": 1, "ai_jobs": 1}
    assert set(paths) == {settings.path("runs", "old"), settings.path("uploads", "old"), apk,
                          settings.path("inspect", "old"), settings.path("ai", "old-ai")}
    assert rows() == before_rows and files() == before_files
    assert asdict(run_retention(db, settings, now=NOW)) == asdict(report)


def test_retention_cli_dry_run_caps_paths_at_50_and_keeps_data(db, settings, monkeypatch, capsys):
    from farm.cli.farm import main

    apk = build(db, settings, "apk", 100)
    for index in range(30):
        run(db, settings, f"old-{index}", "apk", 100)
    monkeypatch.setenv("FARM_DATA_DIR", str(settings.data_dir))
    assert main(["retention", "run", "--dry-run"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert "runs=30" in lines[0] and "미리보기" in lines[0]
    assert len(lines[1:]) == 50
    assert all(line.startswith("삭제 예정: ") for line in lines[1:])
    assert apk.exists() and all(settings.path("runs", f"old-{i}", "test.txt").exists() for i in range(30))
    with db.session() as s:
        assert all(not s.get(Run, f"old-{i}").artifacts_purged for i in range(30))
