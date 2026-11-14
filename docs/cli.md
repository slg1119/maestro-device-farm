# CLI reference

A **CLI** (command-line interface) runs commands in a terminal. Open Terminal on macOS, PowerShell on Windows, or your terminal app on Linux. Install [Python 3.12+](https://www.python.org/downloads/) and [uv](https://docs.astral.sh/uv/getting-started/installation/), then clone this repository and change into its `server/` folder. Run `uv sync` once before the commands below. `farm` administers the local server; `farmctl` talks to the HTTP API. An **artifact** is a saved run output, and JUnit is an XML test report format.


Install dependencies in `server/` with `uv sync`, then use `uv run farm` for server administration and `uv run farmctl` for run submission. These commands and flags are taken from the current `--help` output.

## Server administration

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

`farm agent --fake N` runs an in-process simulated provider and runner for development. Do not use it to validate real adb/Maestro execution.

## Submit a run

`farmctl` accepts `--server`, `--token`, and `--user` before the `run` subcommand. Choose one flow source (`--flows` or `--workspace`) and one app source (`--apk` or `--app`). The app library form is `<package>@latest`.

```sh
cd server
uv run farmctl --server http://localhost:8700 --user demo run \
  --workspace example-app --app com.example.app@latest \
  --mode split --include-tags smoke --timeout 1800 --wait \
  --junit ./report.xml
```

Output shape after submission:

```text
run <run-id> submitted: http://localhost:8700/runs/<run-id>
```

The test result sets the process exit code: `0` passed, `1` failed, `2` error, `3` cancelled. `--wait-timeout` defaults to 3600 seconds; stopping the wait does not cancel the run.

| Flag | Meaning |
| --- | --- |
| `--ref` | Branch or commit for a registered workspace. |
| `--mode split\|matrix` | One task per flow, or one task per device. |
| `--flow` | Explicit relative flow path; repeat for several paths. |
| `--device-tags` | Comma separated device tags; a device must have **all** of them. |
| `--serials`, `--models` | Comma separated selectors. |
| `--min-sdk`, `--max-sdk` | Android SDK range. |
| `--include-tags`, `--exclude-tags` | Comma separated flow tags; inclusion matches **any** named tag. |
| `-e`, `--env` | `KEY=VALUE` passed to Maestro; repeatable. Avoid secrets in shell history. |
| `--ci-branch`, `--ci-commit`, `--ci-pr-url`, `--ci-workflow-url` | CI context shown on run detail. |
| `--timeout` | Per-task timeout, seconds. |
| `--wait`, `--wait-timeout`, `--junit` | Wait for completion and optionally save merged JUnit. |

Upload an APK separately with `uv run farmctl apps upload ./app.apk`. The CLI prints the parsed package, version and build ID.

## Confirm the installed commands

1. From `server/`, run `uv run farm --help`. **You should see:** `db`, `token`, `workspace`, `api`, `doctor`, `retention`, and `agent`. **If it looks different:** Run `uv sync` and confirm you are in this repository’s `server/` folder.
2. Run `uv run farmctl run --help`. **You should see:** required `--flows` or `--workspace` and `--apk` or `--app`, plus the flags in the table above. **If it looks different:** Re-run `uv sync` and verify the project version.

**Recap:** Put `--server`, `--token`, and `--user` before `run`; choose one source in each required pair. **Next:** [Run tests](guides/running-tests.md) or [REST API](api.md).
