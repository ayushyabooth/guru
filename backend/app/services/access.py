"""
Who may see what: admin, beta and synthetic accounts, decided on the server.

- Admins (ADMIN_EMAILS): trace views, ops endpoints and paid triggers. A human
  admin signs in with the normal login, and the token must be an ACCESS token:
  a long-lived refresh token is never enough for admin.
- Machine reader (ADMIN_API_KEY): read-only access to traces for Claude Code and
  scripts, sent as the X-Admin-Key header. Off unless the key is set and at
  least 32 characters long. It writes one thing: the eval runner's results
  (admin_issues.py), which carry no user data and cost nothing to store.
- Beta (BETA_EMAILS): early features such as Report a bug. Admins are beta too.
- Synthetic (SYNTHETIC_EMAIL_DOMAINS, default example.com): persona and test
  accounts. Every agent trace is labeled with it, so real-user metrics can
  exclude test traffic.

The allowlists are environment variables on Railway: no schema change, no
screen that can grant itself access, and revoking is one variable edit.
Hiding a screen is never the security; every admin endpoint depends on one of
the checks below.
"""
import hmac
import os
import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.utils.jwt_utils import decode_token

MIN_API_KEY_LENGTH = 32
_bearer = HTTPBearer(auto_error=False)


def _allowlist(var: str, default: str = "") -> set:
    return {e.strip().lower() for e in (os.getenv(var) or default).split(",") if e.strip()}


def _email(user) -> str:
    return (getattr(user, "email", None) or "").strip().lower()


def is_admin(user) -> bool:
    email = _email(user)
    return bool(email) and email in _allowlist("ADMIN_EMAILS")


def is_beta(user) -> bool:
    email = _email(user)
    return bool(email) and (email in _allowlist("BETA_EMAILS") or is_admin(user))


def is_synthetic(user) -> bool:
    """Persona and test accounts, by email domain. Admins are never synthetic: the
    owner's own account may sit on a test domain, and it is real use."""
    email = _email(user)
    if not email or is_admin(user):
        return False
    domains = {d.lstrip("@") for d in _allowlist("SYNTHETIC_EMAIL_DOMAINS", "example.com")}
    return "@" in email and email.rsplit("@", 1)[1] in domains


def _admin_from_token(credentials: Optional[HTTPAuthorizationCredentials], db: Session) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials, settings.JWT_SECRET_KEY, settings.JWT_ALGORITHM)
        user_id = uuid.UUID(str(payload.get("sub")))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication failed")
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token required")
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or inactive user")
    if not is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


async def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """A signed-in human admin: an access token whose account is on ADMIN_EMAILS."""
    return _admin_from_token(credentials, db)


async def require_beta(user: User = Depends(get_current_user)) -> User:
    """A signed-in beta tester (BETA_EMAILS, or an admin). As a dependency it runs before
    the body's fields are validated, so a non-beta account gets a 403, never a hint about the form."""
    if not is_beta(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Beta only")
    return user


@dataclass
class AdminReader:
    kind: str                      # "user" (signed-in admin) | "key" (X-Admin-Key)
    user: Optional[User] = None


async def require_admin_reader(
    x_admin_key: Optional[str] = Header(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> AdminReader:
    """Read-only admin access: a signed-in admin, or Claude Code and scripts holding
    ADMIN_API_KEY. Use only on endpoints that read; writes take require_admin. The one
    exception is the eval-run upload (admin_issues.py): verdicts, no user data, free to store."""
    if x_admin_key is not None:
        key = os.getenv("ADMIN_API_KEY") or ""
        if len(key) >= MIN_API_KEY_LENGTH and hmac.compare_digest(x_admin_key.encode(), key.encode()):
            return AdminReader(kind="key")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin key")
    return AdminReader(kind="user", user=_admin_from_token(credentials, db))
