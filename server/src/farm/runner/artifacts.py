"""Redact run environment values before storing or interpreting text artifacts."""

import json
import mimetypes
import re
from collections.abc import Iterable
from pathlib import Path
from xml.sax.saxutils import escape


class EnvRedactor:
    def __init__(self, values: Iterable[str] = ()) -> None:
        # Short values produce too many unrelated matches in logs and structured files.
        secrets = {value for value in values if len(value) >= 4}
        variants = set()
        for value in secrets:
            variants.update((value, json.dumps(value, ensure_ascii=True)[1:-1],
                             json.dumps(value, ensure_ascii=False)[1:-1], escape(value),
                             escape(value, {'"': "&quot;", "'": "&apos;"})))
        # Match long/overlapping values first, in a single pass that cannot re-mask its own marker.
        self.pattern = re.compile("|".join(re.escape(value) for value in sorted(variants, key=len, reverse=True))) \
            if variants else None

    def redact(self, text: str) -> str:
        return self.pattern.sub("***", text) if self.pattern else text

    def read_text(self, path: Path) -> str | None:
        """Return redacted UTF-8 text, or None for binary artifacts (never decode with replacement)."""
        media_type = mimetypes.guess_type(path.name)[0] or ""
        if media_type.startswith(("image/", "video/", "audio/")) and media_type != "image/svg+xml":
            return None
        data = path.read_bytes()
        if b"\x00" in data:
            return None
        try:
            return self.redact(data.decode("utf-8"))
        except UnicodeDecodeError:
            return None

    def redact_tree(self, directory: Path) -> None:
        """Sanitize every text file in an attempt without following symlinks or modifying binaries."""
        if not self.pattern or directory.is_symlink():
            return
        root = directory.resolve()
        for path in root.rglob("*"):
            if not path.is_file() or any(p.is_symlink() for p in (path, *path.parents) if p != root):
                continue
            text = self.read_text(path)
            if text is not None:
                data = text.encode("utf-8")
                if data != path.read_bytes():
                    path.write_bytes(data)
