from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FARM_", validate_default=True)

    data_dir: Path = Path("~/maestro-device-farm/data")
    db_path: Path | None = None
    api_host: str = "0.0.0.0"
    api_port: int = 8700
    public_url: str = "http://localhost:8700"
    task_timeout_sec: int = 1800
    retry_backoff_sec: int = 15
    min_battery: int = 20
    pinned_wait_sec: int = 600
    reservation_ttl_sec: int = 900
    max_apk_mb: int = 500
    max_flows_mb: int = 50

    @field_validator("data_dir", "db_path", mode="after")
    @classmethod
    def _expand_user(cls, value: Path | None) -> Path | None:
        return value.expanduser() if value is not None else None

    @property
    def database_path(self) -> Path:
        return self.db_path or self.data_dir / "farm.db"

    def path(self, *parts: str) -> Path:
        return self.data_dir.joinpath(*parts)
