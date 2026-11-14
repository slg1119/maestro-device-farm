# REST API

The API is served at `/api/v1`. Open `/docs` for generated FastAPI documentation or `/openapi.json` for the machine-readable contract. The dashboard and API use the same origin. `GET /api/v1/healthz` returns service and agent status; `GET /api/v1/events` is a server-sent event stream. When `FARM_REQUIRE_TOKEN=true`, write requests need `Authorization: Bearer <token>`.

## Create and inspect a run

`POST /api/v1/runs` accepts multipart form data with an `options` JSON string, plus an `apk` or `flows` file only when uploading those sources. This request was exercised against the isolated demo API (port 8711):

```sh
curl -X POST http://127.0.0.1:8711/api/v1/runs \
  -F 'options={"mode":"split","flow_source":"workspace","workspace":"settings-flows","app":"com.android.settings@latest","device_selector":{"serials":["demo-emulator-01"]},"flow_paths":["smoke.yaml"],"origin":"ci"}'
```

```json
{"id":"01M7DPF78XXFDZA0RAHWKVARXW","url":"http://127.0.0.1:8711/runs/01M7DPF78XXFDZA0RAHWKVARXW"}
```

The demo app build and devices were seeded for documentation; this submission remained queued because no execution agent ran. On your own farm, replace the workspace, app and serial values with registered resources.

```sh
curl http://localhost:8700/api/v1/runs
curl http://localhost:8700/api/v1/runs/<run-id>
curl -o report.xml http://localhost:8700/api/v1/runs/<run-id>/junit
curl http://localhost:8700/api/v1/tasks/<task-id>/artifacts
curl -o screenshot.png http://localhost:8700/api/v1/tasks/<task-id>/artifacts/screenshot.png
```

`POST /api/v1/runs/<run-id>/rerun` accepts `{"failed_only":true}`. `POST /api/v1/runs/<run-id>/cancel` requests cancellation. `GET /api/v1/tasks/<task-id>/steps` returns parsed step data when supported artifacts exist.

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
