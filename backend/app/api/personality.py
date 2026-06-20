import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.personality import analyze_personality

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/personality", tags=["personality"])


class PersonalityResponse(BaseModel):
    type: str
    description: str
    strengths: list[str]
    watch_out: list[str]
    tip: str
    cached: bool = False


@router.get("", response_model=PersonalityResponse)
async def get_personality(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PersonalityResponse:
    """
    WHAT: Returns financial personality analysis — cached per upload batch.
    WHY: Single LLM call over 3 months of data is expensive; caching it in
         behavioral_profile.personality_cache means subsequent loads are instant.
         Cache automatically invalidates when the user uploads a new statement
         (personality_batch_id no longer matches the latest batch).
    """
    from app.services.transaction_service import get_latest_batch_id
    from app.services.behavioral_coach import get_or_create_profile
    import json

    latest_batch_id = await get_latest_batch_id(current_user.id, session)
    profile = await get_or_create_profile(current_user.id, session)

    cached = (
        profile.personality_cache is not None
        and profile.personality_batch_id == latest_batch_id
        and latest_batch_id is not None
    )

    result = await analyze_personality(current_user.id, session)

    return PersonalityResponse(
        type=result["type"],
        description=result["description"],
        strengths=result.get("strengths") or [],
        watch_out=result.get("watch_out") or [],
        tip=result.get("tip") or "",
        cached=cached,
    )
