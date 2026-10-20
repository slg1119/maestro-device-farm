from fastapi import FastAPI

from farm import __version__
from farm.api.errors import register_error_handlers
from farm.api.routes import devices, health
from farm.apps.apk import AndroguardApkParser, ApkParser
from farm.config import Settings
from farm.db.engine import Database


def create_app(settings: Settings | None = None, *, db: Database | None = None,
               apk_parser: ApkParser | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="maestro-device-farm", version=__version__)
    app.state.settings = settings
    app.state.db = db or Database(settings.database_path)
    app.state.apk_parser = apk_parser or AndroguardApkParser()
    register_error_handlers(app)
    for module in (health, devices):
        app.include_router(module.router, prefix="/api/v1")
    return app
