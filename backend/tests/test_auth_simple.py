"""
Simplified authentication tests focusing on core functionality
"""
import pytest
import uuid
from jose import JWTError
from app.services.auth_service import (
    hash_password, verify_password, generate_jwt, verify_jwt, 
    create_refresh_token
)
from app.utils.jwt_utils import encode_token, decode_token
from app.config import settings


def test_password_hashing():
    """Test password hashing and verification"""
    password = "test_password_123"
    
    # Hash password
    hashed = hash_password(password)
    
    # Verify correct password
    assert verify_password(password, hashed) is True
    
    # Verify incorrect password
    assert verify_password("wrong_password", hashed) is False
    
    # Verify different passwords produce different hashes
    hashed2 = hash_password(password)
    assert hashed != hashed2  # Should be different due to random salt


def test_generate_jwt():
    """Test JWT generation with different token types"""
    user_id = uuid.uuid4()
    
    # Test access token generation
    access_token = generate_jwt(user_id, token_type='access')
    assert access_token is not None
    assert isinstance(access_token, str)
    
    # Test refresh token generation
    refresh_token = generate_jwt(user_id, token_type='refresh')
    assert refresh_token is not None
    assert isinstance(refresh_token, str)
    
    # Tokens should be different
    assert access_token != refresh_token


def test_verify_jwt():
    """Test JWT verification and user ID extraction"""
    user_id = uuid.uuid4()
    
    # Generate token
    token = generate_jwt(user_id)
    
    # Verify token and extract user ID
    extracted_user_id = verify_jwt(token)
    assert extracted_user_id == str(user_id)


def test_verify_jwt_invalid_token():
    """Test JWT verification with invalid tokens"""
    # Test malformed token
    with pytest.raises(JWTError):
        verify_jwt("invalid.token.format")
    
    # Test token with wrong secret
    user_id = uuid.uuid4()
    payload = {"sub": str(user_id)}
    wrong_secret_token = encode_token(payload, "wrong_secret", expires_in=3600)
    
    with pytest.raises(JWTError):
        verify_jwt(wrong_secret_token)
    
    # Test token without subject
    payload_no_sub = {"user": str(user_id)}
    token_no_sub = encode_token(payload_no_sub, settings.JWT_SECRET_KEY, expires_in=3600)
    
    with pytest.raises(JWTError):
        verify_jwt(token_no_sub)


def test_create_refresh_token():
    """Test refresh token creation"""
    user_id = uuid.uuid4()
    
    # Create refresh token
    refresh_token = create_refresh_token(user_id)
    
    # Verify it's a valid token
    extracted_user_id = verify_jwt(refresh_token)
    assert extracted_user_id == str(user_id)
    
    # Verify token payload
    payload = decode_token(refresh_token, settings.JWT_SECRET_KEY)
    assert payload["type"] == "refresh"
    assert payload["sub"] == str(user_id)


def test_jwt_token_expiration():
    """Test JWT token expiration differences"""
    user_id = uuid.uuid4()
    
    # Generate access and refresh tokens
    access_token = generate_jwt(user_id, token_type='access')
    refresh_token = generate_jwt(user_id, token_type='refresh')
    
    # Decode both tokens
    access_payload = decode_token(access_token, settings.JWT_SECRET_KEY)
    refresh_payload = decode_token(refresh_token, settings.JWT_SECRET_KEY)
    
    # Refresh token should expire later than access token
    assert refresh_payload["exp"] > access_payload["exp"]
    
    # Verify token types
    assert access_payload["type"] == "access"
    assert refresh_payload["type"] == "refresh"


def test_jwt_uuid_string_handling():
    """Test JWT functions handle both UUID and string inputs"""
    user_uuid = uuid.uuid4()
    user_string = str(user_uuid)
    
    # Test with UUID input
    token_from_uuid = generate_jwt(user_uuid)
    payload_from_uuid = verify_jwt(token_from_uuid)
    
    # Test with string input
    token_from_string = generate_jwt(user_string)
    payload_from_string = verify_jwt(token_from_string)
    
    # Both should return the same user ID as string
    assert payload_from_uuid == user_string
    assert payload_from_string == user_string


def test_jwt_utils_encode_decode():
    """Test JWT utility functions"""
    payload = {
        "sub": str(uuid.uuid4()),
        "type": "access",
        "custom_claim": "test_value"
    }
    
    # Encode token
    token = encode_token(payload, settings.JWT_SECRET_KEY, expires_in=3600)
    assert token is not None
    assert isinstance(token, str)
    
    # Decode token
    decoded_payload = decode_token(token, settings.JWT_SECRET_KEY)
    assert decoded_payload["sub"] == payload["sub"]
    assert decoded_payload["type"] == payload["type"]
    assert decoded_payload["custom_claim"] == payload["custom_claim"]
    assert "exp" in decoded_payload  # Expiration should be added


def test_jwt_utils_expired_token():
    """Test JWT utility with expired token"""
    payload = {"sub": str(uuid.uuid4())}
    
    # Create expired token (expires immediately)
    expired_token = encode_token(payload, settings.JWT_SECRET_KEY, expires_in=-1)
    
    # Should raise JWTError when decoding
    with pytest.raises(JWTError):
        decode_token(expired_token, settings.JWT_SECRET_KEY)


def test_password_edge_cases():
    """Test password hashing with edge cases"""
    # Empty password
    empty_hash = hash_password("")
    assert verify_password("", empty_hash) is True
    assert verify_password("not_empty", empty_hash) is False
    
    # Long password
    long_password = "a" * 1000
    long_hash = hash_password(long_password)
    assert verify_password(long_password, long_hash) is True
    
    # Special characters
    special_password = "!@#$%^&*()_+-=[]{}|;:,.<>?"
    special_hash = hash_password(special_password)
    assert verify_password(special_password, special_hash) is True


def test_jwt_configuration():
    """Test JWT configuration values"""
    # Verify configuration is loaded
    assert settings.JWT_SECRET_KEY is not None
    assert settings.JWT_ALGORITHM == "HS256"
    assert settings.JWT_EXPIRATION_HOURS > 0
    assert settings.REFRESH_TOKEN_EXPIRATION_DAYS > 0
    
    # Verify refresh token expires later than access token
    assert settings.REFRESH_TOKEN_EXPIRATION_DAYS * 24 > settings.JWT_EXPIRATION_HOURS


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
