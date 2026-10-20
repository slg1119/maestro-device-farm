from dataclasses import dataclass, field
from typing import Literal

CaseStatus = Literal["passed", "failed", "skipped"]
TaskStatus = Literal["passed", "failed", "error", "cancelled"]


@dataclass(frozen=True)
class CaseResult:
    name: str
    status: CaseStatus
    duration_ms: int = 0
    failure_message: str | None = None


@dataclass
class TaskOutcome:
    status: TaskStatus
    exit_code: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    cases: list[CaseResult] = field(default_factory=list)
