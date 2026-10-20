"""`maestro check-syntax` wrapper. It accepts one file per call and reports `<problem> at /syntax-checker:L:C`."""
import logging
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

log = logging.getLogger(__name__)
ISSUE_RE = re.compile(r"^(?P<message>.+?) at /syntax-checker:(?P<line>\d+):(?P<column>\d+)\s*$")


@dataclass(frozen=True)
class SyntaxIssue:
    message: str
    line: int | None = None
    column: int | None = None


class SyntaxChecker(Protocol):
    def check(self, content: str) -> list[SyntaxIssue]: ...


def parse_issues(output: str) -> list[SyntaxIssue]:
    issues = []
    for line in output.splitlines():
        match = ISSUE_RE.match(line.strip())
        if match:
            issues.append(SyntaxIssue(match["message"], int(match["line"]), int(match["column"])))
    return issues


class MaestroSyntaxChecker:
    def __init__(self, maestro: str = "maestro", timeout: float = 60) -> None:
        self.maestro = maestro
        self.timeout = timeout

    def check(self, content: str) -> list[SyntaxIssue]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "flow.yaml"
            path.write_text(content, encoding="utf-8")
            try:
                proc = subprocess.run([self.maestro, "check-syntax", str(path)], capture_output=True, text=True,
                                      timeout=self.timeout, check=False)
            except FileNotFoundError:
                log.warning("maestro not found; skipping check-syntax")
                return []
            except subprocess.TimeoutExpired:
                return [SyntaxIssue(f"maestro check-syntax timed out after {self.timeout:.0f}s")]
        if proc.returncode == 0:
            return []
        output = f"{proc.stderr}\n{proc.stdout}".strip()
        return parse_issues(output) or [SyntaxIssue(output[-500:] or f"maestro check-syntax exited {proc.returncode}")]
