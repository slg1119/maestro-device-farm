# maestro-device-farm server

`farm-api` (FastAPI) and `farm-agent` share `$FARM_DATA_DIR/farm.db`. Design: `docs/superpowers/specs/2026-10-20-maestro-device-farm-design.md`.

## Setup

```bash
uv sync
uv run farm db upgrade
uv run farm token create ci        # prints the token once
```

## Run

```bash
uv run farm api                    # http://localhost:8700/api/v1/healthz
uv run farm agent                  # real devices over adb + maestro
uv run farm agent --fake 3         # three simulated devices, no adb needed
```

## Submit a run

```bash
export FARM_URL=http://localhost:8700 FARM_TOKEN=<token>
uv run farmctl run --flows ../path/to/.maestro --apk app.apk --mode split --wait --junit farm-junit.xml
```

## Tests

```bash
uv run pytest -q
FARM_TEST_APK=/path/to/real.apk uv run pytest tests/apps -q   # also checks androguard on a real APK
```
