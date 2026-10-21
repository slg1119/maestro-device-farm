from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FARM_", validate_default=True)

    data_dir: Path = Path("~/maestro-device-farm/data")
    db_path: Path | None = None
    api_host: str = "0.0.0.0"
    api_port: int = 8700
    agent_stream_port: int = 8701
    stream_max_size: int = 1280
    stream_max_fps: int = 30
    scrcpy_server_path: Path = REPO_ROOT / "ops" / "scrcpy" / "scrcpy-server-v4.1"
    scrcpy_version: str = "4.1"
    public_url: str = "http://localhost:8700"
    task_timeout_sec: int = 1800
    retry_backoff_sec: int = 15
    min_battery: int = 20
    pinned_wait_sec: int = 600
    reservation_ttl_sec: int = 900
    max_apk_mb: int = 500
    max_flows_mb: int = 50
    max_media_mb: int = 10
    github_token: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-6.1-sol"
    ai_max_repairs: int = 3
    git_bot_name: str = "maestro-device-farm"
    git_bot_email: str = "maestro-device-farm@users.noreply.github.com"
    git_poll_sec: int = 60
    git_remote_template: str = "https://github.com/{repo}.git"
    web_dist: Path = REPO_ROOT / "web" / "dist"
    # Internal network only by default: anyone may write. Turn on to demand a token from `farm token create`.
    require_token: bool = False

    @field_validator("data_dir", "db_path", "web_dist", "scrcpy_server_path", mode="after")
    @classmethod
    def _expand_user(cls, value: Path | None) -> Path | None:
        return value.expanduser() if value is not None else None

    @property
    def database_path(self) -> Path:
        return self.db_path or self.data_dir / "farm.db"

    def path(self, *parts: str) -> Path:
        return self.data_dir.joinpath(*parts)
