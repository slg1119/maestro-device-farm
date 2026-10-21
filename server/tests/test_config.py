import os
from pathlib import Path

from farm.config import Settings


def _clear_farm_env(monkeypatch):
    for key in [k for k in os.environ if k.startswith("FARM_")]:
        monkeypatch.delenv(key)


def test_defaults_match_spec(monkeypatch):
    _clear_farm_env(monkeypatch)
    s = Settings()
    assert s.data_dir == Path("~/maestro-device-farm/data").expanduser()
    assert s.database_path == s.data_dir / "farm.db"
    assert (s.api_host, s.api_port) == ("0.0.0.0", 8700)
    assert s.public_url == "http://localhost:8700"
    assert s.task_timeout_sec == 1800
    assert s.retry_backoff_sec == 15
    assert s.min_battery == 20
    assert s.pinned_wait_sec == 600
    assert s.reservation_ttl_sec == 900
    assert (s.max_apk_mb, s.max_flows_mb, s.max_media_mb) == (500, 50, 10)
    assert s.github_token is None
    assert (s.git_bot_name, s.git_bot_email) == ("maestro-device-farm", "maestro-device-farm@users.noreply.github.com")
    assert s.git_poll_sec == 60
    assert s.git_remote_template == "https://github.com/{repo}.git"
    assert s.require_token is False
    assert s.web_dist == Path(__file__).resolve().parents[2] / "web" / "dist"


def test_github_token_is_secret(monkeypatch):
    _clear_farm_env(monkeypatch)
    monkeypatch.setenv("FARM_GITHUB_TOKEN", "github_pat_secret")
    s = Settings()
    assert s.github_token.get_secret_value() == "github_pat_secret"
    assert "github_pat_secret" not in repr(s)


def test_env_overrides(monkeypatch, tmp_path):
    _clear_farm_env(monkeypatch)
    monkeypatch.setenv("FARM_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("FARM_API_PORT", "9000")
    s = Settings()
    assert s.data_dir == tmp_path / "d"
    assert s.api_port == 9000
    assert s.database_path == tmp_path / "d" / "farm.db"


def test_explicit_db_path_wins(settings, tmp_path):
    s = settings.model_copy(update={"db_path": tmp_path / "x.db"})
    assert s.database_path == tmp_path / "x.db"


def test_retry_backoff_env_override(monkeypatch):
    _clear_farm_env(monkeypatch)
    monkeypatch.setenv("FARM_RETRY_BACKOFF_SEC", "3")
    assert Settings().retry_backoff_sec == 3


def test_path_helper(settings):
    assert settings.path("uploads", "r1") == settings.data_dir / "uploads" / "r1"
