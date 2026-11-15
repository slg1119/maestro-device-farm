English | [한국어](../ko/guides/reading-results.md)

# Read run results

**What you'll have at the end:** the result of your run, the output of one task, and a downloaded JUnit report when the run has finished.

## Copy-paste quick path

Open the run history:

```text
http://localhost:8700/runs
```

Select your run ID, select a task, then click **Download JUnit** after the run finishes.

## Before you begin

Submit a run using [Run tests](running-tests.md). A **task** is one device assignment. An **artifact** is a saved output file such as a screenshot or log. **JUnit** is an XML test report format used by CI systems. **Queued** means waiting; **Running** means an agent is executing; **Passed**, **Failed**, **Error**, and **Canceled** are final results.

## Inspect your run

### 1.1 Open run history

Open `http://localhost:8700/runs`. **You should see:** **Run history** and a row for your run ID.

![Run history](../assets/runs.png)

**Callouts:** (1) visible text **Run history**; (2) search field; (3) your run row and status.

**If it looks different:** if the list is empty, submit a run first. Search for your run ID if many runs exist.

### 1.2 Open the run

Click your run ID. **You should see:** the run detail with its status and a task list. **If it looks different:** wait for the API to load or confirm the ID in the URL.

### 1.3 Select a task

Click a task row. **You should see:** that task's output, status, and available **Artifacts**.

![Selected task on run detail](../assets/run-detail.png)

**Callouts:** (1) **Failed** in the selected task row; (2) **task output**; (3) **Artifacts**.

**If it looks different:** a queued task has no output yet; check the agent status on **Overview**.

### 1.4 Open an artifact

Under **Artifacts**, click one listed file. **You should see:** the file preview or a browser download. **If it looks different:** some tasks have no screenshot or log; inspect the task status and available filenames.

### 1.5 Download merged JUnit

After the run finishes, click **Download JUnit**. **You should see:** an XML file in your browser's downloads.

![JUnit download on a finished run](../assets/run-junit.png)

**Callouts:** (1) visible text **Download JUnit**; (2) final run status; (3) task list.

**If it looks different:** wait until every task reaches a final state, then retry.

### 1.6 Rerun a failure

For a failed run, click **Rerun failures only**. **You should see:** a new run ID linked to the original run. **If it looks different:** the action is only useful when a task failed or errored. **Rerun** starts the complete selection again.

## Command-line download

Replace `RUN_ID` with the ID shown in the run URL, then run:

```sh
curl -o report.xml http://localhost:8700/api/v1/runs/RUN_ID/junit
```

**You should see:** curl finish and a `report.xml` file containing a `<testsuites` or `<testsuite` element. **If it looks different:** confirm the run ID and that the API is running.

## Recap

You can open history, inspect a task, read artifacts, download JUnit, and rerun failed work. **Next:** [Troubleshooting](troubleshooting.md) if a result needs investigation.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Run row is missing | Search or filter hides it | Search for the exact run ID |
| Task has no output | Task is still queued | Check agent health and wait for execution |
| JUnit download is unavailable | Run has not finished | Wait for every task to reach a final status |
| Rerun action is unavailable | Run state does not allow it | Open a finished run with a failed task |
