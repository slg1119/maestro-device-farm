[English](../host-setup.md) | 한국어

# macOS에서 자동으로 시작하기

이 문서는 [직접 설치](guides/getting-started-native.md)로 API와 agent가 잘 켜지는 것을 확인한 뒤에 사용하세요. **launchd**는 macOS의 서비스 관리자이고, **LaunchAgent**는 로그인한 사용자 계정에서 프로그램을 시작합니다. `ops/launchd/`에는 API와 agent 템플릿이 있습니다. 둘은 같은 데이터 폴더를 사용합니다.

## 설치 전 확인

1. Python 3.12 이상, uv, Java 17 이상, adb, Maestro CLI를 설치하세요. `web/`에서 `pnpm install --frozen-lockfile`, `pnpm build`를 실행해 화면을 빌드하세요. **보여야 할 것:** `web/dist`. **다르다면:** [직접 설치 안내](guides/getting-started-native.md)를 다시 따라 하세요.
2. 저장소의 `server/`에서 `uv run farm doctor`를 실행하세요. **보여야 할 것:** `OK`, `WARN`, `FAIL`이 붙은 점검 줄. **다르다면:** 각 줄의 안내에 따라 도구와 경로를 고치세요.
3. 저장소 맨 위에서 `./ops/launchd/install.sh --dry-run`을 실행하세요. **보여야 할 것:** 두 개의 LaunchAgent XML. 이 단계에서는 설치되거나 시작되지 않습니다. **다르다면:** `uv`, Python, 현재 폴더를 확인하세요.
4. `adb devices`를 실행하세요. **보여야 할 것:** 내가 테스트에 써도 되는 기기만 `device`로 표시됩니다. **다르다면:** agent 설치를 멈추고 기기 연결을 먼저 정리하세요.

## 서비스 설치

저장소 맨 위에서 실행하세요.

```sh
./ops/launchd/install.sh
```

`~/Library/LaunchAgents/io.github.maestro-device-farm.{api,agent}.plist`가 생성되고 서비스가 시작됩니다. 로그는 `~/Library/Logs/maestro-device-farm/`에 저장됩니다. 설치 파일은 소유자만 읽을 수 있게 설정됩니다. 인증 정보가 필요하다면 개인용 서비스 설정에만 넣으세요.

**보여야 할 것:** 두 개의 `Installed:` 줄과 `http://localhost:8700/api/v1/healthz`의 정상 응답. **다르다면:** 위 로그와 `farm doctor` 결과를 확인하세요.

서비스 목록을 보려면 `launchctl list | rg 'io.github.maestro-device-farm'`를 실행하세요. API 설정 파일을 바꾼 뒤 다시 시작하려면 다음과 같이 합니다.

```sh
launchctl bootout "gui/$(id -u)/io.github.maestro-device-farm.api"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.maestro-device-farm.api.plist"
```

agent도 같은 형식이며 이름 끝이 `.agent`입니다. 두 서비스를 지우려면 `./ops/launchd/install.sh --uninstall`을 실행하세요. 데이터 폴더는 지워지지 않습니다. 실제로 지우기 전에 명령을 보려면 `--uninstall --dry-run`을 사용하세요.

## 알아둘 점

현재 구성은 API와 agent가 같은 컴퓨터에서 SQLite DB와 산출물 폴더를 공유한다고 가정합니다. 실시간 화면 서비스 기본 포트는 8701입니다. 서로 다른 컴퓨터에 독립된 저장소를 둔 agent 구성은 지원하지 않습니다.

**정리:** 먼저 `--dry-run`으로 확인하고, 설치 뒤 상태 응답과 로그를 살펴보면 됩니다. **다음:** [기기 연결](guides/connect-a-device.md) 또는 [문제 해결](guides/troubleshooting.md).
