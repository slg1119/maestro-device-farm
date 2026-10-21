import yaml

from farm.recording.steps import normalize_point

KEYS = {"HOME": "Home", "APP_SWITCH": "Recent Apps", "ENTER": "Enter", "DEL": "Backspace",
        "VOLUME_UP": "Volume Up", "VOLUME_DOWN": "Volume Down", "POWER": "Power"}


class _FlowDumper(yaml.SafeDumper):
    pass


_FlowDumper.add_representer(str, lambda dumper, value: dumper.represent_scalar(
    "tag:yaml.org,2002:str", value, style='"' if "\n" in value else None))


def steps_to_yaml(steps: list[dict], app_id: str | None) -> str:
    commands = []
    for step in steps:
        match step["kind"]:
            case "launch":
                commands.append("launchApp")
            case "tap":
                commands.append({"tapOn": step.get("selector") or {"point": normalize_point(step["point"])}})
            case "swipe":
                commands.append({"swipe": {"start": normalize_point(step["from"]),
                                           "end": normalize_point(step["to"])}})
            case "input":
                commands.append({"inputText": step["text"]})
            case "back":
                commands.append("back")
            case "key":
                commands.append({"pressKey": KEYS[step["key"]]})
            case _:
                raise ValueError(f"unknown recorded step: {step['kind']}")
    return yaml.safe_dump({"appId": app_id or "${APP_ID}"}, allow_unicode=True, sort_keys=False) + "---\n" + \
        yaml.dump(commands, Dumper=_FlowDumper, allow_unicode=True, sort_keys=False, width=1000)
