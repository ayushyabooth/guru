"""
CSV-based content ingestion service for parsing expert-links.md files in CSV format
"""
import csv
import os
import re
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import logging
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _build_config_lookup() -> Tuple[Dict[str, str], Dict[str, Tuple[str, str]]]:
    """
    Build lookup dictionaries from the industries config.

    Returns:
        Tuple of (industry_name_to_id, specialization_name_to_id_and_industry)
    """
    try:
        from app.services.industries_config import IndustriesConfig
        config = IndustriesConfig.get_instance()

        # Build industry name -> id mapping with multiple key variants for matching
        industry_name_to_id = {}
        for ind in config._config.get("industries", []):
            ind_id = ind.get("id", "")
            ind_name = ind.get("name", "")
            # Map multiple variants for better matching
            industry_name_to_id[ind_name.upper()] = ind_id
            industry_name_to_id[ind_id.upper()] = ind_id
            industry_name_to_id[ind_name.lower()] = ind_id
            industry_name_to_id[ind_id.lower()] = ind_id
            # Also add normalized version (no punctuation)
            normalized = re.sub(r'[&/(),]', ' ', ind_name.lower())
            normalized = ' '.join(normalized.split())
            industry_name_to_id[normalized] = ind_id

        # Build specialization name -> (spec_id, industry_id) mapping with multiple variants
        specialization_lookup = {}
        for ind in config._config.get("industries", []):
            ind_id = ind.get("id", "")
            for spec in ind.get("specializations", []):
                spec_id = spec.get("id", "")
                spec_name = spec.get("name", "")
                # Store multiple variants
                specialization_lookup[spec_name] = (spec_id, ind_id)
                specialization_lookup[spec_id] = (spec_id, ind_id)
                specialization_lookup[spec_name.lower()] = (spec_id, ind_id)
                # Also add normalized version
                normalized = re.sub(r'[&/(),]', ' ', spec_name.lower())
                normalized = ' '.join(normalized.split())
                specialization_lookup[normalized] = (spec_id, ind_id)

        logger.debug(f"Built config lookup: {len(industry_name_to_id)} industries, {len(specialization_lookup)} specializations")
        return industry_name_to_id, specialization_lookup

    except Exception as e:
        logger.warning(f"Could not load industries config, using empty lookup: {e}")
        return {}, {}


def _normalize_for_matching(text: str) -> str:
    """
    Normalize a text string for fuzzy matching.
    Strips punctuation, normalizes whitespace, and lowercases.
    """
    if not text:
        return ""
    # Remove common punctuation and normalize
    import re
    # Replace &, /, (, ) with spaces
    normalized = re.sub(r'[&/(),]', ' ', text)
    # Remove extra whitespace and lowercase
    normalized = ' '.join(normalized.lower().split())
    return normalized


def _expand_abbreviations(words: set) -> set:
    """
    Expand abbreviations and synonyms to improve matching.
    Returns an expanded set of words including original terms.
    """
    # Common abbreviations and synonyms in industry/specialization naming
    expansions = {
        'saas': {'saas', 'software', 'service'},
        'iot': {'iot', 'internet', 'things', 'hardware', 'connected'},
        'ai': {'ai', 'artificial', 'intelligence', 'ml', 'machine', 'learning'},
        'b2b': {'b2b', 'business', 'enterprise'},
        'b2c': {'b2c', 'consumer'},
        'it': {'it', 'information', 'technology', 'tech'},
        'cpg': {'cpg', 'consumer', 'packaged', 'goods'},
        'qsr': {'qsr', 'quick', 'service', 'restaurant', 'fast', 'food'},
        'hpc': {'hpc', 'health', 'personal', 'care', 'beauty'},
        'pe': {'pe', 'private', 'equity'},
        'vc': {'vc', 'venture', 'capital'},
        'am': {'am', 'asset', 'management'},
        'wm': {'wm', 'wealth', 'management'},
    }

    expanded = set(words)
    for word in words:
        if word in expansions:
            expanded.update(expansions[word])
    return expanded


def _fuzzy_match_specialization(section: str, specialization_lookup: Dict) -> Tuple[Optional[str], Optional[str]]:
    """
    Fuzzy match a section name to a specialization from config.
    Uses multiple strategies: exact match, word overlap, and semantic similarity.

    Args:
        section: The section name from the markdown file
        specialization_lookup: Dict mapping spec names to (spec_id, industry_id)

    Returns:
        Tuple of (specialization_id, industry_id) or (None, None) if no match
    """
    if not section:
        return None, None

    normalized_section = _normalize_for_matching(section)
    section_words = set(normalized_section.split())
    expanded_section_words = _expand_abbreviations(section_words)

    best_match = None
    best_score = 0

    # Key domain terms that carry high weight
    key_terms = {'saas', 'software', 'enterprise', 'consumer', 'internet', 'semiconductor',
                'hardware', 'iot', 'cloud', 'fintech', 'media', 'telecom', 'banking',
                'capital', 'markets', 'asset', 'wealth', 'insurance', 'private', 'specialty',
                'food', 'beverage', 'health', 'beauty', 'apparel', 'footwear', 'home',
                'furniture', 'retail', 'restaurant', 'social', 'infrastructure', 'services',
                'components', 'entertainment', 'technology', 'tech'}

    for spec_name, (spec_id, industry_id) in specialization_lookup.items():
        normalized_spec = _normalize_for_matching(spec_name)
        spec_words = set(normalized_spec.split())
        expanded_spec_words = _expand_abbreviations(spec_words)

        # Strategy 1: Check if spec_id is contained in section (handles "Enterprise Software" -> "enterprise_saas_software")
        section_slug = normalized_section.replace(' ', '_')
        spec_id_normalized = spec_id.lower().replace('_', ' ')
        if spec_id in section_slug or section_slug in spec_id:
            score = 0.9
            if score > best_score:
                best_score = score
                best_match = (spec_id, industry_id)
            continue

        # Strategy 2: Direct word overlap
        common_words = section_words & spec_words

        # Strategy 3: Expanded word overlap (with abbreviation expansion)
        expanded_common = expanded_section_words & expanded_spec_words

        # Use the better of the two
        effective_common = common_words | (expanded_common - {'and', 'the', 'of', 'in', 'for'})

        if effective_common:
            # Base score: percentage of matching words
            total_unique = len(section_words | spec_words)
            score = len(effective_common) / total_unique if total_unique > 0 else 0

            # Boost for key term matches
            key_matches = effective_common & key_terms
            if key_matches:
                score += len(key_matches) * 0.25

            # Extra boost if multiple key terms match
            if len(key_matches) >= 2:
                score += 0.2

            # Substring matching bonus - if one contains the other
            if normalized_section in normalized_spec or normalized_spec in normalized_section:
                score += 0.3

            if score > best_score:
                best_score = score
                best_match = (spec_id, industry_id)

    # Lower threshold to 0.25 to be more permissive
    if best_score >= 0.25:
        logger.debug(f"Fuzzy matched '{section}' -> {best_match} with score {best_score:.2f}")
        return best_match

    logger.warning(f"No fuzzy match found for section '{section}' (best score: {best_score:.2f})")
    return None, None


def parse_expert_links_csv(filepath: str) -> List[Dict]:
    """
    Parse expert-links.md file in CSV format and extract article information.

    Uses the industries-specializations.json config for mapping sections to
    industries and specializations.

    Args:
        filepath: Path to the expert-links.md file

    Returns:
        List of dictionaries with article information:
        [{ url, title, notes, priority, date_added, category, domain, type, industry, specializations }, ...]
    """
    if not os.path.exists(filepath):
        logger.warning(f"Expert links file not found: {filepath}")
        return []

    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            content = file.read()
    except Exception as e:
        logger.error(f"Error reading file {filepath}: {e}")
        return []

    # Build config-driven lookup tables
    industry_lookup, specialization_lookup = _build_config_lookup()

    articles = []
    lines = content.strip().split('\n')

    # Find data lines - they start with a number followed by comma and quoted string
    # Format: 1,"Title Here","https://url.com","Domain","Type","Importance"
    data_line_pattern = re.compile(r'^\d+,".+?",.+')

    # Detect format from the file
    # Look for format specification like "**Format:** S.No, Title, URL, Domain, Type, Importance"
    headers = ['S.No', 'Title', 'URL', 'Domain', 'Type', 'Importance']  # Default
    current_section = None  # Track markdown sections like ### Food & Beverage

    for line in lines:
        if '**Format:**' in line:
            # Extract headers from format line
            format_part = line.split('**Format:**')[-1].strip()
            headers = [h.strip() for h in format_part.split(',')]
            logger.info(f"Detected CSV headers: {headers}")
            break

    # Create header line for csv.DictReader
    header_line = ','.join(headers)
    data_lines = [header_line]

    # Find all data lines and track their sections
    section_for_line = {}
    line_idx = 0

    for line in lines:
        stripped = line.strip()

        # Track markdown section headers (### Section Name)
        if stripped.startswith('### '):
            current_section = stripped[4:].strip()
            continue

        # Check if line matches data pattern (number, "title", url, ...)
        if data_line_pattern.match(stripped):
            data_lines.append(stripped)
            section_for_line[line_idx] = current_section
            line_idx += 1

    if len(data_lines) <= 1:  # Only header, no data
        logger.warning(f"No data rows found in {filepath}")
        return []

    logger.info(f"Found {len(data_lines) - 1} data rows in expert links file")
    csv_reader = csv.DictReader(data_lines)

    # Track parent sections (## CONSUMER, ## TECHNOLOGY, ## FINANCE, etc.)
    current_parent = None
    parent_for_section = {}

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('## ') and not stripped.startswith('### '):
            current_parent = stripped[3:].strip()
        elif stripped.startswith('### '):
            section_name = stripped[4:].strip()
            parent_for_section[section_name] = current_parent

    # Get default industry/specialization from config (first ones)
    default_industry = None
    default_specialization = None
    if industry_lookup:
        # Get first industry as default
        try:
            from app.services.industries_config import IndustriesConfig
            config = IndustriesConfig.get_instance()
            industries = config._config.get("industries", [])
            if industries:
                default_industry = industries[0].get("id")
                specs = industries[0].get("specializations", [])
                if specs:
                    default_specialization = specs[0].get("id")
        except:
            pass

    for row_num, row in enumerate(csv_reader):
        try:
            # Extract fields from CSV row
            s_no = row.get('S.No', '').strip()
            title = row.get('Title', '').strip().strip('"')
            url = row.get('URL', '').strip().strip('"')
            domain = row.get('Domain', '').strip().strip('"')
            article_type = row.get('Type', '').strip().strip('"')
            importance = row.get('Importance', '').strip().strip('"')

            # Skip empty or invalid rows
            if not url or not url.startswith('http'):
                continue

            # Get section and parent for this row
            section = section_for_line.get(row_num)
            parent = parent_for_section.get(section)

            # Determine industry from parent section OR domain column using config
            industry = default_industry
            industry_source = parent if parent else domain

            if industry_source:
                source_upper = industry_source.upper()
                source_normalized = _normalize_for_matching(industry_source)

                if source_upper in industry_lookup:
                    industry = industry_lookup[source_upper]
                elif source_normalized in industry_lookup:
                    industry = industry_lookup[source_normalized]
                else:
                    # Try to find a matching industry name with fuzzy matching
                    best_match = None
                    best_score = 0
                    source_words = set(source_normalized.split())

                    for ind_name, ind_id in industry_lookup.items():
                        ind_normalized = _normalize_for_matching(ind_name)
                        ind_words = set(ind_normalized.split())

                        # Check for word overlap
                        common = source_words & ind_words
                        if common:
                            score = len(common) / max(len(source_words), len(ind_words))
                            if score > best_score:
                                best_score = score
                                best_match = ind_id

                        # Check for substring match
                        if source_normalized in ind_normalized or ind_normalized in source_normalized:
                            best_match = ind_id
                            break

                    if best_match:
                        industry = best_match

            # Determine specialization from section OR domain using config
            specialization_id = default_specialization

            # Try section first (from ### headers), then fall back to domain column
            section_or_domain = section if section else domain

            if section_or_domain:
                # First try exact match
                if section_or_domain in specialization_lookup:
                    specialization_id, matched_industry = specialization_lookup[section_or_domain]
                    if matched_industry:
                        industry = matched_industry
                else:
                    # Try fuzzy matching with section/domain
                    matched_spec, matched_industry = _fuzzy_match_specialization(section_or_domain, specialization_lookup)
                    if matched_spec:
                        specialization_id = matched_spec
                        if matched_industry:
                            industry = matched_industry
                    elif domain and domain != section_or_domain:
                        # If section matching failed, also try the domain column directly
                        matched_spec, matched_industry = _fuzzy_match_specialization(domain, specialization_lookup)
                        if matched_spec:
                            specialization_id = matched_spec
                            if matched_industry:
                                industry = matched_industry

            # If still no match, try to infer specialization from industry
            # by picking the first specialization of the matched industry
            if not specialization_id or specialization_id == default_specialization:
                try:
                    from app.services.industries_config import IndustriesConfig
                    config = IndustriesConfig.get_instance()
                    if industry:
                        ind_data = config.get_industry(industry)
                        if ind_data:
                            specs = ind_data.get("specializations", [])
                            if specs:
                                # Use first specialization of this industry
                                specialization_id = specs[0].get("id")
                except Exception as e:
                    logger.debug(f"Could not infer specialization from industry: {e}")

            specializations = [specialization_id] if specialization_id else []

            # Create notes from type and importance
            notes = f"{article_type} article from {domain}. Priority: {importance}"

            article_info = {
                'url': url,
                'title': title,
                'notes': notes,
                'priority': importance,
                'date_added': datetime.now().date(),
                'category': industry,
                'domain': domain,
                'type': article_type,
                'industry': industry,
                'specializations': specializations
            }

            articles.append(article_info)
            logger.debug(f"Parsed article: {title} -> industry={industry}, spec={specializations}")

        except Exception as e:
            logger.error(f"Error parsing row {row_num}: {e}")
            continue

    logger.info(f"Parsed {len(articles)} articles from {filepath}")
    return articles


def validate_csv_format(filepath: str) -> Dict[str, any]:
    """
    Validate the format of expert-links.md CSV file

    Args:
        filepath: Path to the expert-links.md file

    Returns:
        Dictionary with validation results
    """
    validation_result = {
        'errors': [],
        'warnings': [],
        'valid_entries': 0,
        'invalid_entries': 0
    }

    if not os.path.exists(filepath):
        validation_result['errors'].append(f"File not found: {filepath}")
        return validation_result

    try:
        articles = parse_expert_links_csv(filepath)
        validation_result['valid_entries'] = len(articles)

        # Check for required fields
        for article in articles:
            if not article.get('url') or not article.get('title'):
                validation_result['invalid_entries'] += 1
                validation_result['warnings'].append(f"Missing required fields in article: {article.get('title', 'Unknown')}")

    except Exception as e:
        validation_result['errors'].append(f"Error validating file: {e}")

    return validation_result
