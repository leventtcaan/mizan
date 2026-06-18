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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.services.categorizer import categorize_batch
from app.services.llm_provider import get_provider
from app.services.pdf_parser import parse_statement
from app.services.transaction_service import insert_transactions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

# WHY: 10 MB limit — typical Turkish bank PDF is under 1 MB; 10 MB gives headroom
# for multi-month statements while blocking accidental large file uploads.
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/csv",
    "application/vnd.ms-excel",
}

# WHY: Hardcoded dev seed user — gives the upload endpoint a real user_id to attach
# rows to before auth exists. This UUID must match the seed created at startup in main.py.
# Replaced by JWT-extracted user identity in Phase 3.
DEV_SEED_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class UploadResponse(BaseModel):
    """
    WHAT: Response body for POST /upload.
    WHY: job_id is the correlation handle for logs and future async status polling.
         transaction_count lets the frontend confirm how many rows were extracted.
    """

    job_id: str
    filename: str
    transaction_count: int
    message: str


@router.post("", response_model=UploadResponse)
async def upload_statement(
    file: Annotated[UploadFile, File(description="PDF or CSV bank statement")],
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """
    WHAT: Full upload pipeline — validate → parse → persist → categorize → commit.
    WHY: All steps run in one DB session so a categorization failure rolls back
         the insert (atomic: either all transactions land with categories or none do).
    BREAKS IF REMOVED: No way to submit bank statements; core app feature unavailable.
    """
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
        "Upload started — job_id=%s filename=%s size=%d bytes content_type=%s",
        job_id, filename, len(contents), file.content_type,
    )

    # Step 1: extract raw rows from the file
    parse_result = parse_statement(contents, file.content_type, filename)
    logger.info("Parse complete — job_id=%s raw_transactions=%d", job_id, len(parse_result.transactions))

    if not parse_result.transactions:
        return UploadResponse(
            job_id=job_id,
            filename=filename,
            transaction_count=0,
            message="File parsed but no transactions were found. Check the file format.",
        )

    # Step 2: persist raw transactions to DB, tagged with job_id as the batch identifier
    persisted = await insert_transactions(
        parse_result.transactions, DEV_SEED_USER_ID, session, upload_batch_id=job_id
    )

    # Step 3: LLM categorization — skipped silently when no API key is configured.
    # WHY: Allow the app to work in offline/dev mode without an LLM key;
    # transactions are saved with category=None and can be categorized later.
    llm_available = len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0
    if llm_available:
        provider = get_provider(task_type="categorize")
        await categorize_batch(persisted, provider)
    else:
        logger.info("No LLM key configured — skipping categorization for job_id=%s", job_id)

    # Step 4: commit atomically — inserts and any category updates land together
    await session.commit()

    logger.info(
        "Upload complete — job_id=%s transactions_persisted=%d",
        job_id, len(persisted),
    )

    msg = f"Processed {len(persisted)} transactions successfully."
    if not llm_available:
        msg += " (No LLM key — categories not assigned.)"

    return UploadResponse(
        job_id=job_id,
        filename=filename,
        transaction_count=len(persisted),
        message=msg,
    )
