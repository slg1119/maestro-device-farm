import json
import logging
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from farm.ai.client import (
    RESULT_SCHEMA,
    AiProviderError,
    AiRequest,
    ImagePart,
    OpenAiClient,
    TextPart,
    build_ai_client,
)
from farm.ai.codex_client import CodexCliClient
from farm.api.app import create_app
from farm.config import Settings
from tests.fakes import FakeSyntaxChecker
from tests.gitfixtures import FLOW

CODEX = str(Path(__file__).parents[1] / "fakebin" / "codex")
DATA = {"files": [{"path": "login.yaml", "content": FLOW}], "summary": "완료", "assumptions": []}


def entries(fakebin):
    return [json.loads(line) for line in fakebin.log.read_text().splitlines() if json.loads(line)["tool"] == "codex"]


@pytest.fixture
def codex_settings(settings, fakebin, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_LOGIN", "0")
    monkeypatch.setenv("FAKE_CODEX_RESULT", json.dumps(DATA))
    return settings.model_copy(update={"codex_bin": CODEX, "git_poll_sec": 0})


def test_settings_defaults_and_env(monkeypatch, settings):
    defaults = Settings()
    assert (defaults.ai_provider, defaults.codex_bin, defaults.codex_model, defaults.ai_timeout_sec) == (
        "auto", "codex", None, 300)
    monkeypatch.setenv("FARM_AI_PROVIDER", "codex")
    monkeypatch.setenv("FARM_CODEX_BIN", "/test/codex")
    monkeypatch.setenv("FARM_CODEX_MODEL", "test-model")
    monkeypatch.setenv("FARM_AI_TIMEOUT_SEC", "17")
    configured = Settings()
    assert (configured.ai_provider, configured.codex_bin, configured.codex_model, configured.ai_timeout_sec) == (
        "codex", "/test/codex", "test-model", 17)
    with pytest.raises(ValidationError):
        Settings(ai_provider="unknown")


@pytest.mark.parametrize("provider,key,login,binary,expected", [
    ("auto", True, "0", True, OpenAiClient),
    ("auto", True, "1", False, OpenAiClient),
    ("auto", False, "0", True, CodexCliClient),
    ("auto", False, "1", True, None),
    ("auto", False, "0", False, None),
    ("openai", True, "0", True, OpenAiClient),
    ("openai", False, "0", True, None),
    ("codex", True, "0", True, CodexCliClient),
    ("codex", True, "1", True, None),
    ("codex", True, "0", False, None),
    ("codex", False, "0", True, CodexCliClient),
])
def test_selection_matrix(codex_settings, fakebin, monkeypatch, provider, key, login, binary, expected):
    monkeypatch.setenv("FAKE_CODEX_LOGIN", login)
    settings = codex_settings.model_copy(update={
        "ai_provider": provider, "openai_api_key": SecretStr("test-key") if key else None,
        "codex_bin": CODEX if binary else "/missing-test-codex",
    })
    client = build_ai_client(settings)
    try:
        assert type(client) is expected if expected else client is None
        if isinstance(client, OpenAiClient):
            assert client.model == settings.openai_model
        probe = binary and (provider == "codex" or provider == "auto" and not key)
        assert fakebin.calls("codex") == ([["login", "status"]] if probe else [])
    finally:
        if hasattr(client, "close"):
            client.close()


@pytest.mark.parametrize("model,images", [(None, []), ("chosen-model", [b"png-one", b"png-two"])])
def test_exec_argv_prompt_usage_temp_cleanup_and_private_env(codex_settings, fakebin, monkeypatch, model, images):
    monkeypatch.setenv("FARM_OPENAI_API_KEY", "must-not-be-in-child")
    monkeypatch.setenv("FARM_RUN_PASSWORD", "also-private")
    settings = codex_settings.model_copy(update={"codex_model": model})
    client = build_ai_client(settings)
    request = AiRequest("system rules", [TextPart("첫 문장"), *[ImagePart(b, "image/png") for b in images],
                                         TextPart("second text")])
    response = client.complete(request, RESULT_SCHEMA)
    login, call = entries(fakebin)
    root = Path(call["cwd"])
    expected = ["exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
                "--output-schema", str(root / "schema.json"), "-o", str(root / "out.json"), "--json"]
    if model:
        expected += ["-m", model]
    for i in range(len(images)):
        expected += ["-i", str(root / f"image-{i}.png")]
    assert call["argv"] == [*expected, "-"]
    assert call["stdin"] == "system rules\n\n첫 문장\n\nsecond text"
    assert call["schema"] == RESULT_SCHEMA
    assert call["images"] == {str(root / f"image-{i}.png"): b.hex() for i, b in enumerate(images)}
    assert login["farm_env"] == call["farm_env"] == {}
    assert not root.exists()
    assert response.data == DATA and json.loads(response.raw) == DATA
    assert (response.input_tokens, response.output_tokens, response.model) == (
        123, 45, model or "codex (기본 모델)")


@pytest.mark.parametrize("mode", ["fail", "garbage", "hang"])
def test_provider_errors_redact_tail_and_cleanup_process_and_temp(codex_settings, fakebin, monkeypatch, mode):
    monkeypatch.setenv("FARM_TEST_SECRET", "private-farm-value")
    monkeypatch.setenv("FAKE_CODEX_MODE", mode)
    monkeypatch.setenv("FAKE_CODEX_STDERR", "diagnostic private-farm-value test-api-secret test-github-secret")
    settings = codex_settings.model_copy(update={"ai_provider": "codex", "ai_timeout_sec": 0.2,
        "openai_api_key": SecretStr("test-api-secret"), "github_token": SecretStr("test-github-secret")})
    client = build_ai_client(settings)
    with pytest.raises(AiProviderError) as caught:
        client.complete(AiRequest("rules", [TextPart("text"), ImagePart(b"png", "image/png")]), RESULT_SCHEMA)
    message = str(caught.value)
    assert "diagnostic" in message and "[REDACTED]" in message
    assert all(secret not in message for secret in ("private-farm-value", "test-api-secret", "test-github-secret"))
    call = entries(fakebin)[-1]
    assert not Path(call["cwd"]).exists()
    with pytest.raises(ProcessLookupError):
        os.kill(call["pid"], 0)


@pytest.mark.parametrize("result", ["[]", "null", "42"])
def test_non_object_result_is_provider_error(codex_settings, monkeypatch, result):
    monkeypatch.setenv("FAKE_CODEX_RESULT", result)
    with pytest.raises(AiProviderError):
        build_ai_client(codex_settings).complete(AiRequest("rules", []), RESULT_SCHEMA)


@pytest.mark.parametrize("mode", ["pass", "fail", "garbage", "hang"])
def test_api_generate_with_fake_codex(workspace, db, codex_settings, fakebin, monkeypatch, caplog, mode):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"ai_provider": "codex", "codex_bin": CODEX, "codex_model": "test-model",
        "ai_timeout_sec": 1, "github_token": SecretStr("job-private-token")})
    monkeypatch.setenv("FAKE_CODEX_MODE", mode)
    monkeypatch.setenv("FAKE_CODEX_STDERR", "diagnostic job-private-token")
    app = create_app(settings, db=db, syntax_checker=FakeSyntaxChecker())
    with caplog.at_level(logging.INFO, logger="farm.api.app"), TestClient(app) as api:
        status = api.get("/api/v1/ai/status").json()
        assert status["enabled"] is True and status["provider"] == "codex" and status["model"] == "test-model"
        monkeypatch.setenv("FAKE_CODEX_LOGIN", "1")
        assert api.get("/api/v1/ai/status").json()["enabled"] is True
        submitted = api.post("/api/v1/ai/jobs", json={"kind": "generate", "workspace": ws.name,
            "base_sha": ws.head_sha, "target_path": "login.yaml", "prompt": "로그인 테스트"})
        assert submitted.status_code == 201
        assert submitted.json()["model"] == "test-model"
        app.state.ai_runner.pool.shutdown(wait=True)
        detail = api.get(f"/api/v1/ai/jobs/{submitted.json()['id']}").json()
        assert detail["model"] == "test-model"
        assert detail["status"] == ("succeeded" if mode == "pass" else "failed")
        if mode == "pass":
            assert detail["result"]["files"] == DATA["files"]
            assert (detail["input_tokens"], detail["output_tokens"]) == (123, 45)
        else:
            assert "diagnostic" in detail["error_message"]
            assert "job-private-token" not in detail["error_message"]
            assert "[REDACTED]" in detail["error_message"]
    assert sum(call == ["login", "status"] for call in fakebin.calls("codex")) == 1
    logs = [record.getMessage() for record in caplog.records if record.name == "farm.api.app"]
    assert len(logs) == 1 and "codex" in logs[0] and "job-private-token" not in logs[0]


def test_api_disabled_when_binary_missing(settings, db):
    app = create_app(settings.model_copy(update={"codex_bin": "/missing-test-codex", "git_poll_sec": 0}), db=db)
    with TestClient(app) as api:
        status = api.get("/api/v1/ai/status").json()
        assert status["provider"] is None and status["enabled"] is False
