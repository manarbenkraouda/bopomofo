"""Statistics built from the saved answers (stats.py): the Stats screen, the challenges, and the CSV export."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from .. import stats

router = APIRouter()


@router.get("/stats")
def stats_get(days: int = 30, area: str = ""):
    return stats.compute(days if days > 0 else None, area or None)


@router.get("/stats/challenges")
def stats_challenges():
    return {"challenges": stats.challenges()}


@router.get("/stats/export.csv")
def stats_export():
    return Response(
        stats.export_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="bopomofo-history.csv"'},
    )
