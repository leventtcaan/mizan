"""
WHAT: POST /upload endpoint — accepts a PDF or CSV bank statement, returns a job_id.
WHY: Decouples file receipt from processing. The endpoint returns immediately;
     heavy LLM work happens asynchronously in Phase 2.
BREAKS IF REMOVED: No way for the frontend to submit bank statements.
"""

import uuid
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.pdf_parser import parse_statement

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


class UploadResponse(BaseModel):
    """
    WHAT: Response body for POST /upload.
    WHY: job_id lets the frontend poll for processing status in Phase 2.
         filename is echoed back so the UI can confirm which file was received.
    """

    job_id: str
    filename: str
    message: str


@router.post("", response_model=UploadResponse)
async def upload_statement(
    file: Annotated[UploadFile, File(description="PDF or CSV bank statement")],
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """
    WHAT: Receives a bank statement file, validates it, and returns a job_id.
    WHY: Validation happens here at the boundary — content type and size are checked
         before any processing, so malformed uploads fail fast with a clear error.
    BREAKS IF REMOVED: Clients can upload arbitrary files; LLM parser receives garbage input.
    """
    # WHY: content_type from UploadFile reflects the MIME type the client declared.
    # Not cryptographically verified — Phase 2 will add magic-byte validation.
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Upload a PDF or CSV.",
        )

    # WHY: Read the full file once here to enforce size limit.
    # Streaming reads would require tracking byte count manually — not worth it at this scale.
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

    # WHY: job_id is a UUID generated here, not by the DB. This lets us return it
    # immediately without a DB round-trip. Phase 2 will persist a Job row keyed on this UUID.
    job_id = str(uuid.uuid4())

    logger.info(
        "File received — job_id=%s filename=%s size=%d bytes content_type=%s",
        job_id,
        file.filename,
        len(contents),
        file.content_type,
    )

    result = parse_statement(contents, file.content_type, file.filename or "unknown")

    logger.info(
        "Parse complete — job_id=%s transactions=%d pages=%d",
        job_id,
        len(result.transactions),
        result.page_count,
    )

    return UploadResponse(
        job_id=job_id,
        filename=file.filename or "unknown",
        message=f"File received. Extracted {len(result.transactions)} transactions.",
    )
