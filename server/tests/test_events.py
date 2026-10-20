from farm.events import emit, events_since, latest_event_id


def test_emit_and_read_since(db):
    with db.session() as s:
        emit(s, "run.updated", {"id": "r1"}, run_id="r1")
        emit(s, "device.updated", {"serial": "d1"})
    with db.session() as s:
        rows = events_since(s, 0)
        assert [r.type for r in rows] == ["run.updated", "device.updated"]
        assert rows[0].payload == {"id": "r1"}
        assert [r.type for r in events_since(s, rows[0].id)] == ["device.updated"]
        assert [r.type for r in events_since(s, 0, run_id="r1")] == ["run.updated"]
        assert latest_event_id(s) == rows[-1].id


def test_latest_event_id_empty(db):
    with db.session() as s:
        assert latest_event_id(s) == 0
