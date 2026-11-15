English | [한국어](../ko/guides/workspaces-and-git.md)

# Workspaces and Git

**What you'll have at the end:** a registered Git workspace whose YAML files and commit history are visible in the dashboard.

## Copy-paste quick path

After your repository contains a committed `.maestro` flow, open:

```text
http://localhost:8700/workspaces
```

Click **Register workspace**, enter `owner/repository`, `main`, and `.maestro`, then click **Register**. The exact fields are explained below.

## Before you begin

A **workspace** is a Git repository, branch, and optional folder of Maestro YAML flows. A **branch** is a named line of history; a **commit** is a saved revision. A run records the commit ID it used. Create a repository with a flow first; [Your first flow](your-first-flow.md) shows how. For private repositories, arrange access on the API host without putting credentials in the repository URL.

## Register a repository

### 1.1 Open the workspace page

Open `http://localhost:8700/workspaces`. **You should see:** **Workspace Management**. **If it looks different:** check the API URL and that it is running.

### 1.2 Open the form

Click **Register workspace**. **You should see:** fields for **name**, **repo**, **branch**, **path**, and **Default app package**.

![Workspace registration form](../assets/workspaces.png)

**Callouts:** (1) **Register workspace**; (2) **repo**; (3) **branch**; (4) **path**; (5) **Register**.

**If it looks different:** use the **Workspace** item in the sidebar first.

### 1.3 Name the workspace

In **name**, type a lowercase label such as `example-app`. **You should see:** the label in the field. **If it looks different:** remove spaces and uppercase characters.

### 1.4 Enter the repo

In **repo**, type `owner/repository` using your actual account and repository name. **You should see:** that short name in the field. **If it looks different:** remove `https://` and `.git` from the value.

### 1.5 Set the branch

In **branch**, type the branch holding your flow, such as `main`. **You should see:** the branch name in the field. **If it looks different:** check the branch name on your Git host.

### 1.6 Set the path

In **path**, type `.maestro` if your flow is in that folder. **You should see:** the relative folder path. **If it looks different:** leave the field empty only if the YAML is at the repository root.

### 1.7 Register

Click **Register**. **You should see:** a new workspace row with a recent commit ID. **If it looks different:** an unreachable repository or missing branch prevents registration; check server access and spelling.

## Inspect and use the workspace

### 2.1 Open the workspace row

Click its row. **You should see:** **Files and recent commits** with the YAML tree.

![Registered workspace details](../assets/workspace-open.png)

**Callouts:** (1) workspace name; (2) branch and commit; (3) visible text **Files and recent commits**.

**If it looks different:** the configured path may be empty; check the repository file location.

### 2.2 Fetch new commits

After pushing a new flow commit, click **Sync** on the workspace. **You should see:** the current commit ID update and new files appear. **If it looks different:** confirm you pushed to the registered branch.

### 2.3 Open the editor

Click **Open editor** on the workspace. **You should see:** a **Files** tree and the flow editor. **If it looks different:** wait for sync to finish, then reopen it.

### 2.4 Inspect history

In the editor, click **History**. **You should see:** commit history for the selected workspace or file. **If it looks different:** select a flow file first.

## Recap

The farm can now pin a Git commit for each run. **Next:** [Edit a flow](flow-editor-and-ai.md) or [run tests](running-tests.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `repo_unreachable` | Repository name, network, or access is wrong | Check `owner/repository` and server-side access |
| `branch_not_found` | Branch does not exist on remote | Enter the branch shown on the Git host |
| Workspace has no files | Path points outside the flow folder | Set **path** to `.maestro` or the actual folder |
| New commit is missing | Workspace has not fetched remote changes | Click **Sync** |
