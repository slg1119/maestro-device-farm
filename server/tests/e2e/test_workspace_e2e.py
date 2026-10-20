import xml.etree.ElementTree as ET

import httpx

from farm.cli import farmctl
from tests.fakes import fake_apk_bytes
from tests.gitfixtures import FLOW, SAMPLE_FILES, make_origin


def test_commit_then_run_from_workspace(live_farm, tmp_path, capsys):
    origin = make_origin(live_farm.remotes, "acme/app", SAMPLE_FILES)
    auth = {"Authorization": f"Bearer {live_farm.token}"}
    with httpx.Client(base_url=live_farm.url, headers=auth, timeout=30) as api:
        ws = api.post("/api/v1/workspaces", json={"name": "app", "repo": "acme/app", "path": ".maestro"}).json()
        commit = api.post("/api/v1/workspaces/app/commits", json={
            "base_sha": ws["head_sha"], "message": "Add checkout", "author": {"name": "Kim", "email": "kim@x.io"},
            "changes": [{"op": "put", "path": "checkout.yaml", "content": FLOW}]})
        assert commit.status_code == 201, commit.text
        sha = commit.json()["sha"]
    assert origin.head() == sha

    apk = tmp_path / "app.apk"
    apk.write_bytes(fake_apk_bytes())
    junit = tmp_path / "junit.xml"
    code = farmctl.main(["--server", live_farm.url, "--token", live_farm.token, "run", "--workspace", "app",
                         "--apk", str(apk), "--mode", "split", "--wait", "--wait-timeout", "60", "--junit", str(junit)])
    assert code == 0
    assert ET.parse(junit).getroot().get("tests") == "3"
    run_id = capsys.readouterr().out.split("run ", 1)[1].split()[0]
    run = httpx.get(f"{live_farm.url}/api/v1/runs/{run_id}").json()
    assert (run["flow_source"], run["workspace_id"], run["commit_sha"]) == ("workspace", ws["id"], sha)
