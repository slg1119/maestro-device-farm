import xml.etree.ElementTree as ET
from pathlib import Path

from farm.results import CaseResult


class JunitParseError(ValueError):
    pass


def _duration_ms(value: str | None) -> int:
    try:
        return int(round(float(value or 0) * 1000))
    except ValueError:
        return 0


def parse_junit(path: Path) -> list[CaseResult]:
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        raise JunitParseError(str(exc)) from exc
    cases = []
    for testcase in root.iter("testcase"):
        name = testcase.get("name") or testcase.get("id") or testcase.get("classname") or "unnamed"
        duration = _duration_ms(testcase.get("time"))
        failure = testcase.find("failure")
        if failure is None:
            failure = testcase.find("error")
        if failure is not None:
            message = (failure.get("message") or failure.text or "").strip() or None
            cases.append(CaseResult(name, "failed", duration, message))
        elif testcase.find("skipped") is not None:
            cases.append(CaseResult(name, "skipped", duration))
        else:
            cases.append(CaseResult(name, "passed", duration))
    return cases


def merge_junit(suites: list[tuple[str, list[CaseResult]]], name: str = "maestro-device-farm") -> str:
    root = ET.Element("testsuites", name=name)
    totals = {"tests": 0, "failures": 0, "skipped": 0, "time": 0.0}
    for suite_name, cases in suites:
        failures = sum(c.status == "failed" for c in cases)
        skipped = sum(c.status == "skipped" for c in cases)
        seconds = sum(c.duration_ms for c in cases) / 1000
        suite = ET.SubElement(
            root, "testsuite", name=suite_name, tests=str(len(cases)), failures=str(failures),
            skipped=str(skipped), time=f"{seconds:.3f}",
        )
        for case in cases:
            element = ET.SubElement(
                suite, "testcase", name=case.name, classname=suite_name, time=f"{case.duration_ms / 1000:.3f}"
            )
            if case.status == "failed":
                failure = ET.SubElement(element, "failure", message=(case.failure_message or "failed")[:500])
                failure.text = case.failure_message or ""
            elif case.status == "skipped":
                ET.SubElement(element, "skipped")
        totals["tests"] += len(cases)
        totals["failures"] += failures
        totals["skipped"] += skipped
        totals["time"] += seconds
    root.set("tests", str(totals["tests"]))
    root.set("failures", str(totals["failures"]))
    root.set("skipped", str(totals["skipped"]))
    root.set("time", f"{totals['time']:.3f}")
    return ET.tostring(root, encoding="unicode", xml_declaration=True)
