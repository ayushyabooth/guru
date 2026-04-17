import hashlib
import secrets
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, Union
import uuid
from app.config import settings
from app.utils.jwt_utils import encode_token, decode_token


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_legacy_sha256(plain_password: str, hashed_password: str) -> bool:
    """Verify a legacy SHA-256 salted hash (format  salt:hash)."""
    try:
        salt, stored_hash = hashed_password.split(":", 1)
        password_hash = hashlib.sha256((plain_password + salt).encode()).hexdigest()
        return password_hash == stored_hash
    except ValueError:
        return False


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash (supports bcrypt and legacy SHA-256)."""
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    # Legacy SHA-256 format (salt:hash)
    return _verify_legacy_sha256(plain_password, hashed_password)


def generate_jwt(user_id: Union[str, uuid.UUID], token_type: str = 'access') -> str:
    """
    Generate JWT token for user
    
    Args:
        user_id: User ID (UUID or string)
        token_type: Type of token ('access' or 'refresh')
    
    Returns:
        JWT token string
    """
    # Convert UUID to string if needed
    user_id_str = str(user_id) if isinstance(user_id, uuid.UUID) else user_id
    
    # Create payload
    payload = {
        "sub": user_id_str,
        "type": token_type,
        "iat": datetime.utcnow(),
        "jti": str(uuid.uuid4()),
    }
    
    # Set expiration based on token type
    if token_type == 'access':
        expires_in = settings.JWT_EXPIRATION_HOURS * 3600  # Convert hours to seconds
    elif token_type == 'refresh':
        expires_in = settings.REFRESH_TOKEN_EXPIRATION_DAYS * 24 * 3600  # Convert days to seconds
    else:
        expires_in = 3600  # Default 1 hour
    
    return encode_token(payload, settings.JWT_SECRET_KEY, settings.JWT_ALGORITHM, expires_in)


def verify_jwt(token: str) -> str:
    """
    Verify JWT token and return user ID
    
    Args:
        token: JWT token string
    
    Returns:
        User ID string
        
    Raises:
        JWTError: If token is invalid or expired
    """
    try:
        payload = decode_token(token, settings.JWT_SECRET_KEY, settings.JWT_ALGORITHM)
        user_id = payload.get("sub")
        if not user_id:
            raise JWTError("Token missing user ID")
        return user_id
    except JWTError as e:
        raise JWTError(f"Token verification failed: {str(e)}")


def create_refresh_token(user_id: Union[str, uuid.UUID]) -> str:
    """
    Create refresh token for user
    
    Args:
        user_id: User ID (UUID or string)
    
    Returns:
        Refresh token string
    """
    return generate_jwt(user_id, token_type='refresh')


# Legacy functions for backward compatibility
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create JWT access token (legacy function)"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def verify_token(token: str):
    """Verify and decode JWT token (legacy function)"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None
