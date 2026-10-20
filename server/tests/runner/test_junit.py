import xml.etree.ElementTree as ET

import pytest

from farm.results import CaseResult
from farm.runner.junit import JunitParseError, merge_junit, parse_junit

MAESTRO_JUNIT = """<?xml version='1.0' encoding='UTF-8'?>
<testsuites>
  <testsuite name="Test Suite" device="R58N" tests="3" failures="1" time="12.3">
    <testcase id="login" name="login" classname="login" time="5.1" status="SUCCESS"/>
    <testcase id="checkout" name="checkout" classname="checkout" time="7.25" status="ERROR">
      <failure>Element not found: Text matching regex: Pay</failure>
    </testcase>
    <testcase id="later" name="later" classname="later" time="0"><skipped/></testcase>
  </testsuite>
</testsuites>
"""


def test_parse_maestro_junit(tmp_path):
    path = tmp_path / "junit.xml"
    path.write_text(MAESTRO_JUNIT)
    assert parse_junit(path) == [
        CaseResult("login", "passed", 5100, None),
        CaseResult("checkout", "failed", 7250, "Element not found: Text matching regex: Pay"),
        CaseResult("later", "skipped", 0, None),
    ]


def test_parse_error(tmp_path):
    path = tmp_path / "junit.xml"
    path.write_text("<testsuites><broken")
    with pytest.raises(JunitParseError):
        parse_junit(path)


def test_missing_file(tmp_path):
    with pytest.raises(JunitParseError):
        parse_junit(tmp_path / "nope.xml")


def test_merge_junit_groups_suites():
    xml = merge_junit([
        ("Pixel 7 (A1)", [CaseResult("login", "passed", 1000), CaseResult("pay", "failed", 500, "boom")]),
        ("Galaxy S23 (B2)", [CaseResult("login", "passed", 2000)]),
    ])
    root = ET.fromstring(xml)
    assert root.tag == "testsuites"
    assert (root.get("tests"), root.get("failures")) == ("3", "1")
    suites = root.findall("testsuite")
    assert [s.get("name") for s in suites] == ["Pixel 7 (A1)", "Galaxy S23 (B2)"]
    pay = suites[0].findall("testcase")[1]
    assert pay.get("name") == "pay" and pay.find("failure").text == "boom"
    assert suites[1].find("testcase").get("time") == "2.000"
