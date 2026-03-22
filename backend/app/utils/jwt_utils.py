"""
JWT utility functions for token encoding and decoding
"""
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Dict, Any, Optional


def encode_token(
    payload: Dict[str, Any], 
    secret: str, 
    algorithm: str = 'HS256', 
    expires_in: int = 3600
) -> str:
    """
    Encode a JWT token with expiration
    
    Args:
        payload: Data to encode in the token
        secret: Secret key for signing
        algorithm: JWT algorithm (default: HS256)
        expires_in: Token expiration in seconds (default: 1 hour)
    
    Returns:
        Encoded JWT token string
    """
    # Create a copy of payload to avoid modifying original
    token_payload = payload.copy()
    
    # Add expiration time
    expire = datetime.utcnow() + timedelta(seconds=expires_in)
    token_payload.update({"exp": expire})
    
    # Encode the token
    encoded_token = jwt.encode(token_payload, secret, algorithm=algorithm)
    return encoded_token


def decode_token(token: str, secret: str, algorithm: str = 'HS256') -> Dict[str, Any]:
    """
    Decode and verify a JWT token
    
    Args:
        token: JWT token string to decode
        secret: Secret key for verification
        algorithm: JWT algorithm (default: HS256)
    
    Returns:
        Decoded token payload
        
    Raises:
        JWTError: If token is invalid, expired, or malformed
    """
    try:
        payload = jwt.decode(token, secret, algorithms=[algorithm])
        return payload
    except JWTError as e:
        raise JWTError(f"Token validation failed: {str(e)}")


def is_token_expired(token: str, secret: str, algorithm: str = 'HS256') -> bool:
    """
    Check if a token is expired without raising an exception
    
    Args:
        token: JWT token string
        secret: Secret key for verification
        algorithm: JWT algorithm (default: HS256)
    
    Returns:
        True if token is expired, False otherwise
    """
    try:
        decode_token(token, secret, algorithm)
        return False
    except JWTError:
        return True


def get_token_payload(token: str, secret: str, algorithm: str = 'HS256') -> Optional[Dict[str, Any]]:
    """
    Get token payload without raising exceptions
    
    Args:
        token: JWT token string
        secret: Secret key for verification
        algorithm: JWT algorithm (default: HS256)
    
    Returns:
        Token payload if valid, None if invalid
    """
    try:
        return decode_token(token, secret, algorithm)
    except JWTError:
        return None
