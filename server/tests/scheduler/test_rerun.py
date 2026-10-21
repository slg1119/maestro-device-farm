import shutil
from pathlib import Path

import pytest
from sqlalchemy import select

from farm.db.models import Run, Task, TestResult
from farm.scheduler.rerun import prepare_rerun, rerun_run
from farm.scheduler.reservations import create_reservation, release_reservation
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.submit import SubmitError
from farm.timeutil import now, shift
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


def execute_rerun(db, settings, run_id, *, failed_only=False):
    with db.session() as s:
        plan = prepare_rerun(s, settings, run_id, failed_only=failed_only)
    root = settings.path("uploads", plan.new_run_id, "flows")
    try:
        shutil.copytree(plan.flows_dir, root)
        with db.session() as s:
            return rerun_run(s, plan, flows_dir=root, created_by="operator")
    except Exception:
        shutil.rmtree(root.parent, ignore_errors=True)
        raise


@pytest.fixture
def source(db, tmp_path, request):
    root = write_flows(tmp_path / "source", {
        "a.yaml": flow_yaml("smoke"), "b.yaml": flow_yaml("smoke"),
        "nested/c.yaml": flow_yaml(), "asset.txt": "asset",
        "config.yaml": "flows: ['*.yaml', 'nested/*.yaml']\n",
    })
    with db.session() as s:
        add_device(s, "d1", tags=("phone",))
        run = submit(s, app=add_app(s), flows_dir=root, mode=getattr(request, "param", "split"),
                     flow_paths=["a.yaml", "b.yaml", "nested/c.yaml"],
                     selector=DeviceSelector(tags=["phone"]), env={"PASSWORD": "keep-private"}, timeout=321)
        run.flow_source = "draft"
        run.workspace_id, run.ref, run.commit_sha = "ws", "main", "a" * 40
        run.include_tags, run.exclude_tags = ["smoke"], ["slow"]
        run.ci_meta, run.status = {"branch": "release"}, "failed"
    return run


def test_copies_options_and_independent_snapshot(db, settings, source):
    before = {p.relative_to(source.flows_dir).as_posix(): p.read_bytes()
              for p in Path(source.flows_dir).rglob("*") if p.is_file()}
    rerun = execute_rerun(db, settings, source.id)
    with db.session() as s:
        tasks = list(s.scalars(select(Task).where(Task.run_id == rerun.id).order_by(Task.seq)))
    assert rerun.id != source.id
    assert rerun.flows_dir == str(settings.path("uploads", rerun.id, "flows"))
    assert {p.relative_to(rerun.flows_dir).as_posix(): p.read_bytes()
            for p in Path(rerun.flows_dir).rglob("*") if p.is_file()} == before
    for field in ("mode", "device_selector", "app_build_id", "flow_source", "workspace_id", "ref", "commit_sha",
                  "flow_paths", "include_tags", "exclude_tags", "env", "ci_meta", "task_timeout_sec"):
        assert getattr(rerun, field) == getattr(source, field), field
    assert (rerun.origin, rerun.created_by, rerun.status) == ("dashboard", "operator", "queued")
    assert [task.flows for task in tasks] == [["a.yaml"], ["b.yaml"], ["nested/c.yaml"]]
    (Path(rerun.flows_dir) / "asset.txt").write_text("changed")
    assert (Path(source.flows_dir) / "asset.txt").read_text() == "asset"


@pytest.mark.parametrize("state", ["active", "released", "expired", "missing"])
def test_reservation_retained_only_while_active(db, settings, source, state):
    with db.session() as s:
        reservation = create_reservation(s, "d1", "operator", 600)
        s.get(Run, source.id).reservation_id = reservation.id
        if state == "released":
            release_reservation(s, reservation.id)
        elif state == "expired":
            # The sweeper has not yet changed the row's status.
            reservation.expires_at = shift(now(), -1)
            release_reservation(s, reservation.id, status="expired")
            reservation.status = "active"
        elif state == "missing":
            release_reservation(s, reservation.id)
            s.delete(reservation)
    rerun = execute_rerun(db, settings, source.id)
    assert rerun.reservation_id == (reservation.id if state == "active" else None)


@pytest.mark.parametrize("source", ["split", "matrix"], indirect=True)
def test_failed_only_combines_results_and_error_task_paths(db, settings, source):
    with db.session() as s:
        tasks = list(s.scalars(select(Task).where(Task.run_id == source.id).order_by(Task.seq)))
        s.add_all([
            TestResult(task_id=tasks[0].id, run_id=source.id, device_serial="d1", flow_name="a", status="failed"),
            TestResult(task_id=tasks[0].id, run_id=source.id, device_serial="d2", flow_name="a", status="failed"),
            TestResult(task_id=tasks[0].id, run_id=source.id, device_serial="d1", flow_name="b", status="passed"),
        ])
        tasks[-1].status, tasks[-1].flows = "error", ["nested/c.yaml"]
    rerun = execute_rerun(db, settings, source.id, failed_only=True)
    with db.session() as s:
        tasks = list(s.scalars(select(Task).where(Task.run_id == rerun.id).order_by(Task.seq)))
    assert rerun.flow_paths == ["a.yaml", "nested/c.yaml"]
    assert [task.flows for task in tasks] == (
        [["a.yaml"], ["nested/c.yaml"]] if source.mode == "split" else [["a.yaml", "nested/c.yaml"]])


@pytest.mark.parametrize("source", ["matrix"], indirect=True)
def test_error_matrix_task_with_empty_flows_means_every_selected_flow(db, settings, source):
    with db.session() as s:
        s.get(Run, source.id).flow_paths = None
        task = s.scalar(select(Task).where(Task.run_id == source.id))
        task.status, task.flows = "error", []
    rerun = execute_rerun(db, settings, source.id, failed_only=True)
    assert rerun.flow_paths == ["a.yaml", "b.yaml"]


def test_failed_result_accepts_exact_relative_path(db, settings, source):
    with db.session() as s:
        task = s.scalar(select(Task).where(Task.run_id == source.id))
        s.add(TestResult(task_id=task.id, run_id=source.id, device_serial="d1",
                         flow_name="nested/c.yaml", status="failed"))
    rerun = execute_rerun(db, settings, source.id, failed_only=True)
    assert rerun.flow_paths == ["nested/c.yaml"]


@pytest.mark.parametrize("failure", ["nothing_failed", "purged", "missing", "run_not_found"])
def test_rerun_errors(db, settings, source, failure):
    with db.session() as s:
        if failure == "purged":
            s.get(Run, source.id).artifacts_purged = True
    if failure == "missing":
        shutil.rmtree(source.flows_dir)
    with pytest.raises(SubmitError) as error:
        execute_rerun(db, settings, "missing" if failure == "run_not_found" else source.id, failed_only=True)
    expected = "snapshot_purged" if failure in ("purged", "missing") else failure
    assert error.value.code == expected
    uploads = settings.path("uploads")
    assert not uploads.exists() or not list(uploads.iterdir())
