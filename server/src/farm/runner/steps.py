import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SKIP_COMMANDS = {"defineVariablesCommand", "applyConfigurationCommand"}
COMMAND_NAMES = {"tapOnElement": "tapOn", "backPressCommand": "back"}
STATUSES = {"COMPLETED": "passed", "WARNED": "warned", "FAILED": "failed", "SKIPPED": "skipped",
            "RUNNING": "running", "PENDING": "pending"}


def _selector_label(selector: dict) -> str:
    parts = []
    for key, label in (("textRegex", "text"), ("idRegex", "id")):
        if key in selector:
            parts.append(f"{label}={json.dumps(selector[key], ensure_ascii=False)}")
    for key in ("index", "point"):
        if key in selector:
            parts.append(f"{key}={selector[key]}")
    return " ".join(parts)


def _command_label(name: str, params: dict) -> tuple[str, str]:
    command = COMMAND_NAMES.get(name, name.removesuffix("Command"))
    selector = params.get("selector") or {}
    if name == "assertConditionCommand":
        condition = params.get("condition") or {}
        if "visible" in condition:
            command, selector = "assertVisible", condition["visible"]
        elif "notVisible" in condition:
            command, selector = "assertNotVisible", condition["notVisible"]
    label = command
    if command == "launchApp":
        if params.get("appId"):
            label += f" {params['appId']}"
        if params.get("clearState"):
            label += " (clearState)"
    elif command == "inputText":
        label += f" {params.get('text', '')}"
    elif command == "runFlow":
        source = params.get("sourceDescription")
        label += f" {source}" if source else f" ({len(params.get('commands') or [])} steps)"
    elif command == "runScript" and params.get("sourceDescription"):
        label += f" {params['sourceDescription']}"
    elif isinstance(selector, dict) and (detail := _selector_label(selector)):
        label += f" {detail}"
    if params.get("optional") or (isinstance(selector, dict) and selector.get("optional")):
        label += " (optional)"
    return command, label


def _artifact_paths(metadata: dict, flow_dir: Path, root: Path) -> dict:
    paths = {"screenshot": None, "hierarchy": None}
    for artifact in metadata.get("artifacts") or []:
        key = {"SCREENSHOT": "screenshot", "SCREEN_HIERARCHY": "hierarchy"}.get(artifact.get("type"))
        value = artifact.get("path")
        if key is None or not isinstance(value, str):
            continue
        target = (flow_dir / value).resolve()
        if target.is_relative_to(root):
            paths[key] = target.relative_to(root).as_posix()
    return paths


def parse_steps(artifacts_dir: Path) -> list[dict]:
    root = artifacts_dir.resolve()
    flows = []
    for path in sorted(root.glob("maestro/*/*/commands.json")):
        if not path.resolve().is_relative_to(root):
            continue
        try:
            entries = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(entries, list):
                raise TypeError("expected a command list")
        except (OSError, UnicodeError, ValueError, TypeError):
            logger.warning("Skipping unreadable Maestro commands: %s", path)
            continue
        steps = []
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            original = entry.get("command") or {}
            if not isinstance(original, dict) or len(original) != 1:
                continue
            name = next(iter(original))
            if name in SKIP_COMMANDS:
                continue
            metadata = entry.get("metadata") or {}
            evaluated = metadata.get("evaluatedCommand") or original
            params = evaluated.get(name, original[name]) or {}
            command, label = _command_label(name, params)
            status = str(metadata.get("status", "PENDING"))
            steps.append({
                "seq": metadata.get("sequenceNumber", index), "command": command, "label": label,
                "status": STATUSES.get(status, status.lower()), "duration_ms": metadata.get("duration", 0),
                "depth": metadata.get("depth", 0), **_artifact_paths(metadata, path.parent, root),
            })
        flows.append({"flow": path.parent.name, "steps": steps})
    return flows
