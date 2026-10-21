import os
import plistlib
import re
import subprocess
from pathlib import Path


def test_install_dry_run_renders_two_valid_plists_without_writes_or_launchctl(tmp_path):
    root = Path(__file__).resolve().parents[3]
    home = tmp_path / "home with & spaces"
    home.mkdir()
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    uv = fakebin / "uv"
    uv.write_text("#!/bin/sh\nexit 0\n")
    uv.chmod(0o755)
    log = tmp_path / "launchctl-was-called"
    launchctl = fakebin / "launchctl"
    launchctl.write_text(f"#!/bin/sh\ntouch '{log}'\nexit 99\n")
    launchctl.chmod(0o755)
    env = {**os.environ, "HOME": str(home), "PATH": f"{fakebin}:/usr/bin:/bin"}
    script = root / "ops/launchd/install.sh"
    result = subprocess.run(["/bin/bash", str(script), "--dry-run"],
                            capture_output=True, text=True, env=env, check=False)
    assert result.returncode == 0, result.stderr
    plists = re.findall(r"<\?xml.*?</plist>", result.stdout, re.DOTALL)
    assert len(plists) == 2
    for xml, command in zip(plists, ("api", "agent"), strict=True):
        data = plistlib.loads(xml.encode())
        assert data["Label"] == f"io.github.maestro-device-farm.{command}"
        assert data["ProgramArguments"] == [str(uv), "run", "farm", command]
        assert data["WorkingDirectory"] == str(root / "server")
        assert data["KeepAlive"] and data["RunAtLoad"]
        assert data["StandardOutPath"].startswith(str(home / "Library/Logs/maestro-device-farm"))
        assert data["EnvironmentVariables"]["HOME"] == str(home)
        assert "__REPO__" not in xml and "__UV__" not in xml and "__HOME__" not in xml
    assert not log.exists()
    assert not (home / "Library").exists()
    result = subprocess.run(["/bin/bash", str(script), "--uninstall", "--dry-run"],
                            capture_output=True, text=True, env=env, check=False)
    assert result.returncode == 0
    assert not log.exists() and not (home / "Library").exists()
