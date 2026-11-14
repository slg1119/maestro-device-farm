# Getting started natively

## Before you begin

Native means the API, dashboard build, and agent run directly on the computer. Install [Git](https://git-scm.com/downloads), [Python 3.12+](https://www.python.org/downloads/), [uv](https://docs.astral.sh/uv/getting-started/installation/), [Node.js](https://nodejs.org/en/download), and [pnpm](https://pnpm.io/installation). For Android execution also install [Android Studio and SDK Platform Tools](https://developer.android.com/studio), [Java 17+](https://adoptium.net/), and the [Maestro CLI](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli). These pages provide macOS, Windows, and Linux installers; the native agent instructions here cover macOS and Linux. Use Docker Desktop for the API on Windows. Open Terminal on macOS or your terminal app on Linux. A **terminal** is the text window where you paste each command and press Enter.

**adb** (Android Debug Bridge) is the Android tool the agent uses to communicate with devices. An **AVD** (Android Virtual Device) is a saved emulator profile; an **emulator** runs it on your computer. The agent is the process that notices devices and runs Maestro tests. Do not start the agent until you have checked which devices your adb server exposes.

This path runs Python and the web UI on your host. It is the simplest route when adb and an Android emulator already work on your machine. The screenshots show an isolated example; the instructions below start your own instance.

## 1. Install the tools

Install Python 3.12 or newer, [uv](https://docs.astral.sh/uv/getting-started/installation/), Node.js, pnpm, Android SDK platform-tools (`adb`), Java 17+, and [Maestro CLI](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli). Verify:

```sh
python3 --version
uv --version
node --version
pnpm --version
adb version
java -version
maestro --version
```

You should see a version for each command. The project uses `uv` for Python and `pnpm` for the dashboard. This screenshot shows the destination after startup.

**You should see:** Every command prints a version, with Python at least 3.12 and Java at least 17.

**If it looks different:** If one command is missing, finish that tool’s installer and reopen the terminal. On Windows, use the Docker path for the API.

## 2. Install dependencies and build the dashboard

On this repository page, click **Code**, copy its HTTPS URL, and replace `PASTE_REPOSITORY_URL` in the first command before pressing Enter.

```sh
git clone PASTE_REPOSITORY_URL maestro-device-farm
cd maestro-device-farm/server
uv sync
cd ../web
pnpm install --frozen-lockfile
pnpm build
```

A successful web build ends with a build summary and generates `web/dist`. Return to `server/` before the next command.

**You should see:** `uv sync` finishes without an error and `pnpm build` creates `web/dist`.

**If it looks different:** If `pnpm` is missing, install it from the link above. If `uv sync` rejects Python, install Python 3.12+ and rerun.

## 3. Start the API

In terminal A, continue from `web/` after step 2:

```sh
cd ../server
uv run farm api
```

`farm api` applies database migrations and listens on port 8700. Open `http://localhost:8700/` and `http://localhost:8700/api/v1/healthz`. The health JSON should include `"status":"ok"` and may have `"agent":null` at this stage.

![Health and overview navigation in the real dashboard](../assets/overview.png)

**Screenshot callouts:** (1) Overview navigation; (2) agent health indicator; (3) device and run summary cards.

**You should see:** The terminal keeps running; the browser shows **Overview** and `/api/v1/healthz` includes `"status":"ok"`.

**If it looks different:** Keep terminal A open. If port 8700 is busy, stop the conflicting process or change `FARM_API_PORT` and `FARM_PUBLIC_URL` before restarting.

## 4. Connect a device and start the agent

First run `adb devices` and confirm only devices you intend this farm to control are visible. In a new terminal B, open the cloned repository folder first:

```sh
cd maestro-device-farm/server
uv run farm agent
```

The device list should move from offline to available or busy after a heartbeat. The agent may prepare, install APKs, and run Maestro on devices exposed by adb. Use [Connect a device](connect-a-device.md) before this step.

![Device list in the example after a simulated heartbeat](../assets/devices.png)

**Screenshot callouts:** (1) Device navigation; (2) device state and model; (3) battery, SDK and tags.

**You should see:** Only devices you chose appear in adb, then the dashboard **Device** page changes from offline to available after an agent heartbeat.

**If it looks different:** If the list is empty, follow [Connect a device](connect-a-device.md). If an unexpected device appears, do not start the agent.

## 5. Optional web development server

The API already serves `web/dist`. For frontend editing, open terminal C in the repository root, run `cd web && pnpm dev`, and visit `http://localhost:5173/`; Vite proxies `/api` to port 8700. Set `FARM_API_URL` if your API uses another port.

![A live dashboard navigation from the native demo](../assets/getting-started-native.gif)

**Screenshot callouts:** (1) Overview navigation; (2) Device navigation; (3) device state.


**You should see:** Vite displays a local URL ending in `:5173`, and the same dashboard opens there.

**If it looks different:** This is optional for UI development. For normal use, stay on port 8700; it serves the built dashboard.

## Recap

You have a native API and dashboard build. After checking the adb device list, you can start an agent for Android execution.

**Next:** [Your first flow](your-first-flow.md).
