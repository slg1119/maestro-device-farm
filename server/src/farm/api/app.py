from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from farm import __version__
from farm.api.errors import register_error_handlers
from farm.api.routes import apps, devices, events, health, runs, tasks, workspaces
from farm.apps.apk import AndroguardApkParser, ApkParser
from farm.config import Settings
from farm.db.engine import Database
from farm.flows.syntax import MaestroSyntaxChecker, SyntaxChecker
from farm.workspaces.poller import WorkspacePoller


def create_app(settings: Settings | None = None, *, db: Database | None = None,
               apk_parser: ApkParser | None = None, syntax_checker: SyntaxChecker | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        poller = WorkspacePoller(app.state.db, settings) if settings.git_poll_sec > 0 else None
        if poller:
            poller.start()
        try:
            yield
        finally:
            if poller:
                poller.stop()

    app = FastAPI(title="maestro-device-farm", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db or Database(settings.database_path)
    app.state.apk_parser = apk_parser or AndroguardApkParser()
    app.state.syntax_checker = syntax_checker or MaestroSyntaxChecker()
    register_error_handlers(app)
    for module in (health, devices, runs, tasks, apps, events, workspaces):
        app.include_router(module.router, prefix="/api/v1")
    return app
