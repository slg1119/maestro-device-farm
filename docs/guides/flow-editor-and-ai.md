# Flow editor and AI assistant

## Before you begin

Register a [workspace](workspaces-and-git.md). A **flow** is a Maestro YAML test file; YAML is text with indentation-sensitive structure. The editor stores temporary changes in the browser until you commit them to Git. AI assistance is optional. A server-side provider must be enabled before an **AI** panel can generate suggestions. A proposal is editable only after you apply it to the draft.

The editor reads a Git workspace revision, keeps draft changes in your browser, validates YAML and lets you commit reviewed changes. AI is optional. The screenshots show the controls before an AI request is sent.

## 1. Open a workspace file

Click **Editor**, select your workspace, and choose a `.yaml` file in the left file tree. The central pane is a Monaco editor. The top bar shows the branch, short commit SHA and pending change count.

![File tree and YAML code in the editor](../assets/editor-flow.png)

**Screenshot callouts:** (1) Files tree and smoke.yaml; (2) YAML code; (3) Validate control.

**You should see:** The selected flow appears in **Code** with **Files** on the left and branch/commit context in the header.

**If it looks different:** If no files appear, check workspace sync and that the configured path contains `.yaml` files.

## 2. Edit, validate and commit

Change the YAML, click **Validate**, review any problems, then click **Commit**. The editor stores an uncommitted draft in the browser; a Git commit is a separate action. Use the history panel to inspect previous changes.

![Editor with example YAML](../assets/flow-editor.png)

**Screenshot callouts:** (1) workspace and branch context; (2) code editor; (3) Validate and Commit controls.

**You should see:** **Validate** reports problems or success; **Commit…** asks for a commit message before updating Git.

**If it looks different:** Fix YAML errors first. If the remote branch moved, use **Fetch** and resolve the conflict displayed in the editor.

## 3. Enable AI at runtime

Set `FARM_OPENAI_API_KEY` in the **server process environment** and restart the API, or select the Codex CLI provider with `FARM_AI_PROVIDER=codex` if that CLI is installed and already authenticated. The key is read by the server and is not stored in the repository, flow, browser settings or Docker image. In Compose, put the variable in an untracked `.env` or use a secret manager; Compose passes it only at runtime. Never put the key in a command you intend to commit or share.

The AI panel is shown only when the API reports an enabled provider. In automatic mode, a configured OpenAI key is preferred; otherwise an authenticated Codex CLI can be used. The default model setting is `FARM_OPENAI_MODEL=gpt-6.1-sol`.

![AI tab and prompt form in the running editor](../assets/editor-ai.png)

**Screenshot callouts:** (1) AI panel; (2) creation mode and path; (3) Generate control.

**You should see:** The **AI** panel becomes available when `/api/v1/ai/status` reports an enabled provider.

**If it looks different:** If disabled, check the API process environment and restart it. Never put a provider credential in a flow file.

## 4. Review generated suggestions

Click **AI**, choose a new flow or the current file, enter the target path and a specific request, and submit. Screen inclusion and automatic repair require a reserved device; the default text-only request does not. The panel explains that flow text, selected screenshots, hierarchy and failure context may be sent to the provider. Review the suggested diff, apply only the files you want, then validate and commit separately.

![Opening the AI panel without submitting a request](../assets/flow-editor-and-ai.gif)

**Screenshot callouts:** (1) AI panel; (2) description field; (3) Generate control.

**You should see:** A proposal preview shows changed files; applying places reviewed content in the browser draft.

**If it looks different:** If no proposal arrives, read the AI job error. Applying does not commit: validate and commit separately.

## Recap

You can validate a browser draft, review an AI proposal when enabled, and commit only reviewed changes.

**Next:** [Workspaces and Git](workspaces-and-git.md) for sync and history.
