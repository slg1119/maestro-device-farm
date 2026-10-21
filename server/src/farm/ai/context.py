import json
import re
from collections import deque
from pathlib import Path

import yaml
from sqlalchemy import select

from farm.ai.client import ImagePart
from farm.db.engine import Database
from farm.db.models import Run, TestResult
from farm.workspaces.changes import Change, normalize_changes, touched_paths
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.snapshot import apply_changes, snapshot_commit


def materialize(settings, ws, base_sha: str, draft_changes, dest: Path) -> Path:
    max_bytes = settings.max_flows_mb * 1024 * 1024
    changes, issues = normalize_changes([Change.model_validate(c) for c in draft_changes])
    if issues or any(".git" in p.split("/") for p in touched_paths(changes)):
        raise WorkspaceError(400, "invalid_path", "draft contains unsafe or duplicated paths")
    root = snapshot_commit(settings, ws, base_sha, dest, max_bytes, allow_missing=True)
    apply_changes(root, changes, max_bytes)
    return root


def workspace_context(root: Path, target_path: str, budget: int = 60_000) -> str:
    """Keep the target and recursive subflows intact; discard largest unrelated files first.

    If the mandatory context alone exceeds the byte budget, fail explicitly instead of
    silently sending a partial target or sending an oversized provider request.
    """
    root = root.resolve()
    paths = sorted(p for p in root.rglob("*") if _inside(root, p) and p.is_file())
    contents = {p: p.read_text(encoding="utf-8", errors="replace") for p in paths
                if p.suffix.lower() in {".yaml", ".yml"}}
    target = root / target_path
    required = {p for p in paths if p.name in {"config.yaml", "config.yml"}}
    pending = [target]
    visited = set()
    while pending:
        path = pending.pop()
        if path in visited or path not in contents:
            continue
        visited.add(path)
        required.add(path)
        try:
            documents = list(yaml.safe_load_all(contents[path]))
        except yaml.YAMLError:
            continue
        for ref in _flow_references(documents):
            child = path.parent / ref
            if _inside(root, child):
                pending.append(child.resolve())
    optional = sorted((p for p in paths if p not in required),
                      key=lambda p: (-p.stat().st_size, str(p)))
    kept = set(paths)

    def render():
        tree = "\n".join(f"{p.relative_to(root)} ({p.stat().st_size} bytes)" for p in paths if p in kept)
        blocks = ["File tree\n" + tree]
        for p in paths:
            if p not in kept or p not in contents:
                continue
            content = contents[p] if p in required else re.split(r"(?m)^---\s*(?:#.*)?$", contents[p], 1)[0]
            blocks.append(f"File: {p.relative_to(root)}\n{content}")
        if target not in contents:
            blocks.append(f"File: {target_path}\n(new file)")
        omitted = len(paths) - len(kept)
        if omitted:
            blocks.append(f"[omitted {omitted} unrelated files to fit the context budget]")
        return "\n\n".join(blocks)

    text = render()
    for p in optional:
        if len(text.encode("utf-8")) <= budget:
            return text
        kept.remove(p)
        text = render()
    if len(text.encode("utf-8")) > budget:
        raise ValueError("target and referenced subflows exceed the workspace context budget")
    return text


def _inside(root: Path, path: Path) -> bool:
    if not path.resolve().is_relative_to(root) or ".git" in path.parts:
        return False
    return not any(p.is_symlink() for p in [path, *path.parents] if p != root)


def _flow_references(value):
    if isinstance(value, list):
        for item in value:
            yield from _flow_references(item)
    elif isinstance(value, dict):
        flow = value.get("runFlow")
        ref = flow.get("file") if isinstance(flow, dict) else flow
        if isinstance(ref, str):
            yield ref
        for item in value.values():
            yield from _flow_references(item)


def redact(settings, value, extra=()):
    """Remove configured credentials and known run environment values from all text surfaces."""
    secrets = [s.get_secret_value() for s in (settings.openai_api_key, settings.github_token) if s]
    secrets.extend(str(s) for s in extra if s is not None and str(s))
    if isinstance(value, str):
        for secret in sorted(set(secrets), key=len, reverse=True):
            if secret:
                variants = {secret, json.dumps(secret, ensure_ascii=True)[1:-1],
                            json.dumps(secret, ensure_ascii=False)[1:-1]}
                for variant in sorted(variants, key=len, reverse=True):
                    value = value.replace(variant, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(settings, item, extra) for item in value]
    if isinstance(value, dict):
        return {redact(settings, k, extra): redact(settings, v, extra) for k, v in value.items()}
    return value


def failure_target(task, run, results) -> str:
    if run.mode == "matrix":
        for result in results:
            if result.status in {"failed", "error"}:
                for path in task.flows:
                    if path == result.flow_name or Path(path).stem == result.flow_name:
                        return path
    if task.flows:
        return task.flows[0]
    raise ValueError("failed task has no flow path")


def failure_context(settings, task, *, db=None):
    """Return failure evidence without exposing run.env values; images are provider content parts."""
    own_db = db is None
    db = db or Database(settings.database_path)
    try:
        with db.session() as s:
            run = s.get(Run, task.run_id)
            results = list(s.scalars(select(TestResult).where(TestResult.task_id == task.id).order_by(TestResult.id)))
        target = failure_target(task, run, results)
        flow_text = ""
        if run.flows_dir:
            flows = Path(run.flows_dir).resolve()
            flow_path = flows / target
            if _inside(flows, flow_path) and flow_path.is_file():
                flow_text = flow_path.read_text(encoding="utf-8", errors="replace")
        messages = "\n".join(r.failure_message for r in results
                             if r.status in {"failed", "error"} and r.failure_message)
        log_tail = ""
        images = []
        if task.artifacts_dir:
            artifacts = Path(task.artifacts_dir).resolve()
            logs = sorted(p for p in artifacts.rglob("maestro.log") if _inside(artifacts, p))
            if logs:
                with logs[-1].open(encoding="utf-8", errors="replace") as log:
                    log_tail = "".join(deque(log, maxlen=200))
            screenshot = _failure_screenshot(artifacts)
            if screenshot:
                images.append(ImagePart(screenshot.read_bytes(), "image/png"))
        text = (f"## Failure\nFlow: {target}\n{flow_text}\n\nJUnit failure messages\n{messages}"
                f"\n\nmaestro.log (last 200 lines)\n{log_tail}")
        return redact(settings, text, run.env.values()), images
    finally:
        if own_db:
            db.dispose()


def _failure_screenshot(artifacts):
    try:
        from farm.runner.steps import parse_steps
    except ModuleNotFoundError as exc:
        if exc.name != "farm.runner.steps":
            raise
    else:
        for flow in parse_steps(artifacts):
            for step in flow["steps"]:
                if step["status"] in {"failed", "warned"} and step.get("screenshot"):
                    path = artifacts / step["screenshot"]
                    if _inside(artifacts, path) and path.is_file():
                        return path
    screenshots = [p for p in artifacts.rglob("*.png") if p.parent.name == "screenshots" and _inside(artifacts, p)]
    return max(screenshots, key=lambda p: p.stat().st_mtime_ns) if screenshots else None
