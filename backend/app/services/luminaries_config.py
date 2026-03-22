"""
Luminaries Configuration Service

Loads and validates luminaries.json config file.
Validates that all specialization IDs match the central industries config.
Provides singleton access to luminary data keyed by specialization ID.
"""
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)


class LuminariesConfig:
    """Singleton service for managing luminaries configuration."""

    _instance: Optional["LuminariesConfig"] = None
    _config: Dict = {}
    _settings: Dict = {}
    _luminaries_by_spec: Dict[str, List[Dict]] = {}

    def __init__(self):
        if LuminariesConfig._instance is not None:
            raise RuntimeError("LuminariesConfig is a singleton. Use get_instance() instead.")
        self._load_config()

    def _load_config(self):
        """Load luminaries.json and validate specialization IDs against central config."""
        config_path = Path(__file__).parent.parent.parent / "config" / "luminaries.json"
        try:
            with open(config_path, "r") as f:
                data = json.load(f)

            self._settings = data.get("settings", {})
            self._luminaries_by_spec = data.get("luminaries_by_specialization", {})

            # Validate specialization IDs against central config
            industries_config = IndustriesConfig.get_instance()
            valid_spec_ids = set()
            for industry in industries_config._config.get("industries", []):
                for spec in industry.get("specializations", []):
                    valid_spec_ids.add(spec["id"])

            invalid_specs = set(self._luminaries_by_spec.keys()) - valid_spec_ids
            if invalid_specs:
                logger.warning(
                    f"Luminaries config has unknown specialization IDs: {invalid_specs}. "
                    f"These will be ignored. Valid IDs: {valid_spec_ids}"
                )

            total_luminaries = sum(len(v) for v in self._luminaries_by_spec.values())
            covered_specs = set(self._luminaries_by_spec.keys()) & valid_spec_ids
            logger.info(
                f"Loaded {total_luminaries} luminaries across "
                f"{len(covered_specs)}/{len(valid_spec_ids)} specializations"
            )

        except FileNotFoundError:
            logger.warning(f"Luminaries config not found at {config_path}")
            self._luminaries_by_spec = {}
        except Exception as e:
            logger.error(f"Failed to load luminaries config: {e}")
            self._luminaries_by_spec = {}

    def get_luminaries_for_specialization(self, spec_id: str) -> List[Dict]:
        """Get list of luminaries for a given specialization ID."""
        return self._luminaries_by_spec.get(spec_id, [])

    def get_all_specialization_ids(self) -> List[str]:
        """Get all specialization IDs that have luminaries configured."""
        return list(self._luminaries_by_spec.keys())

    def get_max_articles_per_run(self) -> int:
        """Get max articles per luminary per run."""
        return self._settings.get("max_articles_per_luminary_per_run", 5)

    def get_max_article_age_days(self) -> int:
        """Get max article age in days."""
        return self._settings.get("max_article_age_days", 30)

    def get_feed_timeout(self) -> int:
        """Get feed fetch timeout in seconds."""
        return self._settings.get("feed_timeout_seconds", 15)

    def get_total_luminary_count(self) -> int:
        """Get total number of luminaries across all specializations."""
        return sum(len(v) for v in self._luminaries_by_spec.values())

    @classmethod
    def get_instance(cls) -> "LuminariesConfig":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls):
        """Reset singleton (useful for testing)."""
        cls._instance = None
