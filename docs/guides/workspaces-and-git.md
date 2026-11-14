# Workspaces and Git

## Before you begin

Install [Git](https://git-scm.com/downloads) and create a Git repository you can access. A **workspace** is this repository plus a branch and optional subfolder containing Maestro YAML flows. A **branch** is a named line of Git history; a **commit** is a saved revision. The farm records a commit identifier for each run so the test source stays traceable. For private repositories, arrange server-side access before registering; do not enter credentials in the repository URL.

A workspace points at a Git repository, branch and optional subdirectory containing Maestro flows. The farm keeps a local cache and records the exact commit SHA used for each run. Your workspace will point to your own Git repository.

## 1. Register a repository

In the dashboard, click **Workspace**, then **Register workspace** and enter a lowercase name, `owner/repository`, branch and optional path. Or use:

```sh
cd server
uv run farm workspace add --name example-app --repo your-account/example-app --branch main --path .maestro --app-package com.example.app
```

Registration fetches the branch to verify it is reachable. The default Git URL is `https://github.com/{repo}.git`; change `FARM_GIT_REMOTE_TEMPLATE` when using another transport. For a private repository, supply `FARM_GITHUB_TOKEN` at runtime or configure your Git transport securely.

![Workspace list and registration area](../assets/workspaces.png)

**Screenshot callouts:** (1) Workspace navigation; (2) Register workspace; (3) workspace row.

**You should see:** The workspace appears in **Workspace Management** with its branch and recent commit.

**If it looks different:** Use the repository `owner/name`, not a full URL. A missing branch or inaccessible repository prevents registration.

## 2. Inspect files and history

Open the workspace row to see its current head, file tree and commit history. A workspace can be synced to fetch a newer branch head. Runs retain their recorded commit SHA even if the workspace moves forward.

![The demo workspace row marked](../assets/workspace-open.png)

**Screenshot callouts:** (1) workspace name and branch; (2) current commit; (3) Open editor action.

**You should see:** **Files and recent commits** shows the YAML tree and commit history.

**If it looks different:** If it is empty, check the path relative to repository root and click **Sync** after pushing new files.

## 3. Edit and commit

Choose **Open editor**, edit a flow, validate it and commit. A browser draft is local to the browser until committed. If the remote branch moves while you edit, fetch the new head and resolve conflicts before committing.

![Opening a workspace from the real list](../assets/workspaces-and-git.gif)

**Screenshot callouts:** (1) workspace row; (2) Open editor; (3) history or sync action.


For a one-off run without a workspace, upload a ZIP of flows in New run or use `farmctl --flows`. Explicit flow paths are relative to the workspace or archive root.

**You should see:** The editor shows a draft, validation feedback, then a new commit after **Commit…**.

**If it looks different:** If the branch changed remotely, use **Fetch** and resolve the displayed conflict before committing.

## Recap

Your workspace points at a Git branch and records a commit for each run; you can sync, edit, and inspect history.

**Next:** [Flow editor and AI](flow-editor-and-ai.md) or [Run tests](running-tests.md).
