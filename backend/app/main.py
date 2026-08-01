"""FastAPI entry point for AquaLens."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.services.maintenance import fail_orphaned_sessions


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    settings = get_settings()
    logger = get_logger("app")
    logger.info(
        "AquaLens %s starting · sample-provider=%s fake-gemini=%s",
        __version__,
        settings.aqualens_use_sample_provider,
        settings.aqualens_fake_gemini,
    )
    # Run Alembic migrations on startup for SQLite (development)
    if settings.database_url.startswith("sqlite"):
        try:
            from alembic.command import upgrade
            from alembic.config import Config

            alembic_cfg = Config(Path(__file__).parent.parent / "alembic.ini")
            upgrade(alembic_cfg, "head")
            logger.info("Database migrations completed successfully")
        except Exception as e:
            logger.warning(f"Database migration warning: {e}")

    # Sessions left mid-flight by the previous process can never resume —
    # the pipeline runs in-process via BackgroundTasks.
    try:
        fail_orphaned_sessions()
    except Exception as e:
        logger.warning("Orphaned-session sweep failed: %s", e)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AquaLens",
        description="Autonomous freshwater monitoring agent — public REST API.",
        version=__version__,
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # Very permissive CORS to ensure no "failed to fetch"
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    app.include_router(api_router)

    upload_dir: Path = settings.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(upload_dir)), name="uploads")

    return app


app = create_app()
