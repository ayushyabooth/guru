"""
Name Normalization Utilities

Provides consistent string normalization for industries and specializations
to handle variations in naming conventions across the system.
"""
import re
from typing import List, Set
import logging

logger = logging.getLogger(__name__)


class NameNormalizer:
    """
    Utility class for normalizing industry and specialization names
    to handle variations in formatting (underscores, spaces, ampersands, case)
    """
    
    @staticmethod
    def normalize_id_to_display(id_str: str) -> str:
        """
        Convert an ID format to display format
        
        Examples:
            food_beverage -> Food & Beverage
            ai_machine_learning -> AI & Machine Learning
            
        Args:
            id_str: ID in snake_case format
            
        Returns:
            Display name with proper capitalization and formatting
        """
        # Replace underscores with spaces
        words = id_str.split('_')
        
        # Capitalize each word, with special handling for acronyms
        capitalized = []
        for word in words:
            # Check if word is likely an acronym (all caps or common acronyms)
            if word.upper() in ['AI', 'ML', 'IT', 'HR', 'PR', 'ESG', 'IOT', 'API', 'AWS', 'GCP']:
                capitalized.append(word.upper())
            else:
                capitalized.append(word.capitalize())
        
        # Join with spaces and replace common patterns
        result = ' '.join(capitalized)
        
        # Replace " And " with " & " for common patterns
        result = re.sub(r'\b[Aa]nd\b', '&', result)
        
        return result
    
    @staticmethod
    def normalize_display_to_id(display_str: str) -> str:
        """
        Convert a display format to ID format
        
        Examples:
            Food & Beverage -> food_beverage
            AI & Machine Learning -> ai_machine_learning
            
        Args:
            display_str: Display name with spaces and special characters
            
        Returns:
            ID in snake_case format
        """
        # Convert to lowercase
        result = display_str.lower()
        
        # Replace & with 'and'
        result = result.replace('&', 'and')
        
        # Replace spaces and hyphens with underscores
        result = re.sub(r'[\s\-]+', '_', result)
        
        # Remove any remaining special characters
        result = re.sub(r'[^\w_]', '', result)
        
        # Clean up multiple underscores
        result = re.sub(r'_+', '_', result)
        
        # Strip leading/trailing underscores
        result = result.strip('_')
        
        return result
    
    @staticmethod
    def generate_search_patterns(id_str: str) -> List[str]:
        """
        Generate all possible search patterns for a given ID
        to match against database values with different formats
        
        Examples:
            food_beverage -> [
                'food_beverage',
                'food beverage',
                'food & beverage',
                'Food & Beverage',
                'foodbeverage',
                'food-beverage'
            ]
            
        Args:
            id_str: ID in snake_case format
            
        Returns:
            List of possible string variations to search for
        """
        patterns = set()
        
        # Original ID
        patterns.add(id_str)
        
        # Lowercase with spaces
        spaced = id_str.replace('_', ' ')
        patterns.add(spaced)
        
        # With ampersand
        if ' ' in spaced:
            # Replace middle spaces with &
            words = spaced.split()
            if len(words) > 1:
                # Try replacing each space with &
                for i in range(len(words) - 1):
                    variant = ' '.join(words[:i+1]) + ' & ' + ' '.join(words[i+1:])
                    patterns.add(variant)
                    # Also add capitalized version
                    patterns.add(variant.title())
        
        # Capitalized versions
        patterns.add(spaced.title())
        patterns.add(spaced.capitalize())
        
        # No separators
        patterns.add(id_str.replace('_', ''))
        
        # With hyphens
        patterns.add(id_str.replace('_', '-'))
        
        # Uppercase (for acronyms)
        patterns.add(id_str.upper())
        
        return list(patterns)
    
    @staticmethod
    def fuzzy_match(search_term: str, target: str, threshold: float = 0.8) -> bool:
        """
        Perform fuzzy matching between two strings
        
        Args:
            search_term: The term to search for
            target: The target string to match against
            threshold: Similarity threshold (0-1)
            
        Returns:
            True if strings match above threshold
        """
        # Normalize both strings
        search_normalized = NameNormalizer.normalize_display_to_id(search_term)
        target_normalized = NameNormalizer.normalize_display_to_id(target)
        
        # Exact match after normalization
        if search_normalized == target_normalized:
            return True
        
        # Check if one contains the other
        if search_normalized in target_normalized or target_normalized in search_normalized:
            return True
        
        # Simple Levenshtein-like check (character overlap)
        search_chars = set(search_normalized)
        target_chars = set(target_normalized)
        
        if not search_chars or not target_chars:
            return False
        
        overlap = len(search_chars & target_chars)
        similarity = overlap / max(len(search_chars), len(target_chars))
        
        return similarity >= threshold
    
    @staticmethod
    def build_sql_like_patterns(id_str: str) -> List[str]:
        """
        Build SQL LIKE patterns for database queries
        
        Args:
            id_str: ID in snake_case format
            
        Returns:
            List of SQL LIKE patterns with % wildcards
        """
        patterns = NameNormalizer.generate_search_patterns(id_str)
        
        # Add wildcards for SQL LIKE
        sql_patterns = []
        for pattern in patterns:
            # Exact match in JSON array
            sql_patterns.append(f'%"{pattern}"%')
            # Loose match
            sql_patterns.append(f'%{pattern}%')
        
        # Deduplicate while preserving order
        seen = set()
        unique_patterns = []
        for p in sql_patterns:
            if p not in seen:
                seen.add(p)
                unique_patterns.append(p)
        
        return unique_patterns


# Convenience functions
def normalize_specialization_for_query(spec_id: str) -> List[str]:
    """
    Get all SQL LIKE patterns for a specialization ID
    
    Args:
        spec_id: Specialization ID (e.g., 'food_beverage')
        
    Returns:
        List of SQL LIKE patterns
    """
    return NameNormalizer.build_sql_like_patterns(spec_id)


def normalize_industry_for_query(industry_id: str) -> List[str]:
    """
    Get all SQL LIKE patterns for an industry ID
    
    Args:
        industry_id: Industry ID (e.g., 'consumer')
        
    Returns:
        List of SQL LIKE patterns
    """
    return NameNormalizer.build_sql_like_patterns(industry_id)
