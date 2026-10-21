import asyncio
import logging
from pathlib import Path

from farm.devices.adb import Adb
from farm.flows.enumerate import CONFIG_NAMES
from farm.results import TaskOutcome
from farm.runner.artifacts import EnvRedactor
from farm.runner.base import CancelToken, PrecheckFailed, TaskSpec
from farm.runner.junit import JunitParseError, parse_junit
from farm.runner.procs import ProcResult, run_process, start_background, terminate_group

log = logging.getLogger(__name__)
SIGNATURE_MISMATCH = "INSTALL_FAILED_UPDATE_INCOMPATIBLE"
TAIL_CHARS = 2000


def _tail(text: str) -> str:
    return text[-TAIL_CHARS:].strip()


def _tail_file(path: Path) -> str:
    try:
        return _tail(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return ""


def _config_file(flows_dir: Path) -> Path | None:
    for name in sorted(CONFIG_NAMES):
        if (flows_dir / name).is_file():
            return flows_dir / name
    return None


class MaestroRunner:
    def __init__(self, adb: Adb, *, min_battery: int, maestro: str = "maestro", term_grace: float = 10.0) -> None:
        self.adb = adb
        self.min_battery = min_battery
        self.maestro = maestro
        self.term_grace = term_grace

    async def precheck(self, serial: str) -> str | None:
        state = await self.adb.get_state(serial)
        if state != "device":
            return f"adb state is {state}"
        level = await self.adb.battery(serial)
        if level is not None and level < self.min_battery:
            return f"battery {level}% below {self.min_battery}%"
        await self.adb.shell(serial, "input", "keyevent", "KEYCODE_WAKEUP")
        await self.adb.shell(serial, "wm", "dismiss-keyguard")
        return None

    def build_argv(self, spec: TaskSpec) -> list[str]:
        argv = [self.maestro, "--device", spec.serial, "test"]
        if spec.flows:
            argv += [str(spec.flows_dir / flow) for flow in spec.flows]
            config = _config_file(spec.flows_dir)
            if config is not None:
                argv += ["--config", str(config)]
        else:
            argv.append(str(spec.flows_dir))
            if spec.include_tags:
                argv += ["--include-tags", ",".join(spec.include_tags)]
            if spec.exclude_tags:
                argv += ["--exclude-tags", ",".join(spec.exclude_tags)]
        argv += ["--format", "JUNIT", "--output", str(spec.artifacts_dir / "junit.xml"),
                 "--test-output-dir", str(spec.artifacts_dir / "maestro")]
        for key, value in sorted(spec.env.items()):
            argv += ["-e", f"{key}={value}"]
        if not spec.first_run_on_device:
            argv.append("--no-reinstall-driver")
        return argv

    async def run(self, spec: TaskSpec, cancel: CancelToken) -> TaskOutcome:
        reason = await self.precheck(spec.serial)
        if reason:
            raise PrecheckFailed(reason)
        spec.artifacts_dir.mkdir(parents=True, exist_ok=True)
        ok, output = await self.adb.install(spec.serial, spec.apk_path)
        if not ok and SIGNATURE_MISMATCH in output:
            log.info("signature mismatch on %s; reinstalling %s", spec.serial, spec.package_name)
            await self.adb.uninstall(spec.serial, spec.package_name)
            ok, output = await self.adb.install(spec.serial, spec.apk_path)
        if not ok:
            return TaskOutcome("error", error_code="install_failed", error_message=_tail(output))
        await self.adb.logcat_clear(spec.serial)
        logcat = await start_background(self.adb.logcat_argv(spec.serial), spec.artifacts_dir / "logcat.txt")
        try:
            result = await run_process(self.build_argv(spec), timeout=spec.timeout_sec,
                                       log_path=spec.artifacts_dir / "maestro.log", cancel=cancel,
                                       grace=self.term_grace)
        finally:
            await terminate_group(logcat, grace=2)
            # JUnit and log tails must be sanitized before _classify reads them.
            await asyncio.to_thread(EnvRedactor(spec.env.values()).redact_tree, spec.artifacts_dir)
        return await self._classify(spec, cancel, result)

    async def _classify(self, spec: TaskSpec, cancel: CancelToken, result: ProcResult) -> TaskOutcome:
        if cancel.is_cancelled:
            if cancel.reason == "disconnected":
                return TaskOutcome("error", exit_code=result.returncode, error_code="device_disconnected",
                                   error_message="device disconnected during the run")
            return TaskOutcome("cancelled", exit_code=result.returncode)
        if result.timed_out:
            return TaskOutcome("error", error_code="timeout", error_message=f"maestro exceeded {spec.timeout_sec}s")
        junit = spec.artifacts_dir / "junit.xml"
        if junit.is_file():
            try:
                cases = parse_junit(junit)
            except JunitParseError:
                cases = None
            if cases is not None and (cases or result.returncode == 0):
                failed = any(case.status == "failed" for case in cases)
                return TaskOutcome("failed" if failed else "passed", exit_code=result.returncode, cases=cases)
        if await self.adb.get_state(spec.serial) != "device":
            return TaskOutcome("error", exit_code=result.returncode, error_code="device_disconnected",
                               error_message="device went away during the run")
        log_tail = _tail_file(spec.artifacts_dir / "maestro.log")
        if "is not connected" in log_tail:
            return TaskOutcome("error", exit_code=result.returncode, error_code="device_disconnected",
                               error_message=log_tail)
        return TaskOutcome("error", exit_code=result.returncode, error_code="no_junit",
                           error_message=log_tail or "maestro produced no JUnit report")
