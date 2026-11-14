"""Structured AI answers through the host's authenticated, ephemeral Codex CLI."""
import json
import os
import signal
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from farm.ai.client import AiProviderError, AiRequest, AiResponse, ImagePart, TextPart, codex_env


class CodexCliClient:
    provider = "codex"

    def __init__(self, codex_bin: str = "codex", model: str | None = None, timeout: float = 300, *, secrets=()):
        self.codex_bin, self.configured_model, self.timeout = codex_bin, model, timeout
        self.model = model or "codex (default model)"
        self.secrets = tuple(secrets)

    def _error(self, reason: str, stderr: str) -> AiProviderError:
        # Redact before truncation so a tail boundary cannot leave part of a secret visible.
        secrets = [*self.secrets, *(value for key, value in os.environ.items() if key.startswith("FARM_"))]
        for secret in sorted(set(secrets), key=len, reverse=True):
            if secret:
                for variant in {secret, json.dumps(secret)[1:-1], json.dumps(secret, ensure_ascii=False)[1:-1]}:
                    stderr = stderr.replace(variant, "[REDACTED]")
        tail = stderr.strip()[-2000:]
        return AiProviderError(f"Codex {reason}" + (f": {tail}" if tail else ""))

    def complete(self, request: AiRequest, schema: dict) -> AiResponse:
        with TemporaryDirectory(prefix="farm-codex-") as temp:
            root = Path(temp).resolve()
            schema_path, output_path = root / "schema.json", root / "out.json"
            schema_path.write_text(json.dumps(schema), encoding="utf-8")
            argv = [self.codex_bin, "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral",
                    "--sandbox", "read-only", "--output-schema", str(schema_path), "-o", str(output_path), "--json"]
            if self.configured_model:
                argv += ["-m", self.configured_model]
            image_index = 0
            for part in request.parts:
                if isinstance(part, ImagePart):
                    path = root / f"image-{image_index}.png"
                    path.write_bytes(part.data)
                    argv += ["-i", str(path)]
                    image_index += 1
            argv.append("-")
            prompt = request.system + "\n\n" + "\n\n".join(p.text for p in request.parts if isinstance(p, TextPart))
            try:
                # A separate group lets timeout cleanup reap Codex and any children it starts.
                with subprocess.Popen(argv, cwd=root, env=codex_env(), stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True) as proc:
                    try:
                        stdout, stderr = proc.communicate(prompt.encode("utf-8"), timeout=self.timeout)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        _, stderr = proc.communicate()
                        raise self._error(f"timed out after {self.timeout} seconds", stderr.decode("utf-8", "replace"))
                    stderr_text = stderr.decode("utf-8", "replace")
                    if proc.returncode != 0:
                        raise self._error(f"exited with status {proc.returncode}", stderr_text)
            except OSError as exc:
                raise self._error("could not start", str(exc)) from None
            try:
                raw = output_path.read_text(encoding="utf-8")
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise self._error("returned invalid JSON", stderr_text)
            except (OSError, UnicodeError, ValueError):
                raise self._error("returned invalid JSON", stderr_text) from None
            input_tokens, output_tokens = 0, 0
            for line in stdout.decode("utf-8", "replace").splitlines():
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict) and event.get("type") == "turn.completed":
                    usage = event.get("usage") or {}
                    input_tokens = usage.get("input_tokens", 0)
                    output_tokens = usage.get("output_tokens", 0)
            return AiResponse(data=data, input_tokens=input_tokens, output_tokens=output_tokens,
                              model=self.model, raw=raw)
