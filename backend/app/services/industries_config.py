"""
Industries and Specializations Configuration Service

Loads and validates the industries-specializations.json config file.
Provides singleton access to industry and specialization data.
"""
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional
from app.utils.name_normalization import NameNormalizer

logger = logging.getLogger(__name__)


class IndustriesConfig:
    """Singleton service for managing industries and specializations configuration"""
    
    _instance: Optional['IndustriesConfig'] = None
    _config: Dict = {}
    _industries_by_id: Dict = {}
    
    def __init__(self):
        """Initialize and load configuration"""
        if IndustriesConfig._instance is not None:
            raise RuntimeError("IndustriesConfig is a singleton. Use get_instance() instead.")
        self.load_config()
    
    def load_config(self):
        """Load and validate JSON config from file"""
        try:
            # Get path relative to backend directory
            config_path = Path(__file__).parent.parent.parent / "config" / "industries-specializations.json"
            
            if not config_path.exists():
                raise FileNotFoundError(f"Config file not found at {config_path}")
            
            with open(config_path, 'r', encoding='utf-8') as f:
                self._config = json.load(f)
            
            # Validate structure
            if "industries" not in self._config:
                raise ValueError("Config must have 'industries' key")
            
            if not isinstance(self._config["industries"], list):
                raise ValueError("'industries' must be a list")
            
            # Build lookup dictionary for fast access
            self._industries_by_id = {
                ind["id"]: ind for ind in self._config["industries"]
            }

            # Build flat visual config map (id → visual props) for all items
            self._visual_config: Dict[str, Dict] = {}

            # Validate each industry has required fields
            for ind in self._config["industries"]:
                required_fields = ["id", "name", "emoji", "color_primary", "color_secondary", "specializations"]
                for field in required_fields:
                    if field not in ind:
                        raise ValueError(f"Industry {ind.get('id', 'unknown')} missing required field: {field}")

                # Add industry to visual config
                self._visual_config[ind["id"]] = {
                    "id": ind["id"],
                    "name": ind["name"],
                    "emoji": ind["emoji"],
                    "icon": ind.get("icon", "newspaper"),
                    "color_primary": ind["color_primary"],
                    "color_secondary": ind.get("color_secondary", ind["color_primary"]),
                    "category": "core",
                }

                # Validate specializations
                if not isinstance(ind["specializations"], list):
                    raise ValueError(f"Industry {ind['id']} specializations must be a list")

                for spec in ind["specializations"]:
                    spec_required = ["id", "name", "description"]
                    for field in spec_required:
                        if field not in spec:
                            raise ValueError(
                                f"Specialization in {ind['id']} missing required field: {field}"
                            )
                    # Add specialization to visual config
                    self._visual_config[spec["id"]] = {
                        "id": spec["id"],
                        "name": spec["name"],
                        "emoji": spec.get("emoji", ind["emoji"]),
                        "icon": spec.get("icon", ind.get("icon", "newspaper")),
                        "color_primary": spec.get("color_primary", ind["color_primary"]),
                        "category": ind["id"],
                    }

            # Load interests if present
            self._interests = self._config.get("interests", [])
            for interest in self._interests:
                self._visual_config[interest["id"]] = {
                    "id": interest["id"],
                    "name": interest["name"],
                    "emoji": interest.get("emoji", "📰"),
                    "icon": interest.get("icon", "newspaper"),
                    "color_primary": interest.get("color_primary", "#6B7280"),
                    "category": "interest",
                }

            total_specs = sum(len(ind['specializations']) for ind in self._config['industries'])
            logger.info(f"✅ Loaded {len(self._config['industries'])} industries with "
                       f"{total_specs} specializations and {len(self._interests)} interests")
            
        except Exception as e:
            logger.error(f"❌ Failed to load industries config: {e}")
            raise
    
    def get_industries(self) -> List[Dict]:
        """
        Return all industries with basic info (no specializations)
        
        Returns:
            List of dicts with id, name, emoji, colors, description
        """
        return [
            {
                "id": ind["id"],
                "name": ind["name"],
                "emoji": ind["emoji"],
                "color_primary": ind["color_primary"],
                "color_secondary": ind["color_secondary"],
                "description": ind.get("description", "")
            }
            for ind in self._config["industries"]
        ]
    
    def get_industry(self, industry_id: str) -> Optional[Dict]:
        """
        Get a single industry by ID
        
        Args:
            industry_id: Industry identifier
            
        Returns:
            Industry dict or None if not found
        """
        return self._industries_by_id.get(industry_id)
    
    def get_specializations(self, industry_id: str) -> Optional[List[Dict]]:
        """
        Get all specializations for a specific industry
        
        Args:
            industry_id: Industry identifier
            
        Returns:
            List of specialization dicts or None if industry not found
        """
        industry = self._industries_by_id.get(industry_id)
        if industry:
            return industry["specializations"]
        return None
    
    def validate_industry(self, industry_id: str) -> bool:
        """
        Check if industry_id exists in config
        
        Args:
            industry_id: Industry identifier to validate
            
        Returns:
            True if valid, False otherwise
        """
        return industry_id in self._industries_by_id
    
    def validate_specialization(self, industry_id: str, spec_id: str) -> bool:
        """
        Check if spec_id exists within the given industry
        
        Args:
            industry_id: Industry identifier
            spec_id: Specialization identifier to validate
            
        Returns:
            True if valid, False otherwise
        """
        specs = self.get_specializations(industry_id)
        if specs:
            return any(s["id"] == spec_id for s in specs)
        return False
    
    def validate_specializations(self, industry_id: str, spec_ids: List[str]) -> tuple[bool, Optional[str]]:
        """
        Validate multiple specializations for an industry
        
        Args:
            industry_id: Industry identifier
            spec_ids: List of specialization identifiers
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        if not self.validate_industry(industry_id):
            return False, f"Invalid industry_id: {industry_id}"
        
        specs = self.get_specializations(industry_id)
        valid_spec_ids = {s["id"] for s in specs}
        
        for spec_id in spec_ids:
            if spec_id not in valid_spec_ids:
                return False, f"Invalid specialization '{spec_id}' for industry '{industry_id}'"
        
        return True, None
    
    def validate_additional_interests(self, core_industry_id: str, interest_ids: List[str]) -> tuple[bool, Optional[str]]:
        """
        Validate additional interest industries (must be different from core)
        
        Args:
            core_industry_id: User's core industry
            interest_ids: List of additional industry IDs
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        if len(interest_ids) > 2:
            return False, "Maximum 2 additional interests allowed"
        
        for interest_id in interest_ids:
            if interest_id == core_industry_id:
                return False, f"Additional interest cannot be same as core industry: {interest_id}"
            
            if not self.validate_industry(interest_id):
                return False, f"Invalid additional interest industry: {interest_id}"
        
        return True, None
    
    def get_display_name(self, item_id: str, item_type: str = 'industry') -> Optional[str]:
        """
        Get display name for an industry or specialization ID
        
        Args:
            item_id: Industry or specialization ID
            item_type: 'industry' or 'specialization'
            
        Returns:
            Display name or None if not found
        """
        if item_type == 'industry':
            industry = self._industries_by_id.get(item_id)
            return industry['name'] if industry else None
        
        # Search for specialization across all industries
        for industry in self._config['industries']:
            for spec in industry['specializations']:
                if spec['id'] == item_id:
                    return spec['name']
        
        return None
    
    def normalize_id(self, display_name: str, item_type: str = 'industry') -> Optional[str]:
        """
        Convert a display name back to its ID

        Args:
            display_name: Display name (e.g., "Food & Beverage")
            item_type: 'industry' or 'specialization'

        Returns:
            ID or None if not found
        """
        normalized = NameNormalizer.normalize_display_to_id(display_name)

        if item_type == 'industry':
            # Try exact match first
            if normalized in self._industries_by_id:
                return normalized

            # Try fuzzy match
            for ind_id, ind_data in self._industries_by_id.items():
                if NameNormalizer.fuzzy_match(display_name, ind_data['name']):
                    return ind_id
        else:
            # Search specializations — use multi-pass strategy:
            # Pass 1: Exact ID match (normalized input == spec ID)
            for industry in self._config['industries']:
                for spec in industry['specializations']:
                    if normalized == spec['id']:
                        return spec['id']

            # Pass 2: Normalized name match (normalize both display names and compare)
            # This catches cases like "Specialty Retail & E-commerce" where the
            # normalized form ("specialty_retail_and_e_commerce") differs from the
            # config ID ("specialty_retail_ecommerce") but both display names are identical
            for industry in self._config['industries']:
                for spec in industry['specializations']:
                    spec_name_normalized = NameNormalizer.normalize_display_to_id(spec['name'])
                    if normalized == spec_name_normalized:
                        return spec['id']

            # Pass 3: Fuzzy match (last resort, may have false positives)
            for industry in self._config['industries']:
                for spec in industry['specializations']:
                    if NameNormalizer.fuzzy_match(display_name, spec['name']):
                        return spec['id']

        return None
    
    def normalize_industry_name(self, raw_name: str) -> str:
        """
        Normalize an industry name to its canonical casing from config.

        Performs case-insensitive matching against config industry names.
        Returns the canonical name if found, otherwise the original input.

        Examples:
            'consumer' -> 'Consumer'
            'TECHNOLOGY' -> 'Technology'
            'finance' -> 'Finance'
        """
        if not raw_name:
            return raw_name
        lower = raw_name.strip().lower()
        for ind in self._config.get("industries", []):
            if ind["name"].lower() == lower:
                return ind["name"]
        # No match found — return as-is
        return raw_name

    def get_visual_config(self) -> Dict[str, Dict]:
        """
        Get flat visual config map for ALL industries, specializations, and interests.
        Key = item ID, Value = { id, name, emoji, icon, color_primary, category }

        This is the single source of truth for frontend color/icon rendering.
        """
        return dict(self._visual_config)

    def get_interests(self) -> List[Dict]:
        """
        Get all interests with visual config.

        Returns:
            List of interest dicts with id, name, description, emoji, icon, color_primary
        """
        return list(self._interests)

    def get_visual_for(self, item_id: str) -> Optional[Dict]:
        """
        Get visual config for a single item by ID.

        Args:
            item_id: Industry, specialization, or interest ID

        Returns:
            Visual config dict or None
        """
        return self._visual_config.get(item_id)

    @classmethod
    def get_instance(cls) -> 'IndustriesConfig':
        """
        Get singleton instance of IndustriesConfig
        
        Returns:
            IndustriesConfig singleton instance
        """
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    @classmethod
    def reset_instance(cls):
        """Reset singleton instance (useful for testing)"""
        cls._instance = None

    def get_settings(self) -> Dict:
        """
        Get global settings from config

        Returns:
            Settings dictionary with article_expiration_days, auto_cleanup_on_startup, etc.
        """
        return self._config.get("settings", {
            "article_expiration_days": 30,
            "auto_cleanup_on_startup": True
        })

    def get_article_expiration_days(self) -> int:
        """
        Get the article expiration period in days

        Returns:
            Number of days after which articles are considered expired
        """
        settings = self.get_settings()
        return settings.get("article_expiration_days", 30)

    def is_auto_cleanup_enabled(self) -> bool:
        """
        Check if auto-cleanup of expired articles is enabled

        Returns:
            True if auto-cleanup should run on startup
        """
        settings = self.get_settings()
        return settings.get("auto_cleanup_on_startup", True)

    def get_default_industry(self) -> tuple[str, str]:
        """
        Get the default industry (first in config)

        Returns:
            Tuple of (industry_id, industry_display_name)
        """
        industries = self._config.get("industries", [])
        if industries:
            first = industries[0]
            return first.get("id", "consumer"), first.get("name", "Consumer")
        return "consumer", "Consumer"

    def get_default_specialization(self, industry_id: str = None) -> tuple[str, str]:
        """
        Get the default specialization for an industry (first in list)

        Args:
            industry_id: Industry ID (uses default industry if None)

        Returns:
            Tuple of (specialization_id, specialization_display_name)
        """
        if industry_id is None:
            industry_id, _ = self.get_default_industry()

        industry = self._industries_by_id.get(industry_id)
        if industry:
            specs = industry.get("specializations", [])
            if specs:
                first = specs[0]
                return first.get("id", "food_beverage"), first.get("name", "Food & Beverage")

        return "food_beverage", "Food & Beverage"

    def get_defaults(self) -> Dict:
        """
        Get all default values for new user profiles

        Returns:
            Dict with industry_id, industry_name, specialization_id, specialization_name
        """
        ind_id, ind_name = self.get_default_industry()
        spec_id, spec_name = self.get_default_specialization(ind_id)
        return {
            "industry_id": ind_id,
            "industry_name": ind_name,
            "specialization_id": spec_id,
            "specialization_name": spec_name
        }
