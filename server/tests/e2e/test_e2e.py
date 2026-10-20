import xml.etree.ElementTree as ET

import pytest

from farm.cli import farmctl
from tests.factories import flow_yaml, write_flows
from tests.fakes import fake_apk_bytes


@pytest.fixture
def project(tmp_path):
    flows = write_flows(tmp_path / ".maestro", {"login.yaml": flow_yaml("smoke"), "search.yaml": flow_yaml("smoke"),
                                                "checkout.yaml": flow_yaml()})
    apk = tmp_path / "app.apk"
    apk.write_bytes(fake_apk_bytes())
    return flows, apk


def _farmctl(farm, *argv: str) -> int:
    return farmctl.main(["--server", farm.url, "--token", farm.token, *argv])


def test_split_run_end_to_end(live_farm, project, tmp_path, capsys):
    flows, apk = project
    junit = tmp_path / "out" / "junit.xml"
    code = _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--mode", "split", "--wait",
                    "--wait-timeout", "60", "--junit", str(junit))
    assert code == 0
    root = ET.parse(junit).getroot()
    assert (root.get("tests"), root.get("failures")) == ("3", "0")
    out = capsys.readouterr().out
    assert "finished: passed" in out and "  task " in out


def test_failed_flow_exits_1(live_farm, project):
    live_farm.runner.fail_flows = {"checkout"}
    flows, apk = project
    assert _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--wait", "--wait-timeout", "60") == 1


def test_matrix_runs_on_every_device(live_farm, project, tmp_path):
    flows, apk = project
    junit = tmp_path / "matrix.xml"
    assert _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--mode", "matrix",
                    "--include-tags", "smoke", "--wait", "--wait-timeout", "60", "--junit", str(junit)) == 0
    suites = ET.parse(junit).getroot().findall("testsuite")
    assert sorted(s.get("name") for s in suites) == ["Fake Pixel (fake-1)", "Fake Pixel (fake-2)"]
    assert {s.get("tests") for s in suites} == {"2"}


def test_wait_timeout_exits_3(live_farm, project):
    live_farm.runner.delay = 30
    flows, apk = project
    assert _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--flow", "login.yaml", "--wait",
                    "--wait-timeout", "1") == 3
