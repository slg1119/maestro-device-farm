import pytest

from farm.db.models import AppBuild, Run, Task, TestResult
from farm.workspaces.registry import create_workspace
from tests.gitfixtures import SAMPLE_FILES, git_settings, make_origin


@pytest.fixture
def workspace(settings, db, tmp_path):
    remotes = tmp_path / "remotes"
    origin = make_origin(remotes, "acme/app", SAMPLE_FILES)
    configured = git_settings(settings, remotes).model_copy(update={"git_poll_sec": 0})
    ws = create_workspace(db, configured, name="example", repo="acme/app", path=".maestro",
                          default_app_package="com.example.app")
    return configured, ws, origin


@pytest.fixture
def failed_task(workspace, db):
    settings, ws, _ = workspace
    artifacts = settings.path("tasks", "failed")
    (artifacts / "screenshots").mkdir(parents=True)
    (artifacts / "screenshots/failure.png").write_bytes(b"fake-png")
    (artifacts / "maestro.log").write_text("too-old-line\n" + "padding\n" * 200 +
                                         "last-log-line password=private-run-password\n")
    flows = settings.path("uploads", "failed", "flows")
    flows.mkdir(parents=True)
    (flows / "login.yaml").write_text("appId: com.example.app\n---\n- tapOn: DRAFT_BUTTON\n")
    with db.session() as s:
        build = AppBuild(package_name="com.example.app", sha256="fixture-hash", file_path="fake.apk",
                         size_bytes=1, source="test")
        s.add(build)
        s.flush()
        run = Run(origin="draft", mode="split", app_build_id=build.id, flow_source="draft", flows_dir=str(flows),
                  task_timeout_sec=10, workspace_id=ws.id, commit_sha=ws.head_sha,
                  env={"PASSWORD": "private-run-password"})
        s.add(run)
        s.flush()
        task = Task(run_id=run.id, seq=0, flows=["login.yaml"], status="failed", artifacts_dir=str(artifacts))
        s.add(task)
        s.flush()
        s.add(TestResult(task_id=task.id, run_id=run.id, device_serial="fake", flow_name="login", status="failed",
                         failure_message="Expected login button; password=private-run-password"))
    return task
