"""Regression coverage for the production migration chain."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_migrations_apply_to_sqlite(tmp_path: Path) -> None:
    """The documented SQLite development path must reach the latest revision."""
    database_path = tmp_path / "aqualens.db"
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": f"sqlite:///{database_path}",
            "AQUALENS_FAKE_GEMINI": "1",
            "AQUALENS_USE_SAMPLE_PROVIDER": "1",
        }
    )

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[1],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    with sqlite3.connect(database_path) as connection:
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        status_message = connection.execute("PRAGMA table_info(monitoring_sessions)").fetchall()

    assert revision == ("13abce7853b5",)
    status_column = next(row for row in status_message if row[1] == "status_message")
    assert status_column[2] == "VARCHAR(2000)"
