"""Housekeeping for sessions orphaned by a process restart.

The pipeline runs inside FastAPI ``BackgroundTasks``, i.e. in the same
process that serves requests. When that process goes away mid-run — a
deploy, an OOM kill, or Render's free-tier idle spin-down — the row is
left at ``processing`` forever and the UI spins indefinitely. Nothing
ever picks it back up, so the only honest thing to do is mark it failed
at boot and tell the user to re-run.
"""

from __future__ import annotations

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.database import get_engine
from app.core.logging import get_logger
from app.models.base import utcnow
from app.models.session import MonitoringSession, SessionStatus

LOGGER = get_logger(__name__)

ORPHAN_MESSAGE = (
    "Interrupted before it finished — the server restarted while this run was in "
    "flight. Start a new session for this water body to try again."
)


def fail_orphaned_sessions() -> int:
    """Fail every unfinished session. Returns how many rows were updated.

    Safe to call only at startup: a freshly booted process has no
    pipeline of its own running yet, so anything still ``pending`` or
    ``processing`` belongs to a process that no longer exists.
    """
    with Session(get_engine()) as db:
        rows = list(
            db.exec(
                select(MonitoringSession).where(
                    or_(
                        MonitoringSession.status == SessionStatus.PENDING,
                        MonitoringSession.status == SessionStatus.PROCESSING,
                    )
                )
            ).all()
        )
        for row in rows:
            row.status = SessionStatus.FAILED
            row.status_message = ORPHAN_MESSAGE
            row.updated_at = utcnow()
            db.add(row)
        if rows:
            db.commit()
            LOGGER.warning("Marked %d orphaned session(s) as failed", len(rows))
        return len(rows)
