from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI

from farm import __version__
from farm.ai.client import AiClient
from farm.api.errors import register_error_handlers
from farm.api.routes import ai, apps, devices, events, health, runs, stream, tasks, workspaces
from farm.api.web import mount_dashboard
from farm.apps.apk import AndroguardApkParser, ApkParser
from farm.config import Settings
from farm.db.engine import Database
from farm.flows.syntax import MaestroSyntaxChecker, SyntaxChecker
from farm.workspaces.poller import WorkspacePoller


def create_app(settings: Settings | None = None, *, db: Database | None = None,
               apk_parser: ApkParser | None = None, syntax_checker: SyntaxChecker | None = None,
               ai_client: AiClient | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        poller = WorkspacePoller(app.state.db, settings) if settings.git_poll_sec > 0 else None
        if poller:
            poller.start()
        try:
            if ai.enabled(app):
                ai.ensure_runner(app)
            yield
        finally:
            if poller:
                poller.stop()
            if app.state.ai_runner is not None:
                app.state.ai_runner.stop()
                app.state.ai_runner = None

    app = FastAPI(title="maestro-device-farm", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db or Database(settings.database_path)
    app.state.apk_parser = apk_parser or AndroguardApkParser()
    app.state.syntax_checker = syntax_checker or MaestroSyntaxChecker()
    app.state.ai_client = ai_client
    app.state.ai_runner = None
    app.state.ai_runner_lock = Lock()
    register_error_handlers(app)
    for module in (health, devices, runs, tasks, apps, events, workspaces, ai, stream):
        app.include_router(module.router, prefix="/api/v1")
    mount_dashboard(app, settings.web_dist)  # last, so the catch-all never shadows an API route
    return app
