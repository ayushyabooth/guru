"""Shared FastAPI dependencies (DB, auth, etc.).

This module exists to avoid copy/pasting dependency logic across routers.
"""

import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User, RevokedToken
from app.utils.jwt_utils import decode_token
from app.config import settings


_security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
    db: Session = Depends(get_db),
) -> User:
    """Return the current authenticated user (401 if missing/invalid)."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        token = credentials.credentials
        payload = decode_token(token, settings.JWT_SECRET_KEY, settings.JWT_ALGORITHM)
        user_id_str = payload.get("sub")
        jti = payload.get("jti")
        if not user_id_str:
            raise ValueError("Missing sub claim")
        user_id = uuid.UUID(user_id_str)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication failed")

    # Check revocation blocklist
    if jti and db.query(RevokedToken).filter(RevokedToken.jti == jti).first():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or inactive user")

    return user
