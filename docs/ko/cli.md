[English](../cli.md) | 한국어

# CLI 명령 안내

**CLI**는 터미널에 명령을 적어 프로그램을 쓰는 방법입니다. [Python 3.12 이상](https://www.python.org/downloads/)과 [uv](https://docs.astral.sh/uv/getting-started/installation/)를 설치하고, 이 저장소의 `server/`에서 `uv sync`를 한 번 실행하세요. `farm`은 서버와 워크스페이스를 관리하고 `farmctl`은 API로 테스트를 보냅니다. **JUnit**은 XML 테스트 결과 파일입니다.

## 서버 관리

```sh
cd server
uv run farm db upgrade
uv run farm api
uv run farm agent
uv run farm doctor
uv run farm retention run --dry-run
uv run farm token create local-user
uv run farm token list
uv run farm token revoke local-user
uv run farm workspace add --name example-app --repo example-org/example-app --branch main --path .maestro --app-package com.example.app
uv run farm workspace list
uv run farm workspace remove example-app
```

각 줄은 목적에 맞을 때 **하나씩** 실행하세요. `farm api`와 `farm agent`는 계속 실행되므로 서로 다른 터미널이 필요합니다. `farm agent`는 호스트 adb에 보이는 기기를 다룰 수 있으니 [기기 확인](guides/connect-a-device.md)을 먼저 하세요. 개발용 `farm agent --fake N`은 가짜 기기와 실행기를 쓰며 실제 Maestro 실행을 확인하는 용도가 아닙니다.

## 테스트 보내기

`farmctl`은 flow 출처 하나(`--flows` 또는 `--workspace`)와 앱 출처 하나(`--apk` 또는 `--app`)가 필요합니다. `--server`, `--token`, `--user`는 `run` 앞에 둡니다. 아래 저장소와 앱 이름을 내 것으로 바꾸세요.

```sh
cd server
uv run farmctl --server http://localhost:8700 --user demo run \
  --workspace example-app --app com.example.app@latest \
  --mode split --include-tags smoke --timeout 1800 --wait \
  --junit ./report.xml
```

보낸 뒤 출력은 다음 모양입니다.

```text
run <run-id> submitted: http://localhost:8700/runs/<run-id>
```

`--wait`가 끝나면 종료 코드는 통과 0, 테스트 실패 1, 실행 오류 2, 취소 3입니다. `--wait-timeout`의 기본값은 3600초이며 기다리기를 멈춰도 실행 자체를 취소하지 않습니다.

| 옵션 | 뜻 |
| --- | --- |
| `--ref` | 등록한 워크스페이스의 브랜치 또는 커밋 |
| `--mode split\|matrix` | flow마다 하나씩 또는 기기마다 하나씩 작업 만들기 |
| `--flow` | 실행할 상대 경로. 여러 번 쓸 수 있음 |
| `--device-tags` | 기기에 **모두** 있어야 하는 태그 목록 |
| `--serials`, `--models` | 쉼표로 구분한 기기 번호·모델 |
| `--min-sdk`, `--max-sdk` | 안드로이드 SDK 범위 |
| `--include-tags`, `--exclude-tags` | 포함·제외할 flow 태그 목록 |
| `-e`, `--env` | Maestro에 넘길 `KEY=VALUE`. 여러 번 쓸 수 있음 |
| `--ci-branch`, `--ci-commit`, `--ci-pr-url`, `--ci-workflow-url` | CI 기록 정보 |
| `--timeout` | 작업 하나의 시간 제한(초) |
| `--wait`, `--wait-timeout`, `--junit` | 완료 기다리기와 JUnit 저장 |

APK만 먼저 올리려면 `uv run farmctl apps upload ./app.apk`를 쓰세요. CLI가 APK 패키지와 버전, 빌드 ID를 출력합니다.

## 설치 확인

1. `server/`에서 `uv run farm --help`를 실행하세요. **보여야 할 것:** `db`, `token`, `workspace`, `api`, `doctor`, `retention`, `agent`. **다르다면:** `uv sync`를 다시 실행하세요.
2. `uv run farmctl run --help`를 실행하세요. **보여야 할 것:** 필요한 출처와 위 옵션 목록. **다르다면:** 저장소의 `server/`에 있는지 확인하세요.

**정리:** `farm`은 로컬 관리, `farmctl`은 실행 제출에 씁니다. **다음:** [테스트 실행](guides/running-tests.md) 또는 [REST API](api.md).
