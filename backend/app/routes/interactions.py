"""
Interaction tracking and annotation CRUD endpoints.
"""
import uuid
import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.interaction import UserInteraction, UserAnnotation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["interactions"])


# ─── Interaction Tracking ──────────────────────────────────────────

class TrackInteractionRequest(BaseModel):
    interaction_type: str = Field(..., pattern="^(spotlight_tap|link_open|highlight|annotation_expand)$")
    article_id: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict] = None


class TrackInteractionResponse(BaseModel):
    id: str
    interaction_type: str
    created_at: datetime


@router.post("/interactions/track", response_model=TrackInteractionResponse, status_code=status.HTTP_201_CREATED)
async def track_interaction(
    request: TrackInteractionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fire-and-forget interaction tracking. Lightweight endpoint."""
    article_uuid = None
    if request.article_id:
        try:
            article_uuid = uuid.UUID(request.article_id)
        except ValueError:
            pass

    interaction = UserInteraction(
        user_id=current_user.id,
        article_id=article_uuid,
        interaction_type=request.interaction_type,
        content=request.content,
        metadata_json=request.metadata,
    )
    db.add(interaction)
    db.commit()
    db.refresh(interaction)

    return TrackInteractionResponse(
        id=str(interaction.id),
        interaction_type=interaction.interaction_type,
        created_at=interaction.created_at,
    )


# ─── Annotation CRUD ───────────────────────────────────────────────

class CreateAnnotationRequest(BaseModel):
    highlighted_text: str
    note_text: Optional[str] = None
    color: str = "gold"
    paragraph_index: Optional[int] = None
    start_offset: int
    end_offset: int


class AnnotationResponse(BaseModel):
    id: str
    highlighted_text: str
    note_text: Optional[str] = None
    color: str
    paragraph_index: Optional[int] = None
    start_offset: int
    end_offset: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class UpdateAnnotationRequest(BaseModel):
    note_text: Optional[str] = None
    color: Optional[str] = None


@router.post("/articles/{article_id}/annotations", response_model=AnnotationResponse, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    article_id: str,
    request: CreateAnnotationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a highlight / note annotation on an article."""
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid article ID")

    annotation = UserAnnotation(
        user_id=current_user.id,
        article_id=article_uuid,
        highlighted_text=request.highlighted_text,
        note_text=request.note_text,
        color=request.color,
        paragraph_index=request.paragraph_index,
        start_offset=request.start_offset,
        end_offset=request.end_offset,
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)

    return _annotation_response(annotation)


@router.get("/articles/{article_id}/annotations", response_model=List[AnnotationResponse])
async def get_annotations(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all annotations for an article by the current user."""
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid article ID")

    annotations = db.query(UserAnnotation).filter(
        UserAnnotation.user_id == current_user.id,
        UserAnnotation.article_id == article_uuid,
    ).order_by(UserAnnotation.paragraph_index, UserAnnotation.start_offset).all()

    return [_annotation_response(a) for a in annotations]


@router.put("/annotations/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: str,
    request: UpdateAnnotationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update note text or color on an annotation."""
    try:
        ann_uuid = uuid.UUID(annotation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid annotation ID")

    annotation = db.query(UserAnnotation).filter(
        UserAnnotation.id == ann_uuid,
        UserAnnotation.user_id == current_user.id,
    ).first()

    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    if request.note_text is not None:
        annotation.note_text = request.note_text
    if request.color is not None:
        annotation.color = request.color

    db.commit()
    db.refresh(annotation)
    return _annotation_response(annotation)


@router.delete("/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove an annotation."""
    try:
        ann_uuid = uuid.UUID(annotation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid annotation ID")

    annotation = db.query(UserAnnotation).filter(
        UserAnnotation.id == ann_uuid,
        UserAnnotation.user_id == current_user.id,
    ).first()

    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    db.delete(annotation)
    db.commit()


def _annotation_response(a: UserAnnotation) -> AnnotationResponse:
    return AnnotationResponse(
        id=str(a.id),
        highlighted_text=a.highlighted_text,
        note_text=a.note_text,
        color=a.color,
        paragraph_index=a.paragraph_index,
        start_offset=a.start_offset,
        end_offset=a.end_offset,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )
