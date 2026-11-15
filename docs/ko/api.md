[English](../api.md) | 한국어

# REST API

브라우저뿐 아니라 프로그램에서도 같은 팜을 사용할 수 있습니다. API 기본 경로는 `/api/v1`입니다. GET은 정보를 읽고 POST는 새 작업을 만들거나 상태를 바꿉니다. `http://localhost:8700/docs`를 열면 현재 서버가 제공하는 요청 형식과 응답을 직접 볼 수 있습니다. `FARM_REQUIRE_TOKEN=true`라면 쓰기 요청에 `Authorization: Bearer <token>`이 필요합니다. 먼저 [Docker](guides/getting-started-docker.md) 또는 [직접 설치](guides/getting-started-native.md)로 API를 켜세요.

## 실행 만들기

`POST /api/v1/runs`는 multipart 폼의 `options`에 JSON 문자열을 받습니다. flow ZIP 또는 APK를 바로 올릴 때만 `flows` 또는 `apk` 파일도 보냅니다. 먼저 워크스페이스를 등록하고 APK를 올린 뒤 아래의 `YOUR_WORKSPACE`와 `com.example.app`을 실제 값으로 바꾸세요.

```sh
curl -X POST http://localhost:8700/api/v1/runs \
  -F 'options={"mode":"split","flow_source":"workspace","workspace":"YOUR_WORKSPACE","app":"com.example.app@latest","device_selector":{},"origin":"ci"}'
```

응답에는 실행 ID와 브라우저 링크가 옵니다. 예시는 다음 모양입니다.

```json
{"id":"RUN_ID","url":"http://localhost:8700/runs/RUN_ID"}
```

실제 ID는 다릅니다. 실행을 끝내려면 맞는 기기와 agent가 필요합니다. 토큰 인증을 켰다면 발급한 토큰을 Authorization 헤더에 넣어야 합니다.

## 실행과 파일 읽기

`RUN_ID`와 `TASK_ID`를 내 실행 상세 화면에 적힌 값으로 바꾸세요.

```sh
curl http://localhost:8700/api/v1/runs
curl http://localhost:8700/api/v1/runs/RUN_ID
curl -o report.xml http://localhost:8700/api/v1/runs/RUN_ID/junit
curl http://localhost:8700/api/v1/tasks/TASK_ID/artifacts
curl -o screenshot.png http://localhost:8700/api/v1/tasks/TASK_ID/artifacts/screenshot.png
```

마지막 파일 이름은 실제 산출물 목록에 있는 경로로 바꾸세요. `POST /api/v1/runs/RUN_ID/rerun`에는 `{"failed_only":true}`를 보낼 수 있고, `POST /api/v1/runs/RUN_ID/cancel`은 취소를 요청합니다. `GET /api/v1/tasks/TASK_ID/steps`는 단계 정보를 읽습니다.

## API 종류

| 항목 | 경로와 역할 |
| --- | --- |
| 기기 | `/devices` 목록·수정, 예약·갱신·해제·점검, 기기 명령 조회 |
| 실행 | `/runs` 만들기·목록·상세·취소·다시 실행·JUnit |
| 작업 | `/tasks/{id}/artifacts`, `/steps`, `/artifacts/{path}` |
| 앱 | APK 목록·올리기·수정·다운로드 |
| 워크스페이스 | 등록·목록·동기화·파일·검증·커밋·이력·차이 보기 |
| AI | 상태와 작업 만들기·목록·상세·취소 |
| 실시간 화면·녹화 | 화면 티켓, WebSocket, 녹화 시작·조회·중지·삭제 |
| 상태·이벤트 | `/healthz`, `/events` |

정확한 필수 항목과 응답 형식은 `/docs` 또는 `/openapi.json`을 보세요.

## 처음 확인해 보기

1. 터미널에서 `curl http://localhost:8700/api/v1/healthz`를 실행하세요. **보여야 할 것:** `"status":"ok"`, `agent`, `auth_required`가 있는 JSON. **다르다면:** API와 포트를 확인하세요.
2. 브라우저에서 `http://localhost:8700/docs`를 열고 `GET /api/v1/runs`를 펼치세요. **보여야 할 것:** 요청 항목과 응답 형식. **다르다면:** 상태 확인 주소가 같은 기본 주소에서 열리는지 보세요.

**정리:** 실제 요청 형식은 실행 중인 서버의 `/docs`가 기준입니다. **다음:** [테스트 실행](guides/running-tests.md) 또는 [CLI 안내](cli.md).
