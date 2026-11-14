# Server

New to terminals? Start with the [native beginner guide](../docs/guides/getting-started-native.md). From a cloned repository, open Terminal on macOS or a terminal app on Linux, change into `server/`, paste each command, and press Enter. The agent is the process that drives Android devices through adb; a JUnit report is XML test output used by CI tools.


The `farm` package contains the FastAPI control plane, SQLite models, scheduler, Android agent, Maestro runner, and two command-line entry points. The API and agent share one data directory. Start with the [root guide](../README.md) for a complete installation, or [Docker Compose](../docs/docker.md) if you do not need a native development environment.

## Install and run

Requirements: Python 3.12 or later, [uv](https://docs.astral.sh/uv/), and, for device execution, adb, Java 17 or later, Maestro CLI, and an Android device or emulator.

```sh
cd server
uv sync
uv run farm db upgrade
uv run farm api
```

The API listens on `http://localhost:8700/` by default. In a second terminal, after verifying that the host adb server exposes only devices intended for this farm, start `uv run farm agent`. For API development without adb, `uv run farm agent --fake 3` creates simulated devices; it does not execute real Maestro flows.

The API and agent must use the same `FARM_DATA_DIR` and database. The default is `~/maestro-device-farm/data`. See [configuration](../docs/configuration.md) for every setting and the stream networking requirements.

## Submit a run

```sh
cd server
uv run farmctl --server http://localhost:8700 --user ci run \
  --flows ../path/to/.maestro --apk ../path/to/app.apk \
  --mode split --wait --junit ./farm-junit.xml
```

`farmctl` also accepts a registered workspace, stored app build, tags, explicit flow paths, and matrix mode. See the [CLI reference](../docs/cli.md) and [REST API reference](../docs/api.md).

When `FARM_REQUIRE_TOKEN=true`, create an API token with `uv run farm token create <name>` and pass it to `farmctl` through `FARM_TOKEN` or `--token`. The default is `false`, which is suitable only on a trusted network.

## Sensitive values in artifacts

After a task, the runner masks run environment values in UTF-8 text artifacts before classifying JUnit and extracting failure context. This includes nested Maestro text output and escaped JSON/XML forms. Empty values and values shorter than four characters are excluded to reduce false positives. Binary screenshots and video are unchanged. When older artifacts are read through the API, masking happens in memory; stored originals are not rewritten. Restrict access to the data directory and avoid passing secrets through browser forms or shell history.

## AI editor

The optional editor assistant selects a provider at API startup. `FARM_AI_PROVIDER=auto` chooses a configured OpenAI key or an authenticated local Codex CLI; `openai` and `codex` select explicitly. Supply `FARM_OPENAI_API_KEY` only to the API process environment, or authenticate the Codex CLI on the API host. `GET /api/v1/ai/status` reports the active provider. The editor returns proposals for review; it does not commit them automatically. See [the editor guide](../docs/guides/flow-editor-and-ai.md).

## Maintenance and development

```sh
cd server
uv run farm doctor
uv run farm retention run --dry-run
uv run pytest -q
uv run ruff check .
```

`farm retention run` applies the configured retention policy; review its dry-run before running it on important data. The agent also schedules retention after startup and periodically. On macOS, [host setup](../docs/host-setup.md) covers the launchd templates. The [example CI workflow](../ops/github-actions/device-farm.yml) shows a run submission.

## Recap and next step

The API serves the dashboard and schedules work; a separate agent performs Android execution using the same data directory. **Next:** [Write a flow](../docs/guides/your-first-flow.md) or [read the CLI reference](../docs/cli.md).
