[English](../configuration.md) | 한국어

# 설정값 안내

API와 agent는 시작할 때 `FARM_`으로 시작하는 환경 변수를 읽습니다. 값을 바꿨다면 해당 프로그램을 다시 켜야 합니다. Docker Compose에서는 `.env.example`을 `.env`로 복사해 필요한 값만 바꾸세요. 비밀번호 같은 민감한 값은 Git에 올리거나 화면 사진에 담지 마세요. 처음 설정한다면 [Docker](guides/getting-started-docker.md) 또는 [직접 설치](guides/getting-started-native.md) 안내부터 보세요.

| 변수 | 기본값 | 하는 일 |
| --- | --- | --- |
| `FARM_DATA_DIR` | `~/maestro-device-farm/data` | DB·APK·Git 캐시·실행 파일을 저장할 폴더 |
| `FARM_DB_PATH` | 설정 안 함 | SQLite 파일 위치를 따로 지정. API와 agent가 같은 DB를 봐야 함 |
| `FARM_API_HOST` | `0.0.0.0` | API가 접속을 받는 주소 |
| `FARM_API_PORT` | `8700` | API 포트 |
| `FARM_AGENT_STREAM_PORT` | `8701` | agent 화면 서비스 포트 |
| `FARM_AGENT_STREAM_HOST` | `127.0.0.1` | API가 agent 화면 서비스에 접속할 주소 |
| `FARM_AGENT_STREAM_BIND_HOST` | `127.0.0.1` | agent 화면 서비스가 듣는 주소 |
| `FARM_STREAM_MAX_SIZE` | `1280` | 실시간 화면의 최대 크기 |
| `FARM_STREAM_MAX_FPS` | `30` | 실시간 화면의 초당 최대 프레임 |
| `FARM_SCRCPY_SERVER_PATH` | 포함된 `ops/scrcpy/scrcpy-server-v4.1` | 화면 전송용 scrcpy 서버 파일 |
| `FARM_SCRCPY_VERSION` | `4.1` | scrcpy 통신 버전 |
| `FARM_PUBLIC_URL` | `http://localhost:8700` | 실행 결과 링크에 들어갈 공개 주소 |
| `FARM_TASK_TIMEOUT_SEC` | `1800` | 작업 하나의 시간 제한(초) |
| `FARM_RETRY_BACKOFF_SEC` | `15` | 다시 시도하기 전 대기 시간(초) |
| `FARM_MIN_BATTERY` | `20` | 실행 전 요구하는 배터리 잔량(%) |
| `FARM_PINNED_WAIT_SEC` | `600` | 특정 기기에 붙은 작업이 기다릴 수 있는 시간 |
| `FARM_RESERVATION_TTL_SEC` | `900` | 기기 예약 유지 시간 |
| `FARM_MAX_APK_MB` | `500` | APK 업로드 크기 제한(MB) |
| `FARM_MAX_FLOWS_MB` | `50` | flow 압축 파일 제한(MB) |
| `FARM_MAX_MEDIA_MB` | `10` | 에디터 미디어 업로드 제한(MB) |
| `FARM_RETENTION_DAYS` | `30` | 실행 데이터 보관 일수. `0`이면 날짜 기준 정리 안 함 |
| `FARM_APP_KEEP_PER_PACKAGE` | `20` | 패키지별 보관할 최신 APK 수 |
| `FARM_GITHUB_TOKEN` | 설정 안 함 | 비공개 GitHub 저장소에 접근할 때만 사용 |
| `FARM_OPENAI_API_KEY` | 설정 안 함 | OpenAI 공급자를 쓸 때 서버에서 읽는 값 |
| `FARM_OPENAI_MODEL` | `gpt-6.1-sol` | OpenAI 모델 이름 |
| `FARM_AI_PROVIDER` | `auto` | `auto`, `openai`, `codex` 중 선택 |
| `FARM_CODEX_BIN` | `codex` | Codex CLI 실행 파일 경로 |
| `FARM_CODEX_MODEL` | 설정 안 함 | Codex 모델을 따로 고를 때 사용 |
| `FARM_AI_TIMEOUT_SEC` | `300` | AI 작업 시간 제한(초) |
| `FARM_AI_MAX_REPAIRS` | `3` | AI 자동 수정 최대 횟수 |
| `FARM_GIT_BOT_NAME` | `maestro-device-farm` | 에디터 커밋에 쓸 작성자 이름 |
| `FARM_GIT_BOT_EMAIL` | `maestro-device-farm@users.noreply.github.com` | 에디터 커밋에 쓸 이메일 |
| `FARM_GIT_POLL_SEC` | `60` | Git 변경을 확인하는 간격(초). `0`이면 자동 확인 안 함 |
| `FARM_GIT_REMOTE_TEMPLATE` | `https://github.com/{repo}.git` | 저장소 주소 형식. `{repo}`는 `owner/name` |
| `FARM_WEB_DIST` | 저장소의 `web/dist` | API가 제공할 빌드된 화면 폴더 |
| `FARM_REQUIRE_TOKEN` | `false` | 쓰기 요청에 API 토큰을 요구할지 |

아래 값은 API 설정 객체가 아니라 다른 도구에서 읽습니다. `FARM_URL`, `FARM_TOKEN`, `FARM_USER`는 `farmctl` 기본값입니다. `FARM_API_URL`은 Vite 개발 화면의 API 연결 주소, `FARM_HOST_PORT`는 Compose 호스트 포트, `FARM_WORKSPACE`는 예제 CI 워크플로가 쓰는 워크스페이스 이름입니다.

## 값 바꾼 뒤 확인하기

1. API 또는 agent를 다시 켜세요. **보여야 할 것:** `http://localhost:8700/api/v1/healthz`의 `"status":"ok"`. **다르다면:** 방금 바꾼 값의 철자와 형식을 확인하세요.
2. Docker라면 저장소 폴더에서 `docker compose ps`를 실행하세요. **보여야 할 것:** `api`가 `healthy`입니다. **다르다면:** `docker compose logs --tail=100 api`를 확인하세요.

여러 사람이 쓰거나 외부에 공개한다면 `FARM_REQUIRE_TOKEN=true`와 안전한 네트워크 경계를 함께 설정하세요. 기본값은 신뢰할 수 있는 로컬 환경을 위한 것입니다.

**정리:** 서버 설정은 `FARM_` 접두사를 쓰고 다시 켠 뒤 적용됩니다. **다음:** [Docker 운영](docker.md) 또는 [직접 설치](guides/getting-started-native.md).
