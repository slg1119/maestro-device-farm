from fastapi.testclient import TestClient

from farm.api.app import create_app
from tests.fakes import FakeApkParser, FakeSyntaxChecker


def _client(settings, db, dist):
    app = create_app(settings.model_copy(update={"web_dist": dist}), db=db, apk_parser=FakeApkParser(),
                     syntax_checker=FakeSyntaxChecker())
    return TestClient(app)


def test_serves_dashboard_with_spa_fallback(settings, db, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<div id=root></div>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("nope")
    client = _client(settings, db, dist)
    assert client.get("/").text == "<div id=root></div>"
    assert client.get("/runs/abc").text == "<div id=root></div>"
    asset = client.get("/assets/app.js")
    assert asset.text == "console.log(1)" and "immutable" in asset.headers["cache-control"]
    assert client.get("/..%2Fsecret.txt").text == "<div id=root></div>"
    missing_api = client.get("/api/v1/nope")
    assert missing_api.status_code == 404 and missing_api.json()["error"]["code"] in ("not_found", "http_404")
    assert client.get("/api/v1/healthz").json()["status"] == "ok"
    assert client.get("/openapi.json").status_code == 200


def test_without_build_only_api_is_served(settings, db, tmp_path):
    client = _client(settings, db, tmp_path / "missing")
    assert client.get("/").status_code == 404
    assert client.get("/api/v1/healthz").status_code == 200


def test_openapi_declares_bearer_auth(client):
    spec = client.get("/openapi.json").json()
    assert spec["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"
    assert {"HTTPBearer": []} in spec["paths"]["/api/v1/runs"]["post"]["security"]
    assert "security" not in spec["paths"]["/api/v1/runs"]["get"]
