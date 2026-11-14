# Troubleshooting

## Before you begin

Keep the API terminal or Compose service running, and copy the exact error code from the UI before changing settings. **adb** is Android Debug Bridge, the tool the agent uses to see devices. The **agent** is the process that runs tests. A **flow** is a YAML test file; a **tag** is a label on that file. An **artifact** is a task output; JUnit is its XML test report. Follow the numbered case matching your symptom.

Use the error message you actually see. The examples below are messages or codes emitted by the current API and CLI. The images show where to look in the English dashboard.

## 1. The dashboard opens, but all devices are offline

The API deliberately reports all devices as offline when the agent heartbeat is missing or stale. Start `farm agent` on the same native data directory, or enable the Compose agent profile only after configuring host adb. Run `adb devices` on the agent host and confirm the intended device is listed as `device`.

![Device status page in the example](../assets/devices.png)

**Screenshot callouts:** (1) Device navigation; (2) device state and model; (3) battery, SDK and tags.

**You should see:** Overview says the agent is healthy and **Device** shows the expected device.

**If it looks different:** If the agent is absent, start it only after confirming its adb server exposes the intended devices.

## 2. Submission says `no_matching_devices`

No available or busy device matches the selector and APK minimum SDK. Check the device list, serial spelling, all requested **device tags**, model, SDK bounds, reservations and disabled state. In the New run form, use the preview count before submitting.

![Device conditions selector marked](../assets/new-run-conditions.png)

**Screenshot callouts:** (1) conditions option; (2) tags/model/SDK inputs; (3) eligible count.

**You should see:** The device selector preview becomes nonzero after a matching device is available.

**If it looks different:** Check SDK bounds, app minimum SDK, serial, model, tags, disabled state, and reservations one at a time.

## 3. Submission says `no_flows` or `flow_not_found`

`no_flows` means no YAML matched the tag filters. Include tags match **any** named flow tag, while exclude tags remove matching flows. `flow_not_found` means an explicit path does not exist relative to the flow root. Open the editor file tree and copy the relative path exactly.

![Flow paths and tags area](../assets/new-run-tags.png)

**Screenshot callouts:** (1) include tags; (2) exclude tags; (3) Specify test file directly.

**You should see:** The flow file appears under **Files**, and its relative path matches the form exactly.

**If it looks different:** Remove tag filters temporarily to test selection; explicit paths bypass tag filtering.

## 4. Workspace registration says `repo_unreachable` or `branch_not_found`

Check the `owner/name`, branch and network access. For private repositories, configure `FARM_GITHUB_TOKEN` or a secure remote transport. The registration command fetches the branch immediately; an invalid path inside the repository does not by itself prevent registration.

![Workspace list and registration area](../assets/workspaces.png)

**Screenshot callouts:** (1) Workspace navigation; (2) Register workspace; (3) workspace row.

**You should see:** The workspace row displays a reachable branch and commit.

**If it looks different:** Check repository spelling, branch, network, and private repository access on the API host.

## 5. A task says `install_failed`, `timeout` or `no_junit`

`install_failed` means the APK could not be installed, often because package/signature, SDK or device storage differ. `timeout` means the task exceeded `FARM_TASK_TIMEOUT_SEC` or its per-run override. `no_junit` means Maestro ended without a usable JUnit report. Inspect the task result and available artifacts, then rerun after correcting the cause. These infrastructure errors can automatically get one retry; assertion failures do not.

![Run detail and task area](../assets/run-detail.png)

**Screenshot callouts:** (1) run status; (2) selected task; (3) task output and Artifacts.

**You should see:** The task detail explains the failure and lists any available artifacts.

**If it looks different:** Check device storage and APK compatibility for install errors; increase a task timeout only after investigating the slow step.

## 6. A live screen does not connect

Check the agent heartbeat and stream port. Native defaults are `127.0.0.1:8701`; Compose uses the internal `agent` hostname. A stream requires a connected device and a running agent.

![Live board filter controls](../assets/live-screen-and-recording.gif)

**Screenshot callouts:** (1) status filter; (2) empty-state message; (3) tile size control.

**You should see:** The live tile connects after agent and device return to available state.

**If it looks different:** Check browser support, agent stream host/port, reservation for control, and device availability.

## Recap

You can match an error to the relevant device, flow, workspace, task, or stream check before trying again.

**Next:** [Run tests](running-tests.md) after fixing the cause.
