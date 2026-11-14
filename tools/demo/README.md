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

`seed` creates a local Git remote with the Android Settings example flows,
registers it as `settings-demo`, and uploads the Settings APK from the demo
emulator. `verify` submits a pinned passing flow and an intentional failure,
then checks state transitions, a failure screenshot, and JUnit output.

## Shot list

Pass a JSON file with `shots` and `gifs` arrays. Each entry has `name` and
`path`; optional fields are `ready` (CSS selector), `waitMs`, `livePixels`,
`callouts` (`selector` and `number`), and `actions` (`click`, `fill` with
`value`, `waitFor`, or `waitMs`). GIF entries also accept `seconds`.
Selectors must match the visible dashboard at the 1440 × 900 viewport. The
capture script fails if a selector is missing, a live canvas has no distinct
device pixels, or a GIF reaches 6 MB. GIFs are converted from Playwright
video using an ffmpeg palette at 1200 pixels wide and 12 fps.
