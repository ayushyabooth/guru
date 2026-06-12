"""
Configuration API routes for industries and specializations

Provides endpoints for frontend to load configurable onboarding data.
"""
from fastapi import APIRouter, HTTPException, status, Response
from typing import List, Dict
import logging

from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["config"])

# Static config changes only on deploy — let browsers/CDN cache it for an hour
# so repeat clients skip the round trip entirely (perf: high-latency links).
CONFIG_CACHE_CONTROL = "public, max-age=3600"


@router.get("/config/industries", response_model=List[Dict])
async def get_industries(response: Response):
    """
    Get all available industries for onboarding

    Returns:
        List of industries with id, name, emoji, colors, description
    """
    try:
        config = IndustriesConfig.get_instance()
        industries = config.get_industries()
        response.headers["Cache-Control"] = CONFIG_CACHE_CONTROL
        logger.info(f"Returning {len(industries)} industries")
        return industries
    except Exception as e:
        logger.error(f"Error fetching industries: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load industries configuration"
        )


@router.get("/config/visual-config", response_model=Dict[str, Dict])
async def get_visual_config(response: Response):
    """
    Get flat visual config map for ALL industries, specializations, and interests.

    Returns a dict keyed by item ID, each with:
    { id, name, emoji, icon, color_primary, category }

    This is the single source of truth for frontend color/icon rendering.
    Adding a new industry or specialization to industries-specializations.json
    automatically makes it available here.
    """
    try:
        config = IndustriesConfig.get_instance()
        response.headers["Cache-Control"] = CONFIG_CACHE_CONTROL
        return config.get_visual_config()
    except Exception as e:
        logger.error(f"Error fetching visual config: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load visual configuration"
        )


@router.get("/config/interests", response_model=List[Dict])
async def get_interests(response: Response):
    """
    Get all available interests for onboarding

    Returns:
        List of interests with id, name, description, emoji, icon, color_primary
    """
    try:
        config = IndustriesConfig.get_instance()
        response.headers["Cache-Control"] = CONFIG_CACHE_CONTROL
        return config.get_interests()
    except Exception as e:
        logger.error(f"Error fetching interests: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load interests configuration"
        )


@router.get("/config/industries/{industry_id}/specializations", response_model=List[Dict])
async def get_specializations(industry_id: str, response: Response):
    """
    Get all specializations for a specific industry
    
    Args:
        industry_id: Industry identifier (e.g., 'consumer', 'technology')
        
    Returns:
        List of specializations with id, name, description
    """
    try:
        config = IndustriesConfig.get_instance()
        
        # Validate industry exists
        if not config.validate_industry(industry_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Industry not found: {industry_id}"
            )
        
        specs = config.get_specializations(industry_id)
        response.headers["Cache-Control"] = CONFIG_CACHE_CONTROL
        logger.info(f"Returning {len(specs)} specializations for industry '{industry_id}'")
        return specs
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching specializations for {industry_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load specializations"
        )


@router.get("/config/industries/{industry_id}", response_model=Dict)
async def get_industry(industry_id: str, response: Response):
    """
    Get details for a specific industry
    
    Args:
        industry_id: Industry identifier
        
    Returns:
        Industry details including specializations
    """
    try:
        config = IndustriesConfig.get_instance()
        
        industry = config.get_industry(industry_id)
        if not industry:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Industry not found: {industry_id}"
            )

        response.headers["Cache-Control"] = CONFIG_CACHE_CONTROL
        return industry
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching industry {industry_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load industry"
        )
