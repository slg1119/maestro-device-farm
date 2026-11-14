# Connect an Android device

The farm supports Android emulators and physical Android devices through adb. The agent sees whatever the configured adb server exposes. The screenshots below use **seeded demo serials**; they are not a claim that these devices were connected during capture.

## 1. Choose an emulator or phone

For an emulator, install Android Studio, open **Device Manager**, select **Create Virtual Device**, choose a device and Android system image, and start it. For a phone, open Android settings, tap **Build number** repeatedly to enable Developer options, enable **USB debugging**, connect USB, and accept the RSA authorization prompt on the phone. Use Google's [Android Studio emulator guide](https://developer.android.com/studio/run/emulator) for OS specific installation details.

![The target device list page in the dashboard](../assets/devices.png)

## 2. Verify adb sees the intended device

```sh
adb devices
```

Expected shape (your serial will differ):

```text
List of devices attached
<your-device-serial>    device
```

`unauthorized` means the phone still needs the RSA prompt accepted. `offline` usually means reconnecting USB or restarting adb is needed. Do not proceed until the intended serial says `device`.

![The demo device list, with the page heading marked](../assets/devices.png)

## 3. Start the farm agent

From the native `server/` directory, run `uv run farm agent`. In Docker, first read the [adb networking and agent profile section](../docker.md#3-connect-an-agent). The agent heartbeat makes the device state visible in the dashboard. A connected device should show its model, battery, SDK and tags.

![Device list after the seeded demo heartbeat](../assets/connect-device.gif)

*The GIF scrolls the device page to show where connected devices appear. The listed serials are demo values.*

## 4. Check selection conditions

Open **New run**. Choose all available devices, choose serials directly, or filter by device tags, model and SDK range. The selection preview tells you how many devices match before submission.

![Manual device selection marked](../assets/new-run-manual.png)

A physical Android phone requires a compatible APK and sufficient battery (`FARM_MIN_BATTERY`, default 20%). The farm currently has no iOS execution path.
