import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.weekly_summary import generate_summary, render_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["email"])


class PreferencesRequest(BaseModel):
    email_weekly_enabled: bool


class PreferencesResponse(BaseModel):
    email_weekly_enabled: bool


class PreviewResponse(BaseModel):
    html: str


class SendResponse(BaseModel):
    message: str
    email_id: str | None = None


@router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences(
    current_user: User = Depends(get_current_user),
) -> PreferencesResponse:
    return PreferencesResponse(email_weekly_enabled=current_user.email_weekly_enabled)


@router.post("/preferences", response_model=PreferencesResponse)
async def set_preferences(
    body: PreferencesRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PreferencesResponse:
    current_user.email_weekly_enabled = body.email_weekly_enabled
    session.add(current_user)
    await session.commit()
    logger.info(
        "Email preference updated — user=%s enabled=%s",
        current_user.id,
        body.email_weekly_enabled,
    )
    return PreferencesResponse(email_weekly_enabled=body.email_weekly_enabled)


@router.post("/weekly-preview", response_model=PreviewResponse)
async def weekly_preview(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PreviewResponse:
    summary = await generate_summary(current_user.id, session)
    html = render_email(summary, current_user.email)
    return PreviewResponse(html=html)


@router.post("/weekly-send", response_model=SendResponse)
async def weekly_send(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SendResponse:
    if not len(settings.RESEND_API_KEY) > 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-posta servisi yapılandırılmamış (RESEND_API_KEY eksik).",
        )

    summary = await generate_summary(current_user.id, session)
    html = render_email(summary, current_user.email)

    def _send() -> str:
        import resend  # local import — only needed when actually sending
        resend.api_key = settings.RESEND_API_KEY
        response = resend.Emails.send({
            "from": "Mizan <noreply@mizan.app>",
            "to": [current_user.email],
            "subject": "Haftalık Finansal Özet — Mizan",
            "html": html,
        })
        return response.get("id", "") if isinstance(response, dict) else str(response)

    try:
        email_id = await asyncio.to_thread(_send)
        logger.info("Weekly summary sent — user=%s email_id=%s", current_user.id, email_id)
        return SendResponse(message="E-posta başarıyla gönderildi.", email_id=email_id)
    except Exception as exc:
        logger.error("Resend API error — user=%s error=%s", current_user.id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.",
        ) from exc
