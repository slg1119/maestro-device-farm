English | [한국어](ko/host-setup.md)

# macOS launchd service setup

This page is for macOS after the [native setup](guides/getting-started-native.md) works interactively. **launchd** is the macOS service manager; a **LaunchAgent** starts a process for your signed-in user. The API and agent templates share one data directory. Open Terminal in the repository root before using the commands. The agent can access every device visible to its adb (Android Debug Bridge) server.


The two templates in `ops/launchd/` install the API and agent as **user LaunchAgents** with labels `io.github.maestro-device-farm.api` and `io.github.maestro-device-farm.agent`. They use the current repository path and `uv` executable found by `install.sh`. The default data directory remains `~/maestro-device-farm/data`, and API port 8700 is the default unless `FARM_*` variables are set in the installed plist.

## Before installation

1. Install Python 3.12+, uv, Java 17+, adb and Maestro CLI. From the repository root, build the dashboard with `cd web && pnpm install --frozen-lockfile && pnpm build`. **You should see:** a successful build and `web/dist`. **If it looks different:** follow the linked installers in the [native guide](guides/getting-started-native.md).
2. From the repository root, run `cd server && uv run farm doctor` and check the reported host requirements. **You should see:** checks labeled `OK`, `WARN`, or `FAIL`. **If it looks different:** read each failing check's hint and rerun after fixing the tool or path.
3. Return to the repository root and run `./ops/launchd/install.sh --dry-run` to inspect the rendered plists. This does **not** install or start services. **You should see:** two XML LaunchAgent definitions. **If it looks different:** check that `uv` and Python are on `PATH` and that you are in the repository root.
4. Run `adb devices` and confirm only devices that this agent should be allowed to manage are listed. **You should see:** each intended device followed by `device`. **If it looks different:** stop before installation and resolve the unexpected or unauthorized device.

## Install

```sh
./ops/launchd/install.sh
```

The script creates `~/Library/LaunchAgents/io.github.maestro-device-farm.{api,agent}.plist`, sets owner-only permissions, and bootstraps each service. It creates `~/Library/Logs/maestro-device-farm/` for `api.log`, `agent.log`, and error logs. It does not write credentials to the templates; set any runtime secrets only in your private installed configuration or service manager.

**You should see:** two `Installed:` lines and a healthy `http://localhost:8700/api/v1/healthz` response. **If it looks different:** check the service logs in the directory above and the `farm doctor` output.

Inspect services with `launchctl list | rg 'io.github.maestro-device-farm'`. Open `http://localhost:8700/api/v1/healthz` to verify the API. For changes to the installed plist, boot out and bootstrap the affected label:

```sh
launchctl bootout "gui/$(id -u)/io.github.maestro-device-farm.api"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.maestro-device-farm.api.plist"
```

The equivalent agent label ends in `.agent`. Uninstall both LaunchAgents with `./ops/launchd/install.sh --uninstall`; data in `~/maestro-device-farm/data` is not deleted. Use `--uninstall --dry-run` to preview the commands.

## Limitations

This setup assumes API and agent share one host and one SQLite data directory. The live stream defaults to local port 8701. Multi-host agents are not implemented; a remote host cannot safely share the SQLite file and local artifact paths through the current design.

## Recap and next step

The dry run previews installed service files; installation starts user services, and uninstall removes those services but keeps farm data. **Next:** [Connect a device](guides/connect-a-device.md) or [Troubleshooting](guides/troubleshooting.md).
