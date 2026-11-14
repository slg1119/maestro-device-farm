#!/usr/bin/env python3
"""Isolated, disposable Android Settings demonstration environment.

Only emulator-5560 is ever passed to adb. The agent supervisor checks the
complete adb inventory before launch and every half second until shutdown.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SDK = Path.home() / "Library/Android/sdk"
ADB = SDK / "platform-tools/adb"
EMULATOR = SDK / "emulator/emulator"
SERIAL = "emulator-5560"
AVD = "mdf-demo"
STATE_FILE = Path.home() / ".cache/maestro-device-farm-demo/state.json"
IMAGE = SDK / "system-images/android-36.1/google_apis_playstore/arm64-v8a"
API_PREFIX = "/api/v1"


def adb_inventory() -> dict[str, str]:
    result = subprocess.run([str(ADB), "devices"], capture_output=True, text=True, check=True, timeout=15)
    return {parts[0]: parts[1] for line in result.stdout.splitlines()[1:]
            if (parts := line.split()) and len(parts) >= 2}


def assert_isolated(*, require_target: bool = True) -> None:
    devices = adb_inventory()
    other = sorted(set(devices) - {SERIAL})
    if other:
        raise RuntimeError("Unsafe adb inventory: another device is attached; agent must stay stopped")
    if require_target and devices.get(SERIAL) != "device":
        raise RuntimeError(f"{SERIAL} is not ready")


def adb_target(*args: str, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run([str(ADB), "-s", SERIAL, *args], capture_output=True, text=True,
                          check=True, timeout=timeout)


def state() -> dict:
    if not STATE_FILE.exists():
        raise RuntimeError("Demo is not started")
    return json.loads(STATE_FILE.read_text())


def save_state(value: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(value, indent=2) + "\n")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def spawn(args: list[str], env: dict[str, str], log: Path) -> int:
    with log.open("ab") as output:
        proc = subprocess.Popen(args, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    return proc.pid


def stop_pid(pid: int | None) -> None:
    if not alive(pid):
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    for _ in range(30):
        if not alive(pid):
            return
        time.sleep(0.1)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def ensure_avd() -> None:
    if not IMAGE.is_dir():
        raise RuntimeError("Required installed Android system image is missing")
    avd_home = Path.home() / ".android/avd"
    avd_dir = avd_home / f"{AVD}.avd"
    avd_ini = avd_home / f"{AVD}.ini"
    if avd_ini.exists():
        if not avd_dir.is_dir():
            raise RuntimeError("AVD descriptor exists without its data directory")
        return
    avdmanager = SDK / "cmdline-tools/latest/bin/avdmanager"
    if avdmanager.exists():
        package = "system-images;android-36.1;google_apis_playstore;arm64-v8a"
        subprocess.run([str(avdmanager), "create", "avd", "--name", AVD, "--package", package,
                        "--device", "pixel_7", "--force"], input="no\n", text=True, check=True)
    else:
        # The image is installed but command-line tools may be absent. The
        # emulator accepts the same AVD descriptor and config.ini directly.
        avd_dir.mkdir(parents=True)
        avd_ini.write_text(f"avd.ini.encoding=UTF-8\npath={avd_dir}\npath.rel=avd/{AVD}.avd\ntarget=android-36.1\n")
        (avd_dir / "config.ini").write_text(
            "AvdId=mdf-demo\nPlayStore.enabled=true\nabi.type=arm64-v8a\n"
            "avd.ini.displayname=mdf-demo\ndisk.dataPartition.size=6G\n"
            "hw.cpu.arch=arm64\nhw.device.name=pixel_7\nhw.gpu.enabled=yes\n"
            "hw.lcd.density=420\nhw.lcd.height=2400\nhw.lcd.width=1080\n"
            "image.sysdir.1=system-images/android-36.1/google_apis_playstore/arm64-v8a/\n"
            "tag.id=google_apis_playstore\ntag.display=Google Play\n")


def demo_env(s: dict) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in
           {"FARM_GITHUB_TOKEN", "FARM_OPENAI_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN"}}
    env.update({
        "PATH": str(ADB.parent) + os.pathsep + env.get("PATH", ""),
        "FARM_DATA_DIR": s["data_dir"],
        "FARM_API_HOST": "127.0.0.1",
        "FARM_API_PORT": str(s["api_port"]),
        "FARM_AGENT_STREAM_PORT": str(s["stream_port"]),
        "FARM_PUBLIC_URL": s["api_url"],
        "FARM_GIT_REMOTE_TEMPLATE": "file://" + str(Path(s["data_dir"], "remotes", "{repo}.git")),
        "FARM_GIT_POLL_SEC": "0",
        "FARM_CODEX_BIN": "mdf-demo-ai-disabled",
        "FARM_API_URL": s["api_url"],
    })
    return env


def wait_http(url: str, timeout: int = 120) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"Service did not become ready: {url}")


def start() -> None:
    assert_isolated(require_target=False)
    if STATE_FILE.exists():
        old = state()
        if any(alive(old.get(key)) for key in ("emulator_pid", "api_pid", "web_pid", "guard_pid")):
            raise RuntimeError("Demo is already running; use stop first")
        STATE_FILE.unlink()
    ensure_avd()
    data = Path(tempfile.mkdtemp(prefix="mdf-demo-"))
    s = {"data_dir": str(data), "api_port": free_port(),
         "stream_port": free_port(), "emulator_pid": None, "api_pid": None,
         "web_pid": None, "guard_pid": None}
    s["api_url"] = f"http://127.0.0.1:{s['api_port']}"
    s["web_url"] = s["api_url"]
    save_state(s)
    try:
        s["emulator_pid"] = spawn([str(EMULATOR), "-avd", AVD, "-port", "5560", "-no-window",
                                    "-no-audio", "-no-boot-anim", "-no-snapshot", "-gpu", "swiftshader_indirect"],
                                   os.environ.copy(), data / "emulator.out")
        save_state(s)
        end = time.monotonic() + 180
        while time.monotonic() < end:
            if adb_inventory().get(SERIAL) == "device":
                if adb_target("shell", "getprop", "sys.boot_completed").stdout.strip() == "1":
                    break
            time.sleep(2)
        else:
            raise RuntimeError("Demo emulator did not finish booting")
        adb_target("shell", "settings", "put", "system", "screen_brightness", "180")
        adb_target("shell", "settings", "put", "secure", "ui_night_mode", "1")
        env = demo_env(s)
        uv = shutil.which("uv") or "uv"
        pnpm = shutil.which("pnpm") or "pnpm"
        subprocess.run([pnpm, "--dir", str(ROOT / "web"), "build"], cwd=ROOT, env=env,
                       check=True, stdout=subprocess.DEVNULL)
        subprocess.run([uv, "sync", "--project", str(ROOT / "server"), "--frozen"], cwd=ROOT,
                       env=env, check=True, stdout=subprocess.DEVNULL)
        farm = ROOT / "server/.venv/bin/farm"
        s["api_pid"] = spawn([str(farm), "api"],
                             env, data / "api.out")
        save_state(s)
        wait_http(s["api_url"] + API_PREFIX + "/healthz")
        wait_http(s["web_url"])
        assert_isolated()
        s["guard_pid"] = spawn([sys.executable, str(Path(__file__).resolve()), "guard"],
                               env, data / "guard.out")
        save_state(s)
        time.sleep(2)
        if not alive(s["guard_pid"]):
            raise RuntimeError("Agent supervisor exited; see guard.out")
        print(json.dumps({"api_url": s["api_url"], "web_url": s["web_url"], "data_dir": s["data_dir"]}))
    except Exception:
        stop()
        raise


def guard() -> None:
    s = state()
    assert_isolated()
    farm = ROOT / "server/.venv/bin/farm"
    with Path(s["data_dir"], "agent.out").open("ab") as output:
        agent = subprocess.Popen([str(farm), "agent"],
                                 cwd=ROOT, env=demo_env(s), stdin=subprocess.DEVNULL,
                                 stdout=output, stderr=subprocess.STDOUT)
        try:
            while agent.poll() is None:
                try:
                    assert_isolated()
                except Exception as exc:
                    Path(s["data_dir"], "guard.alert").write_text(str(exc) + "\n")
                    os.killpg(os.getpgrp(), signal.SIGTERM)
                    return
                time.sleep(0.5)
        finally:
            if agent.poll() is None:
                agent.terminate()
                try:
                    agent.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    agent.kill()


def stop() -> None:
    if not STATE_FILE.exists():
        return
    s = state()
    for key in ("guard_pid", "web_pid", "api_pid", "emulator_pid"):
        stop_pid(s.get(key))
    STATE_FILE.unlink(missing_ok=True)
    print("Demo services stopped; AVD retained")


def refresh() -> None:
    """Reload merged server and dashboard code without discarding demo history."""
    s = state()
    assert_isolated()
    stop_pid(s.get("guard_pid"))
    s["guard_pid"] = None
    save_state(s)
    stop_pid(s.get("api_pid"))
    s["api_pid"] = None
    save_state(s)
    env = demo_env(s)
    pnpm = shutil.which("pnpm") or "pnpm"
    uv = shutil.which("uv") or "uv"
    subprocess.run([pnpm, "--dir", str(ROOT / "web"), "build"], cwd=ROOT, env=env,
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run([uv, "sync", "--project", str(ROOT / "server"), "--frozen"], cwd=ROOT,
                   env=env, check=True, stdout=subprocess.DEVNULL)
    farm = ROOT / "server/.venv/bin/farm"
    s["api_pid"] = spawn([str(farm), "api"], env, Path(s["data_dir"]) / "api.out")
    save_state(s)
    wait_http(s["api_url"] + API_PREFIX + "/healthz")
    assert_isolated()
    s["guard_pid"] = spawn([sys.executable, str(Path(__file__).resolve()), "guard"],
                           env, Path(s["data_dir"]) / "guard.out")
    save_state(s)
    time.sleep(2)
    if not alive(s["guard_pid"]):
        raise RuntimeError("Agent supervisor exited; see guard.out")
    print(json.dumps({"api_url": s["api_url"], "web_url": s["web_url"], "data_dir": s["data_dir"]}))


def api(method: str, path: str, body: bytes | None = None, content_type: str = "application/json"):
    s = state()
    request = urllib.request.Request(s["api_url"] + API_PREFIX + path, data=body, method=method,
                                     headers={"Content-Type": content_type, "X-Farm-User": "Demo"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
            return json.loads(data) if response.headers.get_content_type() == "application/json" else data
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"API {method} {path} returned {exc.code}: {exc.read().decode()[:500]}") from exc


def git(*args: str, cwd: Path | None = None) -> str:
    command = ["git", "-c", "user.name=Demo", "-c", "user.email=demo@example.invalid", *args]
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def multipart(fields: dict[str, str], file_key: str, filename: str, content: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
    parts += [f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_key}\"; filename=\"{filename}\"\r\n"
              "Content-Type: application/octet-stream\r\n\r\n".encode(), content, f"\r\n--{boundary}--\r\n".encode()]
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def seed() -> None:
    s = state()
    assert_isolated()
    data = Path(s["data_dir"])
    remote = data / "remotes/demo/settings.git"
    remote.parent.mkdir(parents=True, exist_ok=True)
    work = data / "flow-source"
    if not remote.exists():
        git("init", "--bare", "--initial-branch=main", str(remote))
        git("init", "--initial-branch=main", str(work))
        flows = work / "flows"
        flows.mkdir()
        for name in ("smoke.yaml", "navigation.yaml", "search.yaml"):
            shutil.copyfile(ROOT / "examples/flows" / name, flows / name)
        (flows / "smoke.yaml").write_text("appId: com.android.settings\n---\n- launchApp\n")
        (flows / "expected-failure.yaml").write_text(
            "appId: com.android.settings\n---\n- launchApp\n"
            "- assertVisible: 'This screen intentionally does not exist'\n")
        git("add", ".", cwd=work)
        git("commit", "-m", "Add Android Settings examples", cwd=work)
        git("remote", "add", "origin", str(remote), cwd=work)
        git("push", "origin", "main", cwd=work)
    existing = api("GET", "/workspaces")
    if not any(row["name"] == "settings-demo" for row in existing):
        api("POST", "/workspaces", json.dumps({"name": "settings-demo", "repo": "demo/settings",
             "branch": "main", "path": "flows", "default_app_package": "com.android.settings"}).encode())
    apps = api("GET", "/apps?package=com.android.settings")
    if apps:
        app = apps[0]
    else:
        paths = adb_target("shell", "pm", "path", "com.android.settings").stdout.splitlines()
        bases = [line.partition(":")[2].strip() for line in paths if line.startswith("package:") and line.endswith(".apk")]
        if not bases:
            raise RuntimeError("Android Settings base APK was not found on demo emulator")
        apk = data / "settings.apk"
        adb_target("pull", bases[0], str(apk), timeout=120)
        body, content_type = multipart({"source": "dashboard"}, "apk", "settings.apk", apk.read_bytes())
        app = api("POST", "/apps", body, content_type)
        apk.unlink()
    s["app_id"] = app["id"]
    save_state(s)
    print(json.dumps({"workspace": "settings-demo", "app_id": s["app_id"]}))


def submit(flow: str) -> dict:
    s = state()
    assert_isolated()
    options = {"mode": "matrix", "flow_source": "workspace", "workspace": "settings-demo",
               "app_build_id": s["app_id"], "flow_paths": [flow],
               "device_selector": {"serials": [SERIAL]}, "origin": "dashboard", "task_timeout_sec": 180}
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"options\"\r\n\r\n"
            + json.dumps(options) + f"\r\n--{boundary}--\r\n").encode()
    return api("POST", "/runs", body, f"multipart/form-data; boundary={boundary}")


def wait_run(run_id: str, desired: str, timeout: int = 240) -> tuple[dict, list[str]]:
    seen = []
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        run = api("GET", f"/runs/{run_id}")
        status = run["status"]
        if not seen or seen[-1] != status:
            seen.append(status)
        if status in {"passed", "failed", "error", "cancelled"}:
            if status != desired:
                raise RuntimeError(f"Run ended {status}, expected {desired}: {run['tasks']}")
            return run, seen
        if not alive(state().get("guard_pid")):
            raise RuntimeError("Agent supervisor stopped while waiting for run")
        time.sleep(0.2)
    raise RuntimeError(f"Run did not finish within {timeout}s; observed {seen}")


def run_events(run_id: str) -> list[str]:
    path = Path(state()["data_dir"]) / "farm.db"
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        rows = db.execute("SELECT type, payload FROM events WHERE run_id=? ORDER BY id", (run_id,)).fetchall()
    return [json.loads(payload)["status"] for kind, payload in rows if kind == "run.updated"]


def verify() -> None:
    s = state()
    if "app_id" not in s:
        raise RuntimeError("Run seed first")
    assert_isolated()
    devices = api("GET", "/devices")
    if [d["serial"] for d in devices if d["state"] != "offline"] != [SERIAL]:
        raise RuntimeError("Demo agent has not registered only the intended device")
    passed = submit("smoke.yaml")
    good, _ = wait_run(passed["id"], "passed")
    good_states = run_events(passed["id"])
    if good_states != ["queued", "running", "passed"]:
        raise RuntimeError(f"Run events did not show full lifecycle: {good_states}")
    failed = submit("expected-failure.yaml")
    bad, bad_states = wait_run(failed["id"], "failed")
    task = bad["tasks"][0]
    files = api("GET", f"/tasks/{task['id']}/artifacts")["files"]
    names = [row["path"] for row in files]
    if not any(name.endswith(".png") for name in names) or "junit.xml" not in names:
        raise RuntimeError("Failed task lacks screenshot or JUnit artifact")
    junit = api("GET", f"/runs/{failed['id']}/junit")
    if b"<failure" not in junit:
        raise RuntimeError("Run JUnit does not include failure")
    s.update({"passed_run": passed["id"], "failed_run": failed["id"]})
    save_state(s)
    print(json.dumps({"passed_run": passed["id"], "passed_states": good_states,
                      "failed_run": failed["id"], "failed_states": bad_states,
                      "failed_screenshots": len([name for name in names if name.endswith(".png")]),
                      "junit_present": "junit.xml" in names}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "stop", "refresh", "seed", "verify", "status", "guard"))
    args = parser.parse_args()
    try:
        if args.command == "start":
            start()
        elif args.command == "stop":
            stop()
        elif args.command == "refresh":
            refresh()
        elif args.command == "seed":
            seed()
        elif args.command == "verify":
            verify()
        elif args.command == "guard":
            guard()
        else:
            s = state()
            print(json.dumps({"api_url": s["api_url"], "web_url": s["web_url"],
                              "data_dir": s["data_dir"],
                              "services": {key: alive(s.get(key)) for key in
                                           ("emulator_pid", "api_pid", "web_pid", "guard_pid")},
                              "guard_alert": (Path(s["data_dir"]) / "guard.alert").exists()}))
    except Exception as exc:
        print(f"demo error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
