# Screenshot and GIF capture list

Capture the English UI at 1440 × 900 in the light theme unless a guide specifies otherwise. Keep the filenames below. Use sample values that do not identify a person or organization. Draw numbered callouts in the image or key frames; each callout must point to the exact control or state listed. For a GIF, show the final state long enough to read. A sample state does not imply real device execution.

| File in `docs/assets/` | Page / URL | Exact capture state | Numbered callouts | Referenced by |
| --- | --- | --- | --- | --- |
| `hero.gif` | `/` | Open Overview, navigate to Runs, open New run and inspect a run detail | (1) Overview navigation; (2) Runs and New run navigation; (3) run status and tasks | `README.md` |
| `overview.png` | `/` | API ready; Overview shows agent health and summary cards | (1) Overview navigation; (2) agent health indicator; (3) device and run summary cards | `README.md`, `docs/guides/getting-started-native.md` |
| `devices.png` | `/devices` | Device list visible with one clearly labeled sample device state | (1) Device navigation; (2) device state and model; (3) battery, SDK and tags | `README.md`, `docs/guides/troubleshooting.md`, `docs/guides/getting-started-native.md`, `docs/guides/connect-a-device.md` |
| `connect-device.gif` | `/devices` | Move from waiting for an agent heartbeat to a populated device list | (1) Device navigation; (2) agent-connected state; (3) device row and status | `docs/guides/connect-a-device.md` |
| `docker-overview.png` | `/` | Docker API healthy; Overview with agent not yet responding | (1) Overview navigation; (2) agent status; (3) summary cards | `docs/docker.md`, `docs/guides/getting-started-docker.md` |
| `getting-started-docker.gif` | `/` | Open Runs then New run from a Docker-hosted dashboard | (1) Runs navigation; (2) New run action; (3) source form | `docs/guides/getting-started-docker.md` |
| `getting-started-native.gif` | `/` | Open Device from the native dashboard | (1) Overview navigation; (2) Device navigation; (3) device state | `docs/guides/getting-started-native.md` |
| `editor-flow.png` | `/editor/example-app` | Workspace selected; smoke.yaml open in the code editor | (1) Files tree and smoke.yaml; (2) YAML code; (3) Validate control | `docs/guides/your-first-flow.md`, `docs/guides/flow-editor-and-ai.md` |
| `flow-editor.png` | `/editor/example-app` | Workspace flow open with branch/commit and draft controls | (1) workspace and branch context; (2) code editor; (3) Validate and Commit controls | `README.md`, `docs/guides/your-first-flow.md`, `docs/guides/flow-editor-and-ai.md` |
| `your-first-flow.gif` | `/editor/example-app` | Switch between YAML files in one workspace | (1) Files tree; (2) selected YAML file; (3) code pane | `docs/guides/your-first-flow.md` |
| `new-run.png` | `/runs/new` | Registered repository and app build selected | (1) flow source selector; (2) app build selector; (3) Run summary | `docs/guides/running-tests.md` |
| `new-run-matrix.png` | `/runs/new` | Matrix mode selected with device summary visible | (1) Matrix mode card; (2) Split mode card; (3) Run summary | `docs/guides/running-tests.md` |
| `new-run-manual.png` | `/runs/new` | Pick your own device mode with a selected sample serial | (1) Pick your own option; (2) device selector; (3) eligible count | `docs/guides/running-tests.md`, `docs/guides/connect-a-device.md` |
| `new-run-conditions.png` | `/runs/new` | Choose based on conditions with model, tags and SDK visible | (1) conditions option; (2) tags/model/SDK inputs; (3) eligible count | `docs/guides/running-tests.md`, `docs/guides/troubleshooting.md` |
| `new-run-tags.png` | `/runs/new` | Flow tag and explicit path inputs visible | (1) include tags; (2) exclude tags; (3) Specify test file directly | `docs/guides/running-tests.md`, `docs/guides/troubleshooting.md` |
| `running-tests.gif` | `/runs/new` | Select source/app/mode/device and submit to a queued run detail | (1) source and app; (2) device preview; (3) Start run and queued status | `docs/guides/running-tests.md` |
| `runs.png` | `/runs` | Run history with status filter and sample rows | (1) Runs navigation; (2) search or filter; (3) run row and status | `docs/guides/reading-results.md` |
| `run-detail.png` | `/runs/{runId}` | Run detail with task selected and output visible | (1) run status; (2) selected task; (3) task output and Artifacts | `README.md`, `docs/guides/troubleshooting.md`, `docs/guides/reading-results.md` |
| `run-junit.png` | `/runs/{runId}` | Completed run with merged JUnit action | (1) Download JUnit; (2) run status; (3) task list | `docs/guides/reading-results.md` |
| `reading-results.gif` | `/runs` | Open one run and select a task | (1) run row; (2) task selector; (3) task output | `docs/guides/reading-results.md` |
| `live-board.png` | `/live` | Live board empty state with an offline device section and filters visible | (1) Live board navigation; (2) empty state message; (3) tile size and filters | `README.md`, `docs/guides/live-screen-and-recording.md` |
| `live-screen-and-recording.gif` | `/live` | Navigate Live board status filters while the board is empty | (1) status filter; (2) empty-state message; (3) tile size control | `docs/guides/troubleshooting.md`, `docs/guides/live-screen-and-recording.md` |
| `editor-screen.png` | `/editor/example-app` | Editor Screen tab with device picker and reservation state | (1) Screen tab; (2) device picker; (3) Reserve or view-only indicator | `docs/guides/live-screen-and-recording.md` |
| `editor-ai.png` | `/editor/example-app` | AI panel enabled with proposal form, before generation | (1) AI panel; (2) creation mode and path; (3) Generate control | `docs/guides/flow-editor-and-ai.md` |
| `flow-editor-and-ai.gif` | `/editor/example-app` | Open AI panel, enter a description, stop before generation | (1) AI panel; (2) description field; (3) Generate control | `docs/guides/flow-editor-and-ai.md` |
| `workspace-open.png` | `/workspaces` | Registered workspace row expanded | (1) workspace name and branch; (2) current commit; (3) Open editor action | `docs/guides/workspaces-and-git.md` |
| `workspaces.png` | `/workspaces` | Workspace list with registration form or action visible | (1) Workspace navigation; (2) Register workspace; (3) workspace row | `README.md`, `docs/guides/your-first-flow.md`, `docs/guides/troubleshooting.md`, `docs/guides/workspaces-and-git.md` |
| `workspaces-and-git.gif` | `/workspaces` | Open workspace and navigate to editor/history | (1) workspace row; (2) Open editor; (3) history or sync action | `docs/guides/workspaces-and-git.md` |
| `apps.png` | `/apps` | App library with upload action and sample build row | (1) App navigation; (2) Upload APK action; (3) build row | `README.md` |

No additional media filenames are required by the current text. Architecture diagrams are linked as existing HTML references and are outside screenshot capture.
