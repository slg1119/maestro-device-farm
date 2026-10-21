from dataclasses import dataclass


@dataclass(frozen=True)
class ControlEvent:
    """A control input that reached a device through the live stream."""

    serial: str
    actor: str
    message: dict
    video_size: tuple[int, int]
    ts: str
