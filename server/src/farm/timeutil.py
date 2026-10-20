from datetime import datetime, timedelta, timezone

_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(_FORMAT)


def now() -> str:
    return to_iso(datetime.now(timezone.utc))


def parse(ts: str) -> datetime:
    return datetime.strptime(ts, _FORMAT).replace(tzinfo=timezone.utc)


def shift(ts: str, seconds: float) -> str:
    return to_iso(parse(ts) + timedelta(seconds=seconds))


def age_seconds(ts: str, ref: str | None = None) -> float:
    reference = parse(ref) if ref else datetime.now(timezone.utc)
    return (reference - parse(ts)).total_seconds()
