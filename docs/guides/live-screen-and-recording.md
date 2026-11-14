# Live screen and recording

## Before you begin

Finish [Connect a device](connect-a-device.md) and keep the agent running. Use a recent Chrome or Edge browser for real-time screen viewing. The browser receives a WebSocket stream (a continuing connection for frames and control messages). A **reservation** grants one user temporary control of a device. A **recording** converts permitted interactions into a draft Maestro YAML flow; review the draft before committing it.

Live viewing uses a WebSocket from the browser to the API, then the API to the agent's stream service. It requires a connected Android device and a running agent. The images show the controls and possible empty states; a real screen needs a connected device.

## 1. Open the live board

Click **Live board** in the sidebar. Use the status filters and tile size control to find a connected device. An offline device appears in the collapsed section and cannot show a screen.

![Live board of the dashboard](../assets/live-board.png)

**Screenshot callouts:** (1) Live board navigation; (2) empty state message; (3) tile size and filters.

**You should see:** **Device Live Grid** shows a tile for an available connected device, or an empty-state message.

**If it looks different:** An offline or hidden device cannot stream. Check the agent heartbeat and the **Device** page.

## 2. Open the editor screen panel

Open a workspace in **Editor**, then click the **Screen** tab. Reserve an available device before controlling it. The API issues a short-lived stream ticket for control; a view-only connection does not get the same control ability.

![Screen tab marked in the real editor](../assets/editor-screen.png)

**Screenshot callouts:** (1) Screen tab; (2) device picker; (3) Reserve or view-only indicator.

**You should see:** The editor **Screen** panel shows a device picker and view or control state.

**If it looks different:** Select a workspace first. For control, reserve an available device; view-only access cannot operate it.

## 3. Record interactions

With a connected, reserved device, use the recording controls in the screen panel. Start recording, interact with the device, then stop. The recorder can produce a draft YAML flow for review in the editor. Check the generated actions before committing them to Git.

![Navigating live board filters in the example](../assets/live-screen-and-recording.gif)

**Screenshot callouts:** (1) status filter; (2) empty-state message; (3) tile size control.


If a stream does not open, check agent heartbeat, device state, adb access and the API-to-agent stream address. In Compose, the API uses `FARM_AGENT_STREAM_HOST=agent`; natively both processes default to `127.0.0.1` and port 8701.

**You should see:** **Recording** appears while capture runs; after **Stop recording**, the result includes **Recording YAML** or an editor action.

**If it looks different:** If recording cannot start, check reservation, device availability, and stream connection. Copy and review the YAML before saving.

## Recap

You can locate a live device, tell view-only from control access, and review a recorded YAML draft.

**Next:** [Flow editor and AI](flow-editor-and-ai.md) to review the draft.
