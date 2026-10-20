from pathlib import Path

import yaml

FLOW_SUFFIXES = {".yaml", ".yml"}
CONFIG_NAMES = {"config.yaml", "config.yml"}


class FlowSelectionError(ValueError):
    pass


def read_flow_tags(path: Path) -> list[str]:
    try:
        with path.open(encoding="utf-8") as fh:
            first = next(yaml.safe_load_all(fh), None)
    except yaml.YAMLError:
        return []
    if isinstance(first, dict) and isinstance(first.get("tags"), list):
        return [str(tag) for tag in first["tags"]]
    return []


def load_config(root: Path) -> dict:
    for name in CONFIG_NAMES:
        path = root / name
        if path.is_file():
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
            except yaml.YAMLError:
                return {}
            return data if isinstance(data, dict) else {}
    return {}


def _is_flow_file(path: Path) -> bool:
    return path.is_file() and path.suffix in FLOW_SUFFIXES and path.name not in CONFIG_NAMES


def _tag_list(value) -> list[str]:
    return [str(v) for v in value] if isinstance(value, list) else []


def _candidates(root: Path, config: dict) -> list[Path]:
    globs = config.get("flows")
    if isinstance(globs, list) and globs:
        found: set[Path] = set()
        for pattern in globs:
            found.update(p for p in root.glob(str(pattern)) if _is_flow_file(p))
        return sorted(found)
    return sorted(p for p in root.iterdir() if _is_flow_file(p))


def _resolve_flow_paths(root: Path, flow_paths: list[str]) -> list[str]:
    base = root.resolve()
    result = []
    for rel in flow_paths:
        path = (base / rel).resolve()
        if not path.is_relative_to(base) or not _is_flow_file(path):
            raise FlowSelectionError(f"flow not found: {rel}")
        result.append(path.relative_to(base).as_posix())
    return result


def enumerate_flows(
    root: Path, include_tags: list[str], exclude_tags: list[str], flow_paths: list[str] | None = None
) -> list[str]:
    if flow_paths:
        return _resolve_flow_paths(root, flow_paths)
    config = load_config(root)
    include = set(include_tags) | set(_tag_list(config.get("includeTags")))
    exclude = set(exclude_tags) | set(_tag_list(config.get("excludeTags")))
    selected = []
    for path in _candidates(root, config):
        tags = set(read_flow_tags(path))
        if include and not tags & include:
            continue
        if exclude and tags & exclude:
            continue
        selected.append(path.relative_to(root).as_posix())
    return selected
