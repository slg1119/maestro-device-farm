from datetime import UTC, datetime, timedelta

_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def to_iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime(_FORMAT)


def now() -> str:
    return to_iso(datetime.now(UTC))


def parse(ts: str) -> datetime:
    return datetime.strptime(ts, _FORMAT).replace(tzinfo=UTC)


def shift(ts: str, seconds: float) -> str:
    return to_iso(parse(ts) + timedelta(seconds=seconds))


def age_seconds(ts: str, ref: str | None = None) -> float:
    reference = parse(ref) if ref else datetime.now(UTC)
    return (reference - parse(ts)).total_seconds()
