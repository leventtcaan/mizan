"""
WHAT: Financial report endpoints — a period-scoped, presentable document (GET
      /reports/financial) plus a raw CSV appendix (GET /reports/transactions.csv).
WHY: Additive surface; reuses services/report.py (which reuses the same conversion +
      ledger logic as the net-worth summary). The PDF is produced client-side via a
      print-optimized page, so no heavy PDF dependency is added to the backend.
BREAKS IF REMOVED: The /reports page has no data and no CSV export.
"""

import logging

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.report import (
    build_report, build_report_csv, build_report_xlsx, build_transactions_csv,
)

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])

_PERIODS = {
    "this_month", "last_month", "quarter", "last_quarter", "ytd", "last_year",
    "last_30", "last_90", "last_12_months", "all",
}


def _period(p: str) -> str:
    return p if p in _PERIODS else "this_month"


def _filename(period: str, lang: str, ext: str) -> str:
    """A distinguishable, localized file name carrying the actual date range —
    e.g. mizan-rapor-2026-05-23-2026-06-23.csv / mizan-report-all-2026-06-23.xlsx."""
    from app.services.report import resolve_period

    start, end, key = resolve_period(period)
    word = "rapor" if lang == "tr" else "report"
    span = f"{start.isoformat()}-{end.isoformat()}" if start else f"all-{end.isoformat()}"
    return f"mizan-{word}-{span}.{ext}"


@router.get("/financial")
async def financial_report(
    period: str = Query(default="this_month"),
    display_currency: str = Query(default="TRY"),
    lang: str = Query(default="tr"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Structured, period-scoped report. Frontend renders + prints it to PDF."""
    return await build_report(current_user.id, session, _period(period), display_currency, lang)


@router.get("/financial.csv", response_class=PlainTextResponse)
async def financial_report_csv(
    period: str = Query(default="this_month"),
    display_currency: str = Query(default="TRY"),
    lang: str = Query(default="tr"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlainTextResponse:
    """Full report as a single structured CSV — every section the PDF/Excel has."""
    csv_text = await build_report_csv(current_user.id, session, _period(period), display_currency, lang)
    filename = _filename(_period(period), lang, "csv")
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/transactions.csv", response_class=PlainTextResponse)
async def transactions_csv(
    period: str = Query(default="this_month"),
    display_currency: str = Query(default="TRY"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlainTextResponse:
    """Raw transaction appendix for analysts who want only the underlying numbers."""
    csv_text = await build_transactions_csv(current_user.id, session, _period(period), display_currency)
    filename = f"mizan-transactions-{_period(period)}.csv"
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/financial.xlsx")
async def financial_report_xlsx(
    period: str = Query(default="this_month"),
    display_currency: str = Query(default="TRY"),
    lang: str = Query(default="tr"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Multi-sheet Excel workbook of the report (summary + holdings + transactions)."""
    data = await build_report_xlsx(current_user.id, session, _period(period), display_currency, lang)
    filename = _filename(_period(period), lang, "xlsx")
    return Response(
        content=data,
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
