"""Serves the dashboard build (web/dist) with a single-page-app fallback."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from farm.api.errors import ApiError

RESERVED = ("api/", "docs", "redoc", "openapi.json")


def mount_dashboard(app: FastAPI, dist: Path) -> bool:
    """Adds a catch-all GET route after the API routes. Returns False when there is no build to serve."""
    index = dist / "index.html"
    if not index.is_file():
        return False
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def dashboard(path: str) -> FileResponse:
        if path.startswith(RESERVED):
            raise ApiError(404, "not_found", f"/{path} not found")
        target = (root / path).resolve()
        if path and target.is_relative_to(root) and target.is_file():
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(target, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return True
