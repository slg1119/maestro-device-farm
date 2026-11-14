#!/bin/bash
set -euo pipefail

dry_run=false
uninstall=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --uninstall) uninstall=true ;;
    *) printf 'Usage: %s [--uninstall] [--dry-run]\n' "$0" >&2; exit 2 ;;
  esac
done

script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
repo_dir=$(cd -- "$script_dir/../.." && pwd -P)
agents_dir="$HOME/Library/LaunchAgents"
domain="gui/$(id -u)"

if "$uninstall"; then
  for service in api agent; do
    label="io.github.maestro-device-farm.$service"
    if "$dry_run"; then
      printf 'Would remove: launchctl bootout %s/%s · %s/%s.plist\n' "$domain" "$label" "$agents_dir" "$label"
    else
      launchctl bootout "$domain/$label" 2>/dev/null || true
      rm -f -- "$agents_dir/$label.plist"
    fi
  done
  exit 0
fi

uv_bin=$(command -v uv) || { printf 'Install uv and add it to PATH.\n' >&2; exit 1; }
python_bin=$(command -v python3) || { printf 'Python 3 is required.\n' >&2; exit 1; }

render() {
  "$python_bin" -B - "$1" "$repo_dir" "$uv_bin" "$HOME" <<'PY'
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

template, repo, uv, home = sys.argv[1:]
values = {"__REPO__": repo, "__UV__": uv, "__HOME__": home}
print(re.sub(r"__REPO__|__UV__|__HOME__", lambda match: escape(values[match.group()]),
             Path(template).read_text()), end="")
PY
}

if ! "$dry_run"; then
  mkdir -p -- "$agents_dir" "$HOME/Library/Logs/maestro-device-farm"
fi
for service in api agent; do
  label="io.github.maestro-device-farm.$service"
  template="$script_dir/$label.plist.template"
  if "$dry_run"; then
    render "$template"
  else
    destination="$agents_dir/$label.plist"
    # Plists may later contain operator-supplied credentials.
    (umask 077; render "$template" > "$destination")
    chmod 600 "$destination"
    launchctl bootout "$domain/$label" 2>/dev/null || true
    launchctl bootstrap "$domain" "$destination"
    printf 'Installed: %s\n' "$destination"
  fi
done
