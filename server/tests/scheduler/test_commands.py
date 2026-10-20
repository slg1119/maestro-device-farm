import pytest

from farm.db.models import Device, DeviceCommand
from farm.scheduler.commands import (
    CommandError,
    claim_command,
    create_inspect_command,
    fail_running_commands,
    finish_command,
)
from farm.scheduler.reservations import create_reservation, release_reservation
from tests.factories import add_device


def _reserved(db):
    with db.session() as s:
        add_device(s, "d1")
        return create_reservation(s, "d1", "alice", 900)


def test_command_lifecycle(db, settings):
    res = _reserved(db)
    with db.session() as s:
        cmd = create_inspect_command(s, res.id)
        assert (cmd.kind, cmd.status, cmd.device_serial) == ("inspect", "queued", "d1")
    with db.session() as s:
        claimed = claim_command(s, "d1")
        assert claimed.id == cmd.id and claimed.status == "running"
        assert claim_command(s, "d1") is None
    with db.session() as s:
        finish_command(s, cmd.id, ok=True, result_dir=str(settings.path("inspect", cmd.id)))
    with db.session() as s:
        done = s.get(DeviceCommand, cmd.id)
        assert done.status == "done" and done.finished_at is not None


def test_command_needs_active_reservation(db):
    res = _reserved(db)
    with db.session() as s:
        release_reservation(s, res.id)
    with pytest.raises(CommandError), db.session() as s:
        create_inspect_command(s, res.id)


def test_busy_device_does_not_claim_commands(db):
    res = _reserved(db)
    with db.session() as s:
        create_inspect_command(s, res.id)
        s.get(Device, "d1").current_task_id = "some-task"
    with db.session() as s:
        assert claim_command(s, "d1") is None


def test_fail_running_commands(db):
    res = _reserved(db)
    with db.session() as s:
        cmd = create_inspect_command(s, res.id)
    with db.session() as s:
        claim_command(s, "d1")
    with db.session() as s:
        assert fail_running_commands(s) == 1
    with db.session() as s:
        failed = s.get(DeviceCommand, cmd.id)
        assert failed.status == "error" and failed.error_message == "agent restarted"
