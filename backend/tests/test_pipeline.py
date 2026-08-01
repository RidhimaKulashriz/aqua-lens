"""End-to-end pipeline test using the sample satellite provider."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from uuid import UUID

from sqlmodel import Session

from app.core.database import get_engine
from app.models.evidence import FieldEvidence, Odor, WaterColor
from app.models.report import Report
from app.models.risk_assessment import RiskAssessment
from app.models.session import MonitoringSession, SessionStatus
from app.models.spectral_index import SpectralIndex
from app.models.water_body import WaterBody
from app.services.pipeline import rescore_with_new_evidence, run_full
from app.utils.geo import area_km2, centroid_geojson


def _seed_water_body(db: Session, sample_polygon: dict) -> WaterBody:
    wb = WaterBody(
        name="Test Lake",
        description=None,
        geometry=sample_polygon,
        centroid=centroid_geojson(sample_polygon),
        area_km2=area_km2(sample_polygon),
        source="test",
    )
    db.add(wb)
    db.commit()
    db.refresh(wb)
    return wb


def _seed_session(db: Session, wb: WaterBody) -> MonitoringSession:
    sess = MonitoringSession(
        water_body_id=wb.id,
        start_date=date.today() - timedelta(days=14),
        end_date=date.today(),
        max_cloud_cover=30.0,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def test_run_full_creates_indices_risk_and_report(db_engine, sample_polygon):
    with Session(get_engine()) as db:
        wb = _seed_water_body(db, sample_polygon)
        sess = _seed_session(db, wb)
        session_id: UUID = sess.id

    run_full(session_id)

    with Session(get_engine()) as db:
        refreshed = db.get(MonitoringSession, session_id)
        assert refreshed is not None
        assert refreshed.status is SessionStatus.COMPLETE
        assert refreshed.scene_id is not None
        assert refreshed.scene_provider == "aqualens-sample"

        indices = db.query(SpectralIndex).filter(SpectralIndex.session_id == session_id).all()
        assert len(indices) == 6

        risk = db.query(RiskAssessment).filter(RiskAssessment.session_id == session_id).one()
        assert risk.recommendation
        assert risk.reasoning
        assert risk.limitations

        report = db.query(Report).filter(Report.session_id == session_id).one()
        assert Path(report.file_path).exists()
        assert report.byte_size > 0
        assert Path(report.file_path).read_bytes().startswith(b"%PDF")


def test_rescore_uses_new_evidence(db_engine, sample_polygon):
    with Session(get_engine()) as db:
        wb = _seed_water_body(db, sample_polygon)
        sess = _seed_session(db, wb)
        session_id = sess.id

    run_full(session_id)

    with Session(get_engine()) as db:
        baseline = db.query(RiskAssessment).filter(RiskAssessment.session_id == session_id).one()
        baseline_score = baseline.score

        # Add severe evidence.
        ev = FieldEvidence(
            session_id=session_id,
            water_color=WaterColor.GREEN,
            odor=Odor.ROTTEN,
            algae_present=True,
            dead_fish_count=12,
            rainfall_mm=18.0,
            complaints_count=4,
        )
        db.add(ev)
        db.commit()

    rescore_with_new_evidence(session_id)

    with Session(get_engine()) as db:
        updated = db.query(RiskAssessment).filter(RiskAssessment.session_id == session_id).one()
        assert updated.score >= baseline_score


def test_run_full_completes_when_reasoning_is_unavailable(db_engine, sample_polygon, monkeypatch):
    """A dead Gemini quota must not fail the session.

    The numeric score doesn't depend on the LLM, so the run finishes with
    the deterministic narrative and records why in ``model_id``.
    """
    from app.services import pipeline, reasoning

    def _quota_exhausted(**_kwargs):
        raise RuntimeError(
            "Gemini reasoning failed after exhausting 1 key(s): 429 RESOURCE_EXHAUSTED"
        )

    monkeypatch.setattr(reasoning, "generate_reasoning", _quota_exhausted)
    monkeypatch.setattr(pipeline.reasoning, "generate_reasoning", _quota_exhausted)

    with Session(get_engine()) as db:
        wb = _seed_water_body(db, sample_polygon)
        session_id = _seed_session(db, wb).id

    run_full(session_id)

    with Session(get_engine()) as db:
        refreshed = db.get(MonitoringSession, session_id)
        assert refreshed is not None
        assert refreshed.status is SessionStatus.COMPLETE

        risk = db.query(RiskAssessment).filter(RiskAssessment.session_id == session_id).one()
        assert "quota exhausted" in risk.model_id
        assert len(risk.model_id) <= 80
        assert "language model was unavailable" in risk.limitations

        report = db.query(Report).filter(Report.session_id == session_id).one()
        assert Path(report.file_path).exists()


def test_orphaned_sessions_are_failed_at_startup(db_engine, sample_polygon):
    """A run interrupted by a restart can never resume, so it must not stay stuck."""
    from app.services.maintenance import ORPHAN_MESSAGE, fail_orphaned_sessions

    with Session(get_engine()) as db:
        wb = _seed_water_body(db, sample_polygon)
        stuck = _seed_session(db, wb)
        stuck.status = SessionStatus.PROCESSING
        db.add(stuck)
        done = _seed_session(db, wb)
        done.status = SessionStatus.COMPLETE
        db.add(done)
        db.commit()
        stuck_id, done_id = stuck.id, done.id

    assert fail_orphaned_sessions() == 1

    with Session(get_engine()) as db:
        assert db.get(MonitoringSession, stuck_id).status is SessionStatus.FAILED
        assert db.get(MonitoringSession, stuck_id).status_message == ORPHAN_MESSAGE
        assert db.get(MonitoringSession, done_id).status is SessionStatus.COMPLETE
