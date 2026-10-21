import json

from tests.fakes import fake_apk_bytes


def _upload(client, auth, data=b"", **form):
    return client.post("/api/v1/apps", files={"apk": ("app.apk", data or fake_apk_bytes(), "application/octet-stream")},
                       data=form, headers=auth)


def test_upload_list_pin_download(client, auth):
    res = _upload(client, auth, ci_meta=json.dumps({"commit": "abc"}))
    assert res.status_code == 201
    app = res.json()
    assert (app["package_name"], app["ci_meta"], app["uploaded_by"], app["source"]) == (
        "com.example.app", {"commit": "abc"}, "test", "ci")
    again = _upload(client, auth)
    assert again.status_code == 200 and again.json()["id"] == app["id"]
    assert _upload(client, auth, fake_apk_bytes(package="com.other"), source="dashboard").status_code == 201
    assert [a["package_name"] for a in client.get("/api/v1/apps", params={"package": "com.other"}).json()] == ["com.other"]
    assert len(client.get("/api/v1/apps").json()) == 2
    assert client.patch(f"/api/v1/apps/{app['id']}", json={"pinned": True}, headers=auth).json()["pinned"] is True
    assert client.get(f"/api/v1/apps/{app['id']}/download").content == fake_apk_bytes()


def test_upload_errors(client, secured_client, auth):
    res = _upload(client, auth, b"garbage")
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_apk")
    res = _upload(client, auth, ci_meta="{not json")
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_ci_meta")
    assert _upload(secured_client, {}).status_code == 401
    assert client.patch("/api/v1/apps/missing", json={"pinned": True}, headers=auth).status_code == 404
    assert client.get("/api/v1/apps/missing/download").status_code == 404
