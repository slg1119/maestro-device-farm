English | [한국어](../ko/guides/your-first-flow.md)

# Your first Maestro flow

**What you'll have at the end:** one `.yaml` Maestro flow for your Android app, saved in a Git workspace and visible in the browser editor.

## Copy-paste quick path

Copy this text into `.maestro/my-flow.yaml` in a Git repository you control, then replace the package and screen text with your app's values:

```yaml
appId: com.example.app
tags:
  - smoke
---
- launchApp
- assertVisible: "Welcome"
```

Register that repository at `http://localhost:8700/workspaces`.

## Before you begin

Complete a [Docker](getting-started-docker.md) or [native](getting-started-native.md) setup. You need an APK for an app you can test and a Git repository you can edit. A **flow** is a Maestro test file. **YAML** is plain text with indentation-sensitive settings and actions. A **tag** is a label such as `smoke`. A **workspace** connects a Git repository, branch, and optional folder to the farm. The `appId` must match your APK's package name.

## Create the file

### 1.1 Inspect the included example

Open `examples/flows/smoke.yaml` from the cloned project in a plain-text editor. **You should see:** `appId`, `tags`, `---`, `launchApp`, and `assertVisible`. **If it looks different:** confirm you are in this repository's `examples/flows` folder.

### 1.2 Open a new file

In the Git repository you control, click **Add file > Create new file**. **You should see:** a filename box and a plain-text editor. **If it looks different:** use your Git host's file-create action.

### 1.3 Name the file

Type `.maestro/my-flow.yaml` into the filename box. **You should see:** that path above the editor. **If it looks different:** keep the `.yaml` extension and the `.maestro/` folder.

### 1.4 Enter the YAML

Paste the quick-path YAML above into the new file. **You should see:** `appId` above `---` and two commands below it. **If it looks different:** paste into a plain-text editor, not a rich-text document.

### 1.5 Set the package

Replace `com.example.app` with the package shown for your uploaded APK on the **App** page. **You should see:** the first line begin with your package after `appId:`. **If it looks different:** upload the APK first and read its package from the app library.

### 1.6 Set the assertion

Replace `Welcome` with text visible on your app's first screen. **You should see:** `assertVisible` contain that exact text. **If it looks different:** use a stable label that appears after launch; matching is sensitive to the app's language.

### 1.7 Open the Git commit form

Click your Git host's **Commit changes** action. **You should see:** a commit form or confirmation. **If it looks different:** check that the filename and YAML content are filled in.

### 1.8 Save the file in Git

Confirm **Commit changes**. **You should see:** `.maestro/my-flow.yaml` on the repository's `main` branch. **If it looks different:** confirm the branch and that the commit finished. This Git commit is separate from the farm editor's **Commit…** action.

## Register and inspect it

### 2.1 Open Workspace

Open `http://localhost:8700/workspaces`. **You should see:** **Workspace Management** and **Register workspace**. **If it looks different:** check that the API is running.

### 2.2 Start registration

Click **Register workspace**. **You should see:** fields for name, repo, branch, path, and default app package.

![Workspace registration controls](../assets/workspaces.png)

**Callouts:** (1) **Register workspace**; (2) **repo**; (3) **branch**; (4) **path**; (5) **Register**.

**If it looks different:** check [Workspaces and Git](workspaces-and-git.md) for field meanings.

### 2.3 Enter the repository

In **repo**, type its `owner/repository` name. **You should see:** that value in the field. **If it looks different:** enter the short name, not the full HTTPS URL.

### 2.4 Set the flow folder

In **path**, type `.maestro`. **You should see:** the folder path in the field. **If it looks different:** use an empty path only when the YAML file is at the repository root.

### 2.5 Register

Click **Register**. **You should see:** a workspace row with its branch and a commit identifier. **If it looks different:** check repository access, branch spelling, and the location of the YAML file.

### 2.6 Open the editor

Click **Open editor** on that workspace. **You should see:** the **Files** tree containing `my-flow.yaml`.

![New flow open in the editor](../assets/editor-flow.png)

**Callouts:** (1) **Files**; (2) `my-flow.yaml`; (3) **Code**; (4) `appId:`.

**If it looks different:** click **Sync** on the workspace and confirm the file was committed to the branch you registered.

### 2.7 Validate

Click **Validate**. **You should see:** no YAML problems for this simple flow. **If it looks different:** check spaces, quote marks, the `---` separator, and command dashes.

## Recap

Your first flow is in Git and visible in the editor. **Next:** [Run tests](running-tests.md) with a compatible APK and Android device.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `my-flow.yaml` is absent | File was not committed to the registered branch/path | Check `.maestro` and click **Sync** |
| YAML validation fails | Indentation or separator is wrong | Compare with the quick-path block |
| App cannot launch | `appId` differs from APK package | Copy the package from the **App** page |
| Assertion fails | Text does not appear in this app language | Choose a stable, visible label |
