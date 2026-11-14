# macOS launchd service setup

The two templates in `ops/launchd/` install the API and agent as **user LaunchAgents** with labels `io.github.maestro-device-farm.api` and `io.github.maestro-device-farm.agent`. They use the current repository path and `uv` executable found by `install.sh`. The default data directory remains `~/maestro-device-farm/data`, and API port 8700 is the default unless `FARM_*` variables are set in the installed plist.

## Before installation

1. Install Python 3.12+, uv, Java 17+, adb and Maestro CLI. Build the dashboard with `cd web && pnpm install --frozen-lockfile && pnpm build`.
2. Run `cd server && uv run farm doctor` and check the reported host requirements.
3. Use `./ops/launchd/install.sh --dry-run` to inspect the rendered plists. This does **not** install or start services. The dry run was exercised while preparing these docs.
4. Confirm `adb devices` shows only devices that this agent should be allowed to manage. Starting the agent gives it access to every device exposed by that adb server.

## Install

```sh
./ops/launchd/install.sh
```

The script creates `~/Library/LaunchAgents/io.github.maestro-device-farm.{api,agent}.plist`, sets owner-only permissions, and bootstraps each service. It creates `~/Library/Logs/maestro-device-farm/` for `api.log`, `agent.log`, and error logs. It does not write credentials to the templates; set any runtime secrets only in your private installed configuration or service manager.

Inspect services with `launchctl list | rg 'io.github.maestro-device-farm'`. Open `http://localhost:8700/api/v1/healthz` to verify the API. For changes to the installed plist, boot out and bootstrap the affected label:

```sh
launchctl bootout "gui/$(id -u)/io.github.maestro-device-farm.api"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.maestro-device-farm.api.plist"
```

The equivalent agent label ends in `.agent`. Uninstall both LaunchAgents with `./ops/launchd/install.sh --uninstall`; data in `~/maestro-device-farm/data` is not deleted. Use `--uninstall --dry-run` to preview the commands.

## Limitations

This setup assumes API and agent share one host and one SQLite data directory. The live stream defaults to local port 8701. Multi-host agents are not implemented; a remote host cannot safely share the SQLite file and local artifact paths through the current design.
