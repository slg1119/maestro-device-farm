from farm import timeutil
from farm.ids import new_id


def test_now_format_round_trips():
    ts = timeutil.now()
    assert ts.endswith("Z") and len(ts) == 27
    assert timeutil.to_iso(timeutil.parse(ts)) == ts


def test_shift_and_string_ordering():
    base = "2026-10-20T00:00:00.000000Z"
    later = timeutil.shift(base, 90)
    assert later == "2026-10-20T00:01:30.000000Z"
    assert base < later
    assert timeutil.shift(base, -1) < base


def test_age_seconds():
    assert timeutil.age_seconds("2026-10-20T00:00:00.000000Z", ref="2026-10-20T00:00:10.000000Z") == 10


def test_new_id_is_unique_ulid():
    ids = {new_id() for _ in range(100)}
    assert len(ids) == 100
    assert all(len(i) == 26 for i in ids)
