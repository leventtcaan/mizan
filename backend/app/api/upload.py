"""
WHAT: POST /upload endpoint — accepts a PDF or CSV bank statement, persists transactions,
      triggers LLM categorization, and returns a job_id with counts.
WHY: Decouples file receipt from display. The endpoint completes synchronously in Phase 2
     (parse + insert + categorize happen in-request); Phase 3 will move categorization
     to a background worker when volumes grow.
BREAKS IF REMOVED: No way for the frontend to submit bank statements.
"""

import uuid
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import upload_ip_limiter, upload_user_limiter
from app.models.user import User
from app.services.categorizer import categorize_batch
from app.services.llm_provider import get_provider
from app.services.pdf_parser import parse_statement
from app.services.transaction_service import bust_progress_cache, insert_transactions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/csv",
    "application/vnd.ms-excel",
}


class UploadResponse(BaseModel):
    job_id: str
    filename: str
    transaction_count: int
    message: str


@router.post("", response_model=UploadResponse)
async def upload_statement(
    request: Request,
    file: Annotated[UploadFile, File(description="PDF or CSV bank statement")],
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """
    WHAT: Full upload pipeline — validate → parse → persist → categorize → commit.
    WHY: All steps run in one DB session so a categorization failure rolls back
         the insert (atomic: either all transactions land with categories or none do).
    BREAKS IF REMOVED: No way to submit bank statements; core app feature unavailable.
    """
    user_id_str = str(current_user.id)
    client_ip = request.client.host if request.client else "unknown"

    if not upload_user_limiter.is_allowed(user_id_str, max_calls=5, window_seconds=86400):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Günlük maksimum 5 yükleme hakkınızı kullandınız. Yarın tekrar deneyin.",
        )

    if not upload_ip_limiter.is_allowed(client_ip, max_calls=3, window_seconds=600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="10 dakikada en fazla 3 yükleme yapılabilir. Lütfen bekleyin.",
        )

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Upload a PDF or CSV.",
        )

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {len(contents) / 1024 / 1024:.1f} MB. Maximum is 10 MB.",
        )

    if len(contents) == 0:
        raise HTTPException(
            status_code=422,
            detail="Uploaded file is empty.",
        )

    job_id = str(uuid.uuid4())
    filename = file.filename or "unknown"

    logger.info(
        "Upload started — job_id=%s user_id=%s filename=%s size=%d bytes",
        job_id, current_user.id, filename, len(contents),
    )

    parse_result = parse_statement(contents, file.content_type, filename)
    logger.info("Parse complete — job_id=%s raw_transactions=%d", job_id, len(parse_result.transactions))

    if not parse_result.transactions:
        return UploadResponse(
            job_id=job_id,
            filename=filename,
            transaction_count=0,
            message="File parsed but no transactions were found. Check the file format.",
        )

    persisted = await insert_transactions(
        parse_result.transactions, current_user.id, session, upload_batch_id=job_id
    )

    llm_available = len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0
    if llm_available:
        provider = get_provider(task_type="categorize")
        await categorize_batch(persisted, provider)
    else:
        logger.info("No LLM key configured — skipping categorization for job_id=%s", job_id)

    await bust_progress_cache(current_user.id, session)
    await session.commit()

    logger.info("Upload complete — job_id=%s transactions_persisted=%d", job_id, len(persisted))

    msg = f"Processed {len(persisted)} transactions successfully."
    if not llm_available:
        msg += " (No LLM key — categories not assigned.)"

    return UploadResponse(
        job_id=job_id,
        filename=filename,
        transaction_count=len(persisted),
        message=msg,
    )
