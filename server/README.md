# maestro-device-farm server

`farm-api` (FastAPI) and `farm-agent` share `$FARM_DATA_DIR/farm.db`. Design: `docs/superpowers/specs/2026-10-20-maestro-device-farm-design.md`.

## Setup

```bash
uv sync
uv run farm db upgrade
```

The farm is meant for the internal network, so writes need no token by default. To require one, start
`farm api` with `FARM_REQUIRE_TOKEN=true` and create tokens with `uv run farm token create <name>`.

Workspaces on GitHub can use this host's SSH key instead of a PAT:
`FARM_GIT_REMOTE_TEMPLATE='git@github.com:{repo}.git'` (or a `~/.ssh/config` host alias).

## Run

```bash
uv run farm api                    # http://localhost:8700/api/v1/healthz
uv run farm agent                  # real devices over adb + maestro
uv run farm agent --fake 3         # three simulated devices, no adb needed
```

## Submit a run

```bash
export FARM_URL=http://localhost:8700 FARM_USER=ci   # FARM_TOKEN=<token> only with FARM_REQUIRE_TOKEN=true
uv run farmctl run --flows ../path/to/.maestro --apk app.apk --mode split --wait --junit farm-junit.xml
```

## Tests

```bash
uv run pytest -q
FARM_TEST_APK=/path/to/real.apk uv run pytest tests/apps -q   # also checks androguard on a real APK
```
