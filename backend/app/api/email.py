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


def clarifin_from() -> str:
    """Sender for ALL outbound mail. The address comes from RESEND_FROM_EMAIL, but the
    display name is always forced to "Clarifin" — a stale env var (pre-rebrand "Mizan
    <...>") must never leak the old brand into inboxes."""
    raw = (settings.RESEND_FROM_EMAIL or "").strip()
    if "<" in raw and raw.endswith(">"):
        addr = raw[raw.index("<") + 1:-1].strip()
    else:
        addr = raw
    if not addr:
        addr = "onboarding@resend.dev"
    return f"Clarifin <{addr}>"


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
            "from": clarifin_from(),
            "to": [current_user.email],
            "subject": "Haftalık Finansal Özet — Clarifin",
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


# ── Weekly "money brief" email — recurring counterpart to the Post-Upload Brief ──

def _render_brief_html(brief: dict) -> str:
    """Dark-theme HTML email: one headline, up to 3 bullets, one CTA button."""
    headline: str = brief["headline"]
    bullets: list[str] = brief.get("bullets", [])
    cta_label: str = brief["cta_label"]
    cta_url: str = brief["cta_url"]

    bullet_rows = "".join(
        f"""
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2A2A2A;color:#d1d5db;font-size:15px;line-height:1.6;">
            <span style="color:#2F9E8F;margin-right:8px;">•</span>{b}
          </td>
        </tr>"""
        for b in bullets
    )

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0F0F0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr><td style="padding:0 0 20px;text-align:center;">
          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">⚖ Clarifin</span>
        </td></tr>

        <tr><td style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:16px;padding:28px;">
          <p style="margin:0 0 20px;font-size:17px;line-height:1.6;color:#f3f4f6;">{headline}</p>
          <table width="100%" cellpadding="0" cellspacing="0">{bullet_rows}</table>
          <div style="text-align:center;margin-top:24px;">
            <a href="{cta_url}" style="display:inline-block;background:#176B5B;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">{cta_label}</a>
          </div>
        </td></tr>

        <tr><td style="padding:20px 8px 0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
            Clarifin · Settings → Weekly Money Brief to turn this off.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _render_brief_text(brief: dict) -> str:
    lines = [brief["headline"], ""]
    lines += [f"- {b}" for b in brief.get("bullets", [])]
    lines += ["", f"{brief['cta_label']} {brief['cta_url']}", "", "Clarifin"]
    return "\n".join(lines)


def _render_verification_html(verify_url: str, lang: str) -> str:
    tr = lang == "tr"
    headline = "E-postanı doğrula" if tr else "Verify your email"
    body = (
        "Clarifin hesabını etkinleştirmek için aşağıdaki butona tıkla. Bu bağlantı 24 saat geçerlidir."
        if tr else
        "Tap the button below to activate your Clarifin account. This link is valid for 24 hours."
    )
    cta = "E-postamı doğrula" if tr else "Verify my email"
    ignore = (
        "Bu hesabı sen oluşturmadıysan bu e-postayı yok sayabilirsin."
        if tr else
        "If you didn't create this account, you can safely ignore this email."
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0F0F0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="padding:0 0 20px;text-align:center;">
          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">⚖ Clarifin</span>
        </td></tr>
        <tr><td style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:16px;padding:28px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#f3f4f6;">{headline}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#d1d5db;">{body}</p>
          <div style="text-align:center;margin-top:8px;">
            <a href="{verify_url}" style="display:inline-block;background:#176B5B;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">{cta}</a>
          </div>
          <p style="margin:20px 0 0;font-size:12px;color:#6b7280;line-height:1.6;word-break:break-all;">{verify_url}</p>
        </td></tr>
        <tr><td style="padding:20px 8px 0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">{ignore}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _render_reset_html(reset_url: str, lang: str) -> str:
    tr = lang == "tr"
    headline = "Şifreni sıfırla" if tr else "Reset your password"
    body = (
        "Yeni bir şifre belirlemek için aşağıdaki butona tıkla. Bu bağlantı 1 saat geçerlidir."
        if tr else
        "Tap the button below to choose a new password. This link is valid for 1 hour."
    )
    cta = "Yeni şifre belirle" if tr else "Choose a new password"
    ignore = (
        "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin — şifren değişmedi."
        if tr else
        "If you didn't request this, you can safely ignore this email — your password hasn't changed."
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0F0F0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="padding:0 0 20px;text-align:center;">
          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">⚖ Clarifin</span>
        </td></tr>
        <tr><td style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:16px;padding:28px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#f3f4f6;">{headline}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#d1d5db;">{body}</p>
          <div style="text-align:center;margin-top:8px;">
            <a href="{reset_url}" style="display:inline-block;background:#176B5B;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">{cta}</a>
          </div>
          <p style="margin:20px 0 0;font-size:12px;color:#6b7280;line-height:1.6;word-break:break-all;">{reset_url}</p>
        </td></tr>
        <tr><td style="padding:20px 8px 0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">{ignore}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


async def send_password_reset_email(to_email: str, reset_url: str, lang: str = "tr") -> str:
    """
    Render + send the password-reset email. Returns the Resend email id.
    Raises RuntimeError if RESEND_API_KEY is missing; re-raises Resend errors.
    """
    if not len(settings.RESEND_API_KEY) > 0:
        raise RuntimeError("RESEND_API_KEY not configured")

    html = _render_reset_html(reset_url, lang)
    subject = "Clarifin — Şifreni sıfırla" if lang == "tr" else "Clarifin — Reset your password"

    def _send() -> str:
        import resend  # local import — only when actually sending
        resend.api_key = settings.RESEND_API_KEY
        try:
            response = resend.Emails.send({
                "from": clarifin_from(),
                "to": [to_email],
                "subject": subject,
                "html": html,
            })
        except Exception as e:
            logger.error("Resend password-reset send failed: %s: %s", type(e).__name__, str(e))
            raise
        return response.get("id", "") if isinstance(response, dict) else str(response)

    email_id = await asyncio.to_thread(_send)
    logger.info("Password-reset email sent — to=%s email_id=%s lang=%s", to_email, email_id, lang)
    return email_id


async def send_verification_email(to_email: str, verify_url: str, lang: str = "tr") -> str:
    """
    Render + send the account verification email. Returns the Resend email id.
    Raises RuntimeError if RESEND_API_KEY is missing; re-raises Resend errors.
    """
    if not len(settings.RESEND_API_KEY) > 0:
        raise RuntimeError("RESEND_API_KEY not configured")

    html = _render_verification_html(verify_url, lang)
    subject = "Clarifin — E-postanı doğrula" if lang == "tr" else "Clarifin — Verify your email"

    def _send() -> str:
        import resend  # local import — only when actually sending
        resend.api_key = settings.RESEND_API_KEY
        try:
            response = resend.Emails.send({
                "from": clarifin_from(),
                "to": [to_email],
                "subject": subject,
                "html": html,
            })
        except Exception as e:
            logger.error("Resend verification send failed: %s: %s", type(e).__name__, str(e))
            raise
        return response.get("id", "") if isinstance(response, dict) else str(response)

    email_id = await asyncio.to_thread(_send)
    logger.info("Verification email sent — to=%s email_id=%s lang=%s", to_email, email_id, lang)
    return email_id


async def send_email_brief(to_email: str, brief: dict, lang: str = "tr") -> str:
    """
    Render and send the weekly money-brief email. Returns the Resend email id.
    Raises RuntimeError if RESEND_API_KEY is missing; re-raises Resend errors.
    """
    if not len(settings.RESEND_API_KEY) > 0:
        raise RuntimeError("RESEND_API_KEY not configured")

    html = _render_brief_html(brief)
    text = _render_brief_text(brief)
    subject = brief["subject"]

    def _send() -> str:
        import resend  # local import — only when actually sending
        resend.api_key = settings.RESEND_API_KEY
        try:
            response = resend.Emails.send({
                "from": clarifin_from(),
                "to": [to_email],
                "subject": subject,
                "html": html,
                "text": text,
            })
        except Exception as e:
            # Surface the real Resend error (domain not verified, bad API key format,
            # invalid from-address) instead of a cut-off traceback.
            logger.error("Resend send failed: %s: %s", type(e).__name__, str(e))
            raise
        return response.get("id", "") if isinstance(response, dict) else str(response)

    email_id = await asyncio.to_thread(_send)
    logger.info("Money brief sent — to=%s email_id=%s lang=%s", to_email, email_id, lang)
    return email_id
