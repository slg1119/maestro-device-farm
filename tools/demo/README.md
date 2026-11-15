# Demo capture harness

This harness uses only the dedicated `mdf-demo` AVD on `emulator-5560`. It
starts a headless emulator, the API, the real agent, and the built dashboard
with a temporary data directory. The agent supervisor checks the complete
`adb devices` inventory before launch and every half second. If another
device appears, it stops the agent and writes `guard.alert` in the temporary
data directory.

## One session

```sh
pnpm --dir web install --frozen-lockfile
npm ci --prefix tools/demo
python3 tools/demo/manage.py start
python3 tools/demo/manage.py seed
python3 tools/demo/manage.py verify
node tools/demo/capture.mjs --verify-live
node tools/demo/capture.mjs tools/demo/shotlist.example.json /tmp/mdf-captures
python3 tools/demo/manage.py stop
```

Run `stop` even when a capture or verification fails. It terminates the
supervisor, API, and emulator but retains the AVD for the next session. The
state file under `~/.cache/maestro-device-farm-demo/` holds service ports and
the temporary data path. The script never starts the agent when another adb
device is listed.

After merging dashboard or server changes, run `python3 tools/demo/manage.py
refresh` to rebuild and restart the services while retaining the same demo
history. It checks the adb inventory again before restarting the agent.
Set `DEMO_ENABLE_AI=1` for that refresh only when the local Codex CLI is
already authenticated and you need to capture the idle AI panel. The harness
does not send an AI request.
Use `agent-stop` and `agent-start` to capture the dashboard's offline and
connected states without discarding the run history. `agent-start` enforces
the same adb inventory rule as a full start.

`seed` creates a local Git remote with the Android Settings example flows,
registers it as `settings-demo`, and uploads the Settings APK from the demo
emulator. `verify` submits a pinned passing flow and an intentional failure,
then checks state transitions, a failure screenshot, and JUnit output.

## Shot list

Pass a JSON file with `shots` and `gifs` arrays. Each entry has `name` and
`path`; optional fields are `ready` (CSS selector), `waitMs`, `livePixels`,
`callouts` (`selector` and `number`), and `actions` (`click`, `fill` with
`value`, `waitFor`, `waitForReload`, `waitPixels`, or `waitMs`).
`waitForReload` refreshes the page until an agent-offline state appears.
`cleanupActions` runs after a screenshot even if capture fails, so a
reserved demo device is released. GIF entries also accept `seconds`.

Selectors must match the visible dashboard at the 1440 × 900 viewport. The
capture script fails if a selector is missing, a live canvas has no distinct
device pixels, or a GIF reaches 6 MB. GIFs are converted from Playwright
video using an ffmpeg palette at 1200 pixels wide and 12 fps.

`shotlist.json` contains the full documentation capture set. Capture the
connected screenshots and GIFs while the agent runs, then stop only the agent
for the offline screenshots:

```sh
DEMO_CAPTURE_BATCH=connected node tools/demo/capture.mjs tools/demo/shotlist.json docs/assets
DEMO_CAPTURE_BATCH=gifs node tools/demo/capture.mjs tools/demo/shotlist.json docs/assets
python3 tools/demo/manage.py agent-stop
DEMO_CAPTURE_BATCH=offline node tools/demo/capture.mjs tools/demo/shotlist.json docs/assets
```

Set `DEMO_LANG=ko` and change the output directory to `docs/assets/ko` to
capture the Korean set. The script sets the dashboard language and browser
locale in a fresh light-theme context. `DEMO_CAPTURE_NAMES` accepts a
comma-separated list of filenames for a targeted retry. Restart the agent
with `python3 tools/demo/manage.py agent-start` after confirming that
`adb devices` lists only `emulator-5560`.
