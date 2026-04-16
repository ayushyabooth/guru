from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List
import os
from pathlib import Path

# Load .env file before Settings class is instantiated
# This ensures environment variables are available for pydantic-settings
# Use absolute path to ensure it works regardless of working directory
_env_path = Path(__file__).parent.parent / '.env'

# Manual env loading - always load to ensure vars are present
# This runs at module import time, before Settings() is instantiated
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()
                # Strip quotes if present
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                # Set the environment variable (override if not set)
                if key not in os.environ or not os.environ[key]:
                    os.environ[key] = value


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "sqlite:///./test.db"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # JWT Configuration
    JWT_SECRET_KEY: str = Field(..., env="JWT_SECRET_KEY")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 2  # 2 hours (industry standard for access tokens)
    REFRESH_TOKEN_EXPIRATION_DAYS: int = 30  # 30 days for refresh tokens (industry standard)
    
    # Claude API Configuration
    ANTHROPIC_API_KEY: str = Field(..., env="ANTHROPIC_API_KEY")
    CLAUDE_SONNET_MODEL: str = Field(default="claude-sonnet-4-5-20250929", env="CLAUDE_SONNET_MODEL")
    CLAUDE_HAIKU_MODEL: str = Field(default="claude-haiku-4-5-20251001", env="CLAUDE_HAIKU_MODEL")
    CLAUDE_OPUS_MODEL: str = Field(default="claude-opus-4-5-20251101", env="CLAUDE_OPUS_MODEL")

    # ElevenLabs TTS Configuration (Phase 2 Audio Recap)
    ELEVENLABS_API_KEY: str = Field(default="", env="ELEVENLABS_API_KEY")
    ELEVENLABS_NARRATOR_VOICE_ID: str = Field(default="21m00Tcm4TlvDq8ikWAM", env="ELEVENLABS_NARRATOR_VOICE_ID")
    ELEVENLABS_ANALYST_VOICE_ID: str = Field(default="ErXwobaYiN019PkySvjV", env="ELEVENLABS_ANALYST_VOICE_ID")
    ELEVENLABS_MODEL_ID: str = Field(default="eleven_multilingual_v2", env="ELEVENLABS_MODEL_ID")
    AUDIO_STORAGE_DIR: str = Field(default="static/audio", env="AUDIO_STORAGE_DIR")

    # App
    APP_ENV: str = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # Signup gating
    SIGNUP_INVITE_CODES: str = "GURU2026"  # comma-separated invite codes

    # Expert links directory (empty = auto-detect local path)
    EXPERT_LINKS_DIR: str = ""
    
    # Article filtering
    ARTICLE_TIME_WINDOW_DAYS: int = 14  # 2 weeks - articles older than this are excluded from feeds

    # 3-Tier Ingestion Settings (Tier 1=Expert Links, Tier 2=Luminary RSS, Tier 3=Web Discovery)
    TIER1_SCHEDULE_HOURS: int = 168  # Weekly (was 2h — $50/day cost)
    TIER2_SCHEDULE_HOURS: int = 168  # Weekly (was 6h)
    TIER3_SCHEDULE_HOURS: int = 168  # Weekly (was 12h)
    TIER2_MAX_ARTICLES_PER_LUMINARY: int = 5  # Max articles per luminary per run
    TIER2_AGE_FILTER_DAYS: int = 30  # Only ingest articles from last N days
    TIER3_RESULTS_PER_SPECIALIZATION: int = 8  # Max search results per specialization

    # Content Quality Pipeline
    QUALITY_GATE_TIER1: float = 0.35  # Expert links quality threshold
    QUALITY_GATE_TIER2: float = 0.35  # Luminary quality threshold
    QUALITY_GATE_TIER3: float = 0.50  # Web discovery quality threshold
    QUALITY_MIN_WORD_COUNT: int = 150
    QUALITY_MAX_WORD_COUNT: int = 15000
    QUALITY_MAX_LINK_RATIO: float = 0.05
    QUALITY_MIN_PARAGRAPHS: int = 2
    QUALITY_MIN_PARAGRAPH_WORDS: int = 15
    QUALITY_MIN_CONTENT_DENSITY: float = 0.1

    # Auto-Essential Detection
    AUTO_ESSENTIAL_SCORE_ANY_TIER: float = 0.85
    AUTO_ESSENTIAL_SCORE_TIER2: float = 0.75  # Luminary auto-essential threshold

    # Content Deduplication
    DEDUP_CONTENT_SIMILARITY_THRESHOLD: float = 0.92
    DEDUP_CONTENT_WINDOW_DAYS: int = 7

    # CORS
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:8081", "http://127.0.0.1:8081",
        "http://localhost:8100", "http://localhost:3000",
        "http://localhost:8000", "http://localhost:19006",
        "https://dist-guru8.vercel.app",
        "https://dist-69e8jssok-guru8.vercel.app",
        "https://mobile-guru8.vercel.app",
        "https://dist-ayushyabooth-guru8.vercel.app",
    ]
    
    class Config:
        env_file = ".env"


settings = Settings()
