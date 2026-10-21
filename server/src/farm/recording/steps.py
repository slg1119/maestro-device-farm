import math
import re
from collections import Counter
from xml.etree import ElementTree

from farm.stream.events import ControlEvent
from farm.timeutil import parse


def parse_hierarchy(xml: str, *, strict: bool = False) -> list[dict]:
    """Accept uiautomator's trailing message; strict mode distinguishes failure from empty XML."""
    start, end = xml.find("<hierarchy"), xml.rfind("</hierarchy>")
    end = end + len("</hierarchy>") if end >= 0 else xml.find("/>", start) + 2
    try:
        if start < 0 or end <= start:
            raise ValueError
        root = ElementTree.fromstring(xml[start:end])
        if root.tag != "hierarchy":
            raise ValueError
    except (ElementTree.ParseError, ValueError):
        if strict:
            raise ValueError("unusable hierarchy") from None
        return []
    nodes, elements = [], []
    for node in root.iter("node"):
        bounds = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
        if bounds:
            elements.append(node)
            nodes.append({**{key: node.get(key, "") for key in ("resource-id", "text", "content-desc")},
                          "clickable": node.get("clickable") == "true",
                          "bounds": tuple(map(int, bounds.groups()))})
    indices = {element: index for index, element in enumerate(elements)}
    for element, node in zip(elements, nodes):
        node["descendants"] = [indices[child] for child in element.iter("node")
                               if child is not element and child in indices]
    return nodes


def append_step(steps: list[dict], step: dict | None) -> list[dict]:
    if step is None:
        return steps
    if steps and steps[-1]["kind"] == step["kind"] == "input":
        return [*steps[:-1], {**steps[-1], "text": steps[-1]["text"] + step["text"]}]
    return [*steps, step]


def _point(x, y, size):
    values = [f"{max(0, min(100, round(100 * value / extent)))}%"
              for value, extent in zip((x, y), size)]
    return ",".join(values)


def normalize_point(point: str) -> str:
    """Older recordings may contain decimals that Maestro cannot execute."""
    x, y = (float(value.strip().removesuffix("%")) for value in point.split(","))
    return _point(x, y, (100, 100))


class StepClassifier:
    def __init__(self, nodes: list[dict]):
        self.nodes = nodes
        self._touches = {}

    def _selector(self, x, y, size):
        width = max((n["bounds"][2] for n in self.nodes), default=size[0])
        height = max((n["bounds"][3] for n in self.nodes), default=size[1])
        x, y = x * width / size[0], y * height / size[1]
        candidates = [n for n in self.nodes if n["clickable"] and
                      n["bounds"][0] <= x < n["bounds"][2] and n["bounds"][1] <= y < n["bounds"][3]]
        if not candidates:
            return None
        node = min(candidates, key=lambda n: (n["bounds"][2] - n["bounds"][0]) *
                                            (n["bounds"][3] - n["bounds"][1]))
        ids = Counter(n["resource-id"] for n in self.nodes if n["resource-id"])
        if node["resource-id"] and ids[node["resource-id"]] == 1:
            return {"id": node["resource-id"]}
        # Maestro text selectors also match content-desc. Count matching nodes across both fields.
        labels = Counter(label for n in self.nodes for label in {n["text"], n["content-desc"]} if label)
        for candidate in [node, *(self.nodes[i] for i in node.get("descendants", []))]:
            for attribute in ("text", "content-desc"):
                if candidate[attribute] and labels[candidate[attribute]] == 1:
                    return {"text": candidate[attribute]}
        return None

    def feed(self, event: ControlEvent) -> dict | None:
        message, size = event.message, event.video_size
        base = {"ts": event.ts}
        if message["type"] == "text":
            return {"kind": "input", "text": message["text"], **base} if message["text"] else None
        if message["type"] == "key":
            return {"kind": "back", **base} if message["key"] == "BACK" else {
                "kind": "key", "key": message["key"], **base}
        if message["type"] != "touch" or min(size) <= 0:
            return None
        x, y = max(0, min(size[0], message["x"])), max(0, min(size[1], message["y"]))
        actor = (event.serial, event.actor)
        if message["action"] == "down":
            self._touches[actor] = (x, y, event.ts, 0.0, size, list(self.nodes))
            return None
        touch = self._touches.get(actor)
        if touch is None:
            return None
        sx, sy, ts, distance, start_size, nodes = touch
        if start_size != size:
            self._touches.pop(actor, None)
            return None
        distance = max(distance, math.hypot((x - sx) / size[0], (y - sy) / size[1]))
        if message["action"] == "move":
            self._touches[actor] = (sx, sy, ts, distance, size, nodes)
            return None
        self._touches.pop(actor, None)
        if (parse(event.ts) - parse(ts)).total_seconds() <= .3 and distance < .02:
            # Resolve against the hierarchy visible at touch down, before navigation.
            current, self.nodes = self.nodes, nodes
            try:
                selector = self._selector(sx, sy, size)
            finally:
                self.nodes = current
            return {"kind": "tap", **({"selector": selector} if selector else {"point": _point(sx, sy, size)}), **base}
        return {"kind": "swipe", "from": _point(sx, sy, size), "to": _point(x, y, size), **base}
