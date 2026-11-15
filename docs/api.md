English | [한국어](ko/api.md)

# REST API

The **REST API** lets programs use the same farm as the browser. A URL path after `/api/v1` names a resource; an HTTP method such as GET reads it and POST creates or changes it. Open `http://localhost:8700/docs` for interactive schemas. A **token** is an access credential required for writes only when `FARM_REQUIRE_TOKEN=true`. Start with the [Docker](guides/getting-started-docker.md) or [native](guides/getting-started-native.md) setup so a local API is running.


The API is served at `/api/v1`. Open `/docs` for generated FastAPI documentation or `/openapi.json` for the machine-readable contract. The dashboard and API use the same origin. `GET /api/v1/healthz` returns service and agent status; `GET /api/v1/events` is a server-sent event stream. When `FARM_REQUIRE_TOKEN=true`, write requests need `Authorization: Bearer <token>`.

## Create and inspect a run

`POST /api/v1/runs` accepts multipart form data with an `options` JSON string, plus an `apk` or `flows` file only when uploading those sources. First register a workspace and upload an APK. Then replace `YOUR_WORKSPACE` and `com.example.app` below with your real workspace and APK package:

```sh
curl -X POST http://localhost:8700/api/v1/runs \
  -F 'options={"mode":"split","flow_source":"workspace","workspace":"YOUR_WORKSPACE","app":"com.example.app@latest","device_selector":{},"origin":"ci"}'
```

```json
{"id":"RUN_ID","url":"http://localhost:8700/runs/RUN_ID"}
```

The response above shows the shape; your run ID will differ. The run needs at least one eligible device and a running agent to complete. When token authentication is enabled, add an `Authorization: Bearer` header using a token created by `farm token create`.

Replace `RUN_ID` and `TASK_ID` with IDs from your own run before sending the requests.

```sh
curl http://localhost:8700/api/v1/runs
curl http://localhost:8700/api/v1/runs/RUN_ID
curl -o report.xml http://localhost:8700/api/v1/runs/RUN_ID/junit
curl http://localhost:8700/api/v1/tasks/TASK_ID/artifacts
curl -o screenshot.png http://localhost:8700/api/v1/tasks/TASK_ID/artifacts/screenshot.png
```

`POST /api/v1/runs/RUN_ID/rerun` accepts `{"failed_only":true}`. `POST /api/v1/runs/RUN_ID/cancel` requests cancellation. `GET /api/v1/tasks/TASK_ID/steps` returns parsed step data when supported artifacts exist.

## Endpoint groups

| Resource | Paths |
| --- | --- |
| Devices | `GET /devices`, `PATCH /devices/{serial}`, reservation create/renew/delete/inspect, device command lookup. |
| Runs | `POST /runs`, `GET /runs`, `GET /runs/{id}`, cancel, rerun, JUnit. |
| Tasks | `GET /tasks/{id}/artifacts`, `/steps`, `/artifacts/{path}`. |
| Apps | list, upload, patch, download. |
| Workspaces | list, register, read, edit, delete, sync, tree, file, archive, validate, commit, restore, history, diff. |
| AI | status, create/list/get/cancel jobs. |
| Live and recording | stream ticket, WebSocket stream, recording create/list/get/stop/delete. |
| Events and health | `/events`, `/healthz`. |

The full set of methods and schemas is the generated OpenAPI document. Do not build callers from this summary alone; inspect the corresponding schema for required fields.

## First safe API check

1. In a terminal, run `curl http://localhost:8700/api/v1/healthz`. **You should see:** JSON containing `"status":"ok"`, an `agent` field, and `auth_required`. **If it looks different:** Check that the API is running and that port 8700 is correct.
2. Open `http://localhost:8700/docs` in a browser and expand **GET /api/v1/runs**. **You should see:** parameters and response schema generated from the running server. **If it looks different:** Confirm the same base URL works for the health check.

**Recap:** Use `/docs` or `/openapi.json` for exact request schemas. **Next:** [Run tests](guides/running-tests.md) or [CLI reference](cli.md).
