# Troubleshooting

Use the error message you actually see. The examples below are messages or codes emitted by the current API and CLI. The demo screenshots show where the relevant controls appear; no physical device was used for them.

## 1. The dashboard opens, but all devices are offline

The API deliberately reports all devices as offline when the agent heartbeat is missing or stale. Start `farm agent` on the same native data directory, or enable the Compose agent profile only after configuring host adb. Run `adb devices` on the agent host and confirm the intended device is listed as `device`.

![Device status page in the seeded demo](../assets/devices.png)

## 2. Submission says `no_matching_devices`

No available or busy device matches the selector and APK minimum SDK. Check the device list, serial spelling, all requested **device tags**, model, SDK bounds, reservations and disabled state. In the New run form, use the preview count before submitting.

![Device conditions selector marked](../assets/new-run-conditions.png)

## 3. Submission says `no_flows` or `flow_not_found`

`no_flows` means no YAML matched the tag filters. Include tags match **any** named flow tag, while exclude tags remove matching flows. `flow_not_found` means an explicit path does not exist relative to the flow root. Open the editor file tree and copy the relative path exactly.

![Flow paths and tags area](../assets/new-run-tags.png)

## 4. Workspace registration says `repo_unreachable` or `branch_not_found`

Check the `owner/name`, branch and network access. For private repositories, configure `FARM_GITHUB_TOKEN` or a secure remote transport. The registration command fetches the branch immediately; an invalid path inside the repository does not by itself prevent registration.

![Workspace list and registration area](../assets/workspaces.png)

## 5. A task says `install_failed`, `timeout` or `no_junit`

`install_failed` means the APK could not be installed, often because package/signature, SDK or device storage differ. `timeout` means the task exceeded `FARM_TASK_TIMEOUT_SEC` or its per-run override. `no_junit` means Maestro ended without a usable JUnit report. Inspect the task result and available artifacts, then rerun after correcting the cause. These infrastructure errors can automatically get one retry; assertion failures do not.

![Run detail and task area](../assets/run-detail.png)

## 6. A live screen does not connect

Check the agent heartbeat and stream port. Native defaults are `127.0.0.1:8701`; Compose uses the internal `agent` hostname. A stream requires a real connected device, not seeded history. The demo GIF shows the board only.

![Live board filter controls](../assets/live-screen-and-recording.gif)

*The GIF shows where a connected device would appear; no live stream was exercised.*
