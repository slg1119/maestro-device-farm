# Run tests

**What you'll have at the end:** a run ID and a run detail page showing your flow being executed on an eligible Android device.

## Copy-paste quick path

Open this URL after your workspace, APK, agent, and device are ready:

```text
http://localhost:8700/runs/new
```

Choose a repository, an app build, **Split**, **All available devices**, then **Start run**. The detailed steps below explain each choice.

## Before you begin

Follow [Connect a device](connect-a-device.md) and [Your first flow](your-first-flow.md). An **APK** is the Android installation file. Its package must equal the flow's `appId`. A **workspace** holds versioned YAML flows. A **tag** labels a flow. **Split** makes one task per flow; **Matrix** repeats the selected flow set on each device. A **task** is one unit of work assigned to a device.

## Create the run

### 1.1 Open New run

In the browser, open `http://localhost:8700/runs/new`. **You should see:** **New run** and **Run Settings**. **If it looks different:** start the API and check the URL and port.

### 1.2 Choose the flow source

Under **Where to get test files**, click **registered repository**. **You should see:** a repository selector. **If it looks different:** register a [workspace](workspaces-and-git.md) first. A ZIP upload is a separate option for one-off runs.

### 1.3 Open the repository selector

Click **Choose a repository**. **You should see:** a list of registered workspaces. **If it looks different:** register or sync your workspace.

### 1.4 Choose your repository

Click the workspace containing your flow. **You should see:** its name in the source field and in **Run summary**.

![New run with flow source and app controls](../assets/new-run.png)

**Callouts:** (1) visible text **Choose a repository**; (2) visible text **Choose your app version**; (3) visible text **Run summary**.

**If it looks different:** click **Workspace > Sync** and confirm your `.yaml` file is in its configured path.

### 1.5 Choose the app build

Under **App build**, select the uploaded APK build for the flow's package. **You should see:** the package and version in **Run summary**. **If it looks different:** use **Upload your APK file** or the **App** page to upload a compatible APK.

### 1.6 Choose the mode

Under **Run mode**, click **Split** for your first run. **You should see:** the **Split** card selected. **If it looks different:** **Matrix** runs the selected flow set once on every eligible device.

![Run mode choices](../assets/new-run-matrix.png)

**Callouts:** (1) **Split**; (2) **Matrix**; (3) **Run mode**.

### 1.7 Choose devices

Under **Device to run on**, click **All available devices**. **You should see:** a nonzero eligible device count in **Run summary**. **If it looks different:** return to the [device guide](connect-a-device.md) and check agent health, app minimum SDK, and reservations.

### 1.8 Choose a flow filter

For a first run, leave **Only tests with at least one of these tags** empty. **You should see:** no tag restriction in the summary. **If it looks different:** clear earlier tag entries. Later, enter `smoke` to include flows with that tag; explicit file paths bypass tag filters.

![Flow tag and path inputs](../assets/new-run-tags.png)

**Callouts:** (1) visible text **Only tests with at least one of these tags**; (2) visible text **Tests with this tag are excluded**; (3) visible text **Specify test file directly**.

### 1.9 Start the run

Click **Start run**. **You should see:** a run detail URL ending in `/runs/` and a new ID, initially **Queued** or **Running**.

![Submitting and opening a run](../assets/running-tests.gif)

**Callouts:** (1) visible text **Start run**; (2) new run ID; (3) current run status.

**If it looks different:** read the form error. `no_matching_devices` means the device selector or app SDK rule excluded every device; `no_flows` means no flow matched.

## Optional choices

| Choice | Meaning |
| --- | --- |
| **Matrix** | Every eligible device runs the selected flow set |
| **Pick your own** | Select specific device serials |
| **Choose based on conditions** | Filter by device tags, model, or Android API level |
| **Specify test file directly** | Use an exact path relative to the workspace root instead of tags |
| **Timeout (seconds)** | Override the default per-task timeout of 1800 seconds |

## Recap

You selected a flow source, APK, mode, and device, then started a run. **Next:** [Read run results](reading-results.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No repository in the selector | Workspace not registered or synced | Open **Workspace**, register or sync it |
| No app build | APK has not been uploaded | Use **Upload your APK file** |
| Eligible device count is zero | Agent, SDK, selector, or reservation mismatch | Check **Device** and choose **All available devices** |
| `no_flows` | Tags selected no files | Clear tag filters or inspect the workspace tree |
