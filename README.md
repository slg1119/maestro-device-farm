# Maestro Device Farm

Run [Maestro](https://maestro.dev/) Android UI tests on a device you control, then see each run in a browser. Maestro Device Farm connects a dashboard, API, test scheduler, and host-side **agent**. The agent is the program that sees Android devices through **adb** (Android Debug Bridge), installs your APK, and starts Maestro. You can begin by opening the dashboard without a device, then connect one when you are ready to run a test.

![Open the dashboard and follow a run](docs/assets/hero.gif)

**Callouts:** (1) **Overview** in the navigation; (2) **Runs** and **New run**; (3) the run status and task area.

## Pick your path

| Your computer and goal | Start here | What starts first |
| --- | --- | --- |
| macOS, Windows, or Linux; easiest first dashboard | [Docker walkthrough](docs/guides/getting-started-docker.md) | API and built dashboard; agent is an optional Compose profile |
| macOS or Linux; you already use Android tools locally | [Native walkthrough](docs/guides/getting-started-native.md) | API and dashboard build, then a host agent when you choose |

For both paths, you need [Git](https://git-scm.com/downloads) to copy the repository and a web browser. Docker users install [Docker Desktop on macOS](https://docs.docker.com/desktop/setup/install/mac-install/) or [Windows](https://docs.docker.com/desktop/setup/install/windows-install/), or [Docker Engine](https://docs.docker.com/engine/install/) and the [Compose plugin](https://docs.docker.com/compose/install/linux/) on Linux. Native users need [Python 3.12+](https://www.python.org/downloads/), [uv](https://docs.astral.sh/uv/getting-started/installation/), [Node.js](https://nodejs.org/en/download), and [pnpm](https://pnpm.io/installation). Android test execution additionally needs a device, APK, and flow. The [device guide](docs/guides/connect-a-device.md) explains the Android tools.

## Five-minute dashboard walkthrough

The **terminal** is the text window where you paste a command and press Enter. Open Terminal on macOS, PowerShell on Windows, or your terminal app on Linux. These steps start the Docker dashboard. If you chose native installation, use the [native guide](docs/guides/getting-started-native.md) instead.

1. On this repository's web page, click **Code** and copy the HTTPS clone URL. In the terminal, replace `PASTE_REPOSITORY_URL` with that URL and run:

   ```sh
   git clone PASTE_REPOSITORY_URL maestro-device-farm
   cd maestro-device-farm
   ```

   **You should see:** Git finishes copying files, and the terminal is in the new `maestro-device-farm` folder. **If it looks different:** Install Git, reopen the terminal, and check that the copied URL is for this repository.

2. Start Docker Desktop, then run:

   ```sh
   docker version
   docker compose version
   ```

   **You should see:** A Docker Client and Server version, plus a Compose version. **If it looks different:** Wait until Docker Desktop says it is running; on Linux start the Docker daemon.

3. Copy the example settings and start the API:

   ```sh
   cp .env.example .env
   docker compose up -d --build
   docker compose ps
   ```

   **You should see:** An `api` service that becomes healthy. The first build may take several minutes. **If it looks different:** Read [Docker troubleshooting](docs/docker.md#troubleshooting) and inspect `docker compose logs --tail=100 api`.

4. Open [http://localhost:8700/](http://localhost:8700/) in a browser. Then run:

   ```sh
   curl http://localhost:8700/api/v1/healthz
   ```

   **You should see:** The **Overview** page and JSON containing `"status":"ok"`. The agent may say it is not responding because you have not started it. **If it looks different:** Check `docker compose ps` and whether another program uses port 8700.

5. Click **Runs**, then **New run**. Look through the flow source, app build, mode, and device controls. You need your own APK and a connected device before submitting a real run. **You should see:** The **Run summary** panel updates as you choose options. **If it looks different:** The [run guide](docs/guides/running-tests.md) describes each field and the required inputs.

To stop the dashboard later, run `docker compose down` in the repository folder. The named data volume remains. The [Docker guide](docs/docker.md) covers starting the optional agent and backing up data.

## Feature tour

| Area | What it is for | View |
| --- | --- | --- |
| **Overview** | Agent health, device counts, and recent work | ![Overview page](docs/assets/overview.png) |
| **Device** | Availability, model, battery, SDK level, tags, and reservations | ![Device page](docs/assets/devices.png) |
| **Runs** | New run, history, task results, and JUnit download | ![Run detail](docs/assets/run-detail.png) |
| **App** | APK build library | ![App library](docs/assets/apps.png) |
| **Workspace** | Git repositories containing flows | ![Workspace list](docs/assets/workspaces.png) |
| **Editor** | YAML flow editing, validation, history, and optional AI proposals | ![Flow editor](docs/assets/flow-editor.png) |
| **Live board** | Connected Android screens and recording controls | ![Live board](docs/assets/live-board.png) |

**Callouts in each tour image:** (1) the page name or selected navigation item; (2) its primary table, form, or panel; (3) its main action or status.

## Learn one task at a time

1. [Get started with Docker](docs/guides/getting-started-docker.md) or [install natively](docs/guides/getting-started-native.md).
2. [Connect an Android device](docs/guides/connect-a-device.md).
3. [Write your first flow](docs/guides/your-first-flow.md).
4. [Run tests](docs/guides/running-tests.md) and [read results](docs/guides/reading-results.md).
5. [View and record a live screen](docs/guides/live-screen-and-recording.md).
6. [Edit a flow and review AI proposals](docs/guides/flow-editor-and-ai.md).
7. [Use Git workspaces](docs/guides/workspaces-and-git.md) or [troubleshoot](docs/guides/troubleshooting.md).

## Core ideas

A **flow** is a YAML text file describing a Maestro test. **YAML** uses indentation to organize its settings and actions. A **tag** is a label used to select flows. A **workspace** is a Git repository, branch, and optional folder containing flows. An **APK** is an Android app installation file. An **AVD** (Android Virtual Device) is a saved profile for an Android **emulator**, the program that runs the virtual device. An **artifact** is an output file such as a screenshot or report. **JUnit** is an XML result format used by test and CI tools.

A **split** run creates a task per selected flow; eligible devices claim those tasks. A **matrix** run creates one task per eligible device and runs the selected flow set on each. The agent and API must share the same SQLite database and data directory. The current runner is Android-specific; iOS execution is not implemented.

A minimal flow for your own app looks like this:

```yaml
appId: com.example.app
tags:
  - smoke
---
- launchApp
- assertVisible: "Welcome"
```

Replace the package and visible text with values from your app. See [Your first flow](docs/guides/your-first-flow.md) before running it. An Android APK with a matching package is required.

## Reference

- [Configuration and environment variables](docs/configuration.md)
- [CLI commands and flags](docs/cli.md)
- [REST API and OpenAPI](docs/api.md)
- [Docker operations](docs/docker.md)
- [macOS launchd services](docs/host-setup.md)
- [Server development](server/README.md) and [dashboard development](web/README.md)
- [System architecture](docs/diagrams/system-architecture.html) and [run lifecycle](docs/diagrams/run-lifecycle.html)

The API is served at `http://localhost:8700/` by default. Its health check is `GET /api/v1/healthz`, and interactive endpoint documentation is at `/docs`. For a shared or exposed installation, review authentication and network settings in [Configuration](docs/configuration.md) before allowing write access.

This project is licensed under [MIT](LICENSE).
