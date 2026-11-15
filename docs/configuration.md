English | [한국어](ko/configuration.md)

# Configuration reference

A configuration value changes how the API or agent starts. Open Terminal on macOS, PowerShell on Windows, or your terminal app on Linux. A process **environment variable** is a name/value setting the program reads at startup. In Compose, copy `.env.example` to `.env` and edit only the setting you need; on a native host, set the value in the environment used to launch each process. Never paste a real credential into an issue, screenshot, or committed file.


The server uses `pydantic-settings` with the `FARM_` prefix. Set values in the process environment before starting `farm api` or `farm agent`; changes require a restart. Paths expand `~`. Compose loads optional `.env` at runtime. Keep credentials in your local environment or secret manager, never in a flow, screenshot, Git commit, or Docker image.

| Variable | Default | What it controls |
| --- | --- | --- |
| `FARM_DATA_DIR` | `~/maestro-device-farm/data` | SQLite database, APKs, Git cache and run artifacts. |
| `FARM_DB_PATH` | unset (inside data dir) | Override SQLite path. API and agent must use the same database. |
| `FARM_API_HOST` | `0.0.0.0` | API bind address. |
| `FARM_API_PORT` | `8700` | API listening port. |
| `FARM_AGENT_STREAM_PORT` | `8701` | Agent stream service port. |
| `FARM_AGENT_STREAM_HOST` | `127.0.0.1` | Hostname the API uses to reach the agent stream service. |
| `FARM_AGENT_STREAM_BIND_HOST` | `127.0.0.1` | Agent stream service bind address. |
| `FARM_STREAM_MAX_SIZE` | `1280` | Maximum live screen dimension. |
| `FARM_STREAM_MAX_FPS` | `30` | Maximum live screen frame rate. |
| `FARM_SCRCPY_SERVER_PATH` | bundled `ops/scrcpy/scrcpy-server-v4.1` | scrcpy server binary path. |
| `FARM_SCRCPY_VERSION` | `4.1` | scrcpy protocol version. |
| `FARM_PUBLIC_URL` | `http://localhost:8700` | URL embedded in submitted run responses. |
| `FARM_TASK_TIMEOUT_SEC` | `1800` | Timeout in seconds **per task**. |
| `FARM_RETRY_BACKOFF_SEC` | `15` | Delay before automatic retry after an eligible failure. |
| `FARM_MIN_BATTERY` | `20` | Agent precheck battery floor, percent. |
| `FARM_PINNED_WAIT_SEC` | `600` | Wait before a pinned task is considered stuck. |
| `FARM_RESERVATION_TTL_SEC` | `900` | Device reservation lifetime. |
| `FARM_MAX_APK_MB` | `500` | APK upload limit. |
| `FARM_MAX_FLOWS_MB` | `50` | Flow archive upload limit. |
| `FARM_MAX_MEDIA_MB` | `10` | Editor media upload limit. |
| `FARM_RETENTION_DAYS` | `30` | Age limit for retained run data (`0` disables age retention). |
| `FARM_APP_KEEP_PER_PACKAGE` | `20` | Number of recent APK builds kept per package. |
| `FARM_GITHUB_TOKEN` | unset | GitHub token for private workspace access. Supply at runtime. |
| `FARM_OPENAI_API_KEY` | unset | OpenAI provider key, read from the server environment. |
| `FARM_OPENAI_MODEL` | `gpt-6.1-sol` | OpenAI model identifier. |
| `FARM_AI_PROVIDER` | `auto` | `auto`, `openai` or `codex`. |
| `FARM_CODEX_BIN` | `codex` | Codex CLI executable path. |
| `FARM_CODEX_MODEL` | unset | Optional Codex model override. |
| `FARM_AI_TIMEOUT_SEC` | `300` | AI job timeout in seconds. |
| `FARM_AI_MAX_REPAIRS` | `3` | Maximum AI repair attempts. |
| `FARM_GIT_BOT_NAME` | `maestro-device-farm` | Author name on editor commits. |
| `FARM_GIT_BOT_EMAIL` | `maestro-device-farm@users.noreply.github.com` | Author email on editor commits. |
| `FARM_GIT_POLL_SEC` | `60` | Git workspace refresh interval; `0` disables polling. |
| `FARM_GIT_REMOTE_TEMPLATE` | `https://github.com/{repo}.git` | Remote URL template; `{repo}` is `owner/name`. |
| `FARM_WEB_DIST` | repository `web/dist` | Built dashboard directory served by the API. |
| `FARM_REQUIRE_TOKEN` | `false` | Require API tokens for writes. Create one with `farm token create`. |

Other `FARM_` values are **client or packaging inputs**, not `Settings` fields: `FARM_URL`, `FARM_TOKEN`, and `FARM_USER` are `farmctl` defaults; `FARM_API_URL` changes Vite's development proxy; `FARM_HOST_PORT` selects the Compose host port; `FARM_WORKSPACE` is used by the example CI workflow. They are documented in `.env.example`.

For a shared or exposed server, set `FARM_REQUIRE_TOKEN=true`, provide a trusted network boundary, and pass a token through the client settings or `farmctl --token`. The default tokenless mode is meant for a trusted local network.

## Check a setting

1. Change one value and restart the affected API or agent process. **You should see:** `GET /api/v1/healthz` still returns `"status":"ok"`. **If it looks different:** Restore the previous value, check its spelling and type in the table, then restart again.
2. For Compose, run `docker compose ps` from the repository folder. **You should see:** `api` healthy. **If it looks different:** Inspect `docker compose logs --tail=100 api`.

**Recap:** Server settings use the `FARM_` prefix and take effect on restart. **Next:** [Docker operations](docker.md) or [native setup](guides/getting-started-native.md).
