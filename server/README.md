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

## AI

Codex CLI에 로그인돼 있으면 키 없이 켜짐; `FARM_OPENAI_API_KEY`가 있으면 OpenAI 사용.
먼저 호스트에서 `codex login`으로 로그인하고 `codex login status`로 확인합니다.
API 시작 시 공급자를 한 번 선택하고 로그에 표시합니다.

`FARM_AI_PROVIDER=auto`가 기본값이며 `openai` 또는 `codex`로 공급자를 지정할 수 있습니다.
`FARM_CODEX_BIN`은 기본 `codex`, `FARM_CODEX_MODEL`은 미설정 시 Codex 기본 모델,
`FARM_AI_TIMEOUT_SEC`은 기본 300초입니다. OpenAI 모델은 `FARM_OPENAI_MODEL`로 설정합니다.
키도 없고 로그인된 Codex도 없으면 AI가 비활성화됩니다.

`GET /api/v1/ai/status`의 `provider`는 `openai`, `codex` 또는 `null`입니다.
주입한 테스트 클라이언트가 공급자 정보를 제공하지 않으면 `null`로 표시합니다.
Codex는 임시 폴더에서 읽기 전용 샌드박스로 실행되며, 이미지와 스키마는 호출 후 삭제됩니다.
`FARM_*` 환경 변수는 Codex 프로세스에 전달하지 않습니다.

## Tests

```bash
uv run pytest -q
FARM_TEST_APK=/path/to/real.apk uv run pytest tests/apps -q   # also checks androguard on a real APK
```
