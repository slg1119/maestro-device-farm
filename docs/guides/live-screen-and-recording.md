English | [한국어](../ko/guides/live-screen-and-recording.md)

# Live screen and recording

**What you'll have at the end:** a live view of a connected Android device and, if you reserve it, a reviewed draft YAML flow from recorded actions.

## Copy-paste quick path

Open the live board:

```text
http://localhost:8700/live
```

Select a connected device, reserve it before controlling it, then use **Start recording** and **Stop recording**.

## Before you begin

Finish [Connect a device](connect-a-device.md), keep the agent running, and use a recent Chrome or Edge browser. A **WebSocket** carries live screen frames. A **reservation** gives one user temporary control of a device. Recording turns interactions into a draft Maestro YAML flow; inspect the YAML before committing it.

## View a device

### 1.1 Open the live board

Open `http://localhost:8700/live`. **You should see:** **Device Live Grid** with a tile for your connected device. **If it looks different:** check the agent heartbeat and device state on **Device**.

![Live board with a connected device tile](../assets/live-board.png)

**Callouts:** (1) **Device Live Grid**; (2) visible emulator serial; (3) **Available** on the tile.

### 1.2 Open the device tile

Click your device tile. **You should see:** a larger live screen view. **If it looks different:** the device may be offline or the browser may not support the stream; see the [troubleshooting guide](troubleshooting.md).

### 1.3 Open the editor

Open `http://localhost:8700/editor` in another browser tab. **You should see:** **Select workspace** or the last workspace. **If it looks different:** register a [workspace](workspaces-and-git.md) first.

### 1.4 Select the workspace

Choose the workspace where the recorded flow should go. **You should see:** its file tree and editor panels. **If it looks different:** sync the workspace from **Workspace**.

### 1.5 Reserve the device in Run

In the editor, open **Run**, select `emulator-5560` (or your own available device), and click **Reserve**. **You should see:** the selected device and a **Release** control. **If it looks different:** check that the agent is running and the device is available.

### 1.6 Open Screen

Click the **Screen** tab. **You should see:** live device pixels and screen controls.

![Editor Screen panel](../assets/editor-screen.png)

**Callouts:** (1) **Screen** tab; (2) live device screen; (3) **Controller** state.

**If it looks different:** select a workspace and wait for its panels to load.

## Record a flow

### 2.1 Confirm control

Check the **Controller** line in **Screen**. **You should see:** your active reservation and the live screen. **If it looks different:** return to **Run** and confirm the reservation.

### 2.2 Start recording

Click **Start recording**. **You should see:** **Recording** and a **Stop recording** control. **If it looks different:** the reservation or stream may have ended.

### 2.3 Perform one action

Tap one safe control on the device screen. **You should see:** the device react and the recording step count change. **If it looks different:** confirm you are the controller, not a view-only viewer.

### 2.4 Stop recording

Click **Stop recording**. **You should see:** **Recording Results** and **Recording YAML**. **If it looks different:** wait for the recording to finish; check the stream connection.

### 2.5 Review the YAML

Open the result's YAML view. **You should see:** Maestro actions for the interaction you made. **If it looks different:** repeat a short recording with a visible tap, then inspect it before saving.

## Recap

You can view a device, reserve control, and turn recorded interactions into a draft. **Next:** [Edit and validate the flow](flow-editor-and-ai.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No device tile | Agent or device is offline | Check **Device** and agent heartbeat |
| Tile will not stream | Browser, stream address, or agent issue | Use Chrome/Edge and inspect agent stream settings |
| **Reserve** is unavailable | Another reservation or device state blocks control | Wait for availability and refresh |
| Recording has no steps | No supported interaction was captured | Record one visible tap and review again |
