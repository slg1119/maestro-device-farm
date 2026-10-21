# 디바이스 팜 Mac 준비

팜 API와 agent는 같은 사용자, 같은 `FARM_DATA_DIR`을 사용합니다. 기본 데이터 경로는
`~/maestro-device-farm/data`이며 API 포트는 8700입니다. launchd는 로그인한 사용자의 LaunchAgent로 실행됩니다.

## Mac과 USB

전원 어댑터와 전원이 공급되는 USB 허브를 연결합니다. 여러 기기를 동시에 스트리밍할 수 있도록
USB 대역폭과 케이블 상태를 확인하세요. 배터리 충전 상태도 주기적으로 확인합니다.

시스템 설정에서 자동 업데이트 후 자동 재시작을 끄고, 운영 시간을 피해 직접 업데이트합니다.
전원 연결 중 잠자기를 끄려면 운영자가 다음 명령을 실행합니다.

```sh
sudo pmset -c sleep 0 disksleep 0
pmset -g
```

화면만 꺼지는 설정은 유지할 수 있습니다. Mac은 로그인 상태로 두고 기기/USB 연결이 끊기지 않는지 확인합니다.

## Android 기기

개발자 옵션과 USB 디버깅을 켜고 이 Mac의 RSA 키를 **항상 허용**합니다. 화면 잠금을 없애고,
테스트 도중 동작이 바뀌지 않도록 앱과 OS 자동 업데이트를 끕니다. 개발자 옵션에서 충전 중 화면 켜짐을 설정합니다.
`adb devices -l`에서 각 기기가 `device`인지 확인합니다. `unauthorized`이면 기기 화면의 허용 창을 확인하세요.

## 도구와 GitHub 접근

Python 3.12 이상, uv, Node.js와 pnpm, Android platform-tools(adb), Java와 Maestro를 설치합니다.
실시간 화면은 저장소의 `ops/scrcpy/scrcpy-server-v4.1`을 사용합니다. `farm doctor`로 도구 버전을 확인할 수 있습니다.

GitHub 저장소는 Mac 사용자의 SSH 키로 접근할 수 있습니다.

```sh
export FARM_GIT_REMOTE_TEMPLATE='git@github.com:{repo}.git'
```

또는 봇 계정의 fine-grained PAT를 `FARM_GITHUB_TOKEN`에 설정합니다. 대상 저장소의 Contents read/write를
허용하고, 에디터에서 커밋을 push할 브랜치의 보호 규칙과 봇 권한을 확인하세요. PAT를 저장소에 기록하지 않습니다.
SSH를 쓴다면 비대화식 launchd 환경에서도 키에 접근할 수 있어야 합니다. 키 암호나 최초 호스트 확인 창이 뜨지 않도록 미리 점검합니다.

## AI

팜을 실행할 사용자로 `codex login`을 실행하고 `codex login status`를 확인하면 API 키 없이 AI가 켜집니다.
`FARM_OPENAI_API_KEY`가 있으면 OpenAI를 사용합니다. 제공자를 고정하려면 `FARM_AI_PROVIDER=codex` 또는
`openai`를 설정합니다. OpenAI는 콘솔에서 사용 한도를 설정하세요. Codex가 launchd의 PATH에도 있어야 합니다.
키나 로그인 토큰은 로그와 저장소에 남기지 않습니다.

## 최초 실행

저장소 루트에서 다음을 실행합니다.

```sh
cd server
uv sync
uv run farm db upgrade
cd ../web
pnpm install --frozen-lockfile
pnpm build
cd ../server
uv run farm doctor
uv run farm api
# 별도 터미널, 같은 server 디렉터리에서
uv run farm agent
```

대시보드에서 기기를 확인한 뒤 워크스페이스를 등록하고 작은 flow를 먼저 실행합니다. API와 agent는 같은
`FARM_DATA_DIR`, GitHub 접근 설정을 사용해야 합니다. API 기본 주소는 `http://localhost:8700`입니다.

## launchd 설치와 해제

먼저 저장소 루트에서 `ops/launchd/install.sh --dry-run`으로 렌더링된 plist 두 개를 확인합니다.
dry-run은 파일을 쓰거나 launchctl을 호출하지 않습니다.

```sh
ops/launchd/install.sh
# 해제
ops/launchd/install.sh --uninstall
```

설치 경로는 `~/Library/LaunchAgents/io.github.maestro-device-farm.{api,agent}.plist`입니다. `KeepAlive`와 `RunAtLoad`로
로그인 시 실행하고 종료되면 다시 실행합니다. 템플릿은 `__REPO__`, `__UV__`, `__HOME__`를 실제 경로로 바꿉니다.
설치 전에 `uv`가 PATH에 있어야 합니다. PATH에는 Homebrew, `~/.local/bin`, `~/.maestro/bin`이 포함됩니다.
도구를 다른 위치에 설치했다면 설치된 두 plist의 PATH를 수정하세요.

셸의 export 값은 LaunchAgent에 자동으로 전달되지 않습니다. 필요한 `FARM_DATA_DIR`, GitHub, AI 설정은
두 plist의 `EnvironmentVariables`에 추가하세요. 템플릿에 주석 예제가 있습니다. 비밀값을 넣은 plist는
`chmod 600`으로 보호합니다. 설치 스크립트를 다시 실행하면 plist가 덮어써지므로 설정을 안전한 곳에 보관하세요.
설정을 수정한 뒤 각 서비스에 아래 명령을 실행합니다.

```sh
launchctl bootout "gui/$(id -u)/io.github.maestro-device-farm.api"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.maestro-device-farm.api.plist"
launchctl bootout "gui/$(id -u)/io.github.maestro-device-farm.agent"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.maestro-device-farm.agent.plist"
```

## 점검, 로그와 보관

`cd server && uv run farm doctor`는 도구, scrcpy jar, DB 마이그레이션, GitHub/PAT와 워크스페이스 원격,
AI, DB 기기 상태, agent heartbeat, 데이터 디스크 여유 공간을 한 줄씩 출력합니다. `FAIL`이 하나라도 있으면
종료 코드 1이고 `WARN`만 있으면 0입니다. 기기 상태는 DB에 기록된 값이므로 agent가 실행 중인지 함께 확인하세요.

로그는 `~/Library/Logs/maestro-device-farm/{api,agent}.log`와 `{api,agent}-error.log`에 있습니다.
데이터 디렉터리에는 `farm.db`, `git/`, `apks/`, `uploads/`, `runs/`, `inspect/`, `ai/`가 있습니다.
launchd 로그는 보관 정리 대상이 아니므로 운영 정책에 따라 별도로 순환하세요.

agent는 시작 60초 후, 이후 24시간마다 보관 정리를 실행합니다. 실패는 agent 로그에 남고 다음 주기에 재시도합니다.
수동 정리는 `uv run farm retention run`으로 실행하며 삭제 수를 출력합니다.
먼저 `uv run farm retention run --dry-run`으로 범주별 정리 예정 수와 삭제 예정 경로(최대 50줄)를
확인할 수 있습니다. 미리보기는 파일과 DB 행을 변경하지 않습니다.

| 대상 | 정책 |
|---|---|
| 완료 run의 산출물과 업로드 스냅샷 | `FARM_RETENTION_DAYS=30`일 초과, DB 이력 유지 |
| 패키지별 APK | 최신 `FARM_APP_KEEP_PER_PACKAGE=20`개와 pinned, 미정리 run 참조 빌드 유지 |
| inspect 결과 | 1일 초과 |
| events | 7일 초과 |
| 만료 stream ticket | 만료 후 1일 초과 |
| AI 작업 프롬프트·응답 원문 | 30일 초과, 토큰 수와 결과 요약 유지 |

두 설정은 0 이상의 정수입니다. 0은 완료 run을 바로 정리하거나 최신 APK 보호 개수를 없애는 값이며,
pinned와 미정리 run의 APK 보호는 유지합니다. 정리는 멱등적이며 실제 파일 삭제 중에는 DB 트랜잭션을 잡지 않습니다.

## 업그레이드와 CI

진행 중인 run이 끝난 뒤 agent/API를 bootout하고, 데이터 경로 전체와 운영용 plist를 백업합니다.
소스를 업데이트한 뒤 `server/`에서 `uv sync`, `uv run farm db upgrade`, `web/`에서
`pnpm install --frozen-lockfile && pnpm build`를 실행합니다. 두 서비스를 다시 bootstrap하고 `farm doctor`를 확인하세요.

팜 Mac에 GitHub Actions self-hosted runner를 설치하고 `device-farm` 라벨을 추가합니다. runner 사용자에게
`farmctl` 실행 경로와 팜 접근 권한이 있어야 합니다. `uv tool install ./server`로 CLI를 설치하거나
팜의 `server/.venv/bin`을 runner PATH에 추가하세요. `ops/github-actions/device-farm.yml`은
호스팅 runner에서 APK를 빌드한 뒤 Mac runner에서 실행하고 JUnit을 게시하는 예제입니다.
저장소 변수 `FARM_WORKSPACE`를 팜에 등록된 이름으로 설정하고 Android 빌드 경로를 프로젝트에 맞추세요.
워크스페이스 원격 저장소에 `$GITHUB_SHA`가 있어야 합니다. 토큰 인증을 켠 팜은 runner에 `FARM_TOKEN`도 설정합니다.
