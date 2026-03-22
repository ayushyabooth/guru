"""
Filter-driven semantic clustering service for dynamic storyboard generation
"""
import uuid
import numpy as np
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc
import logging
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.cluster import AgglomerativeClustering
try:
    from fastembed import TextEmbedding
    _USE_FASTEMBED = True
except ImportError:
    from sentence_transformers import SentenceTransformer
    _USE_FASTEMBED = False
import json

from app.db.database import SessionLocal
from app.models.article import Article, ExpertNote
from app.models.user import User, UserProfile
from app.models.storyboard import Storyboard, StoryboardArticle, UserStoryboardPrompt
from app.models.cache import StoryboardCache
from app.models.interaction import UserNotRelevant
from app.utils.name_normalization import NameNormalizer
from app.utils.llm_utils import get_claude_client
from app.services.personal_prompt_service import PersonalPromptService
from app.services.industries_config import IndustriesConfig
from app.services.cluster_narrative_service import ClusterNarrativeService
from app.config import settings

logger = logging.getLogger(__name__)

# Global embedding model (lazy loaded)
_embedding_model = None


def get_embedding_model():
    """Get global embedding model (singleton pattern).
    Uses fastembed (ONNX, lightweight) if available, falls back to sentence-transformers (PyTorch).
    """
    global _embedding_model
    if _embedding_model is None:
        if _USE_FASTEMBED:
            _embedding_model = TextEmbedding('sentence-transformers/all-MiniLM-L6-v2')
            logger.info("Loaded fastembed model (ONNX backend)")
        else:
            _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            logger.info("Loaded SentenceTransformer model (PyTorch backend)")
    return _embedding_model


def encode_texts(model, texts: list) -> list:
    """Encode texts using whichever backend is available."""
    if _USE_FASTEMBED:
        # fastembed returns a generator of numpy arrays
        return list(model.embed(texts))
    else:
        return model.encode(texts)


def parse_filter_context(filter_str: str) -> Dict[str, Any]:
    """
    Parse filter context string into structured format
    
    Args:
        filter_str: Filter string like "core", "industry:Consumer", "specialization:Food & Beverage"
    
    Returns:
        Dictionary with filter type and value
    """
    if not filter_str or filter_str == "core":
        return {"type": "core"}
    
    if ":" in filter_str:
        filter_type, filter_value = filter_str.split(":", 1)
        return {
            "type": filter_type.strip(),
            "value": filter_value.strip()
        }
    
    # Default to core if format is unclear
    return {"type": "core"}


def resolve_base_cache_key(user: User, filter_context: str, db: Session) -> str:
    """Convert user-relative filter to a canonical key for base storyboard caching.

    Non-core filters (industry:X, specialization:X, interest:X) are already canonical.
    'core' filter depends on user's industry + specializations, so we resolve it to
    a deterministic key like 'core:consumer:food_beverage,general_merchandise'.
    Users with the same resolved key share the same base storyboards.
    """
    if filter_context != "core":
        return filter_context

    profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
    if not profile:
        return "core:unknown"

    config = IndustriesConfig.get_instance()
    industry = config.normalize_id(profile.core_industry, 'industry') or profile.core_industry or "unknown"

    specs = []
    if profile.specializations:
        raw_specs = json.loads(profile.specializations) if isinstance(profile.specializations, str) else profile.specializations
        for spec in raw_specs:
            spec_id = config.normalize_id(spec, 'specialization') or spec
            specs.append(spec_id)

    specs_str = ",".join(sorted(specs)) if specs else "general"
    return f"core:{industry}:{specs_str}"


def get_articles_for_filter(
    user: User, 
    filter_context: str, 
    time_window_days: int = None,
    db: Session = None
) -> List[Article]:
    """
    Get articles filtered by context type for a specific user
    
    Args:
        user: User object
        filter_context: Filter context string
        time_window_days: Number of days to look back for articles
        db: Database session
    
    Returns:
        List of filtered articles
    """
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Parse filter context
        filter_data = parse_filter_context(filter_context)
        filter_type = filter_data["type"]
        filter_value = filter_data.get("value")
        
        # Get user profile for filtering
        user_profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
        if not user_profile:
            logger.warning(f"No user profile found for user {user.id}")
            return []
        
        # Calculate time window (use config default if not specified)
        days = time_window_days if time_window_days is not None else settings.ARTICLE_TIME_WINDOW_DAYS
        cutoff_date = datetime.now() - timedelta(days=days)
        
        # Base query for articles within time window
        base_query = db.query(Article).filter(
            Article.created_at >= cutoff_date
        )
        
        # Get config instance for name normalization (used across all filter branches)
        from app.services.industries_config import IndustriesConfig
        config = IndustriesConfig.get_instance()

        # Apply filter based on type
        if filter_type == "core":
            # Core filter: user's core industry + specializations
            # Use normalized patterns for flexible matching
            #
            # IMPORTANT: User profile stores DISPLAY names (e.g., "Enterprise SaaS & Software")
            # but expert_notes stores IDs (e.g., "enterprise_saas_software").
            # We need to convert display names to IDs before building patterns.

            specialization_conditions = []
            for spec in user_profile.specializations:
                # Convert display name to ID first
                spec_id = config.normalize_id(spec, 'specialization')
                # Use ID if found, otherwise fall back to original (which might be an ID already)
                spec_to_use = spec_id if spec_id else spec

                # Get all possible patterns for this specialization
                patterns = NameNormalizer.build_sql_like_patterns(spec_to_use)
                for pattern in patterns:
                    specialization_conditions.append(
                        ExpertNote.expert_specializations.like(pattern)
                    )

                # Also add patterns for the original spec name in case data uses display names
                if spec_id and spec_id != spec:
                    patterns = NameNormalizer.build_sql_like_patterns(spec)
                    for pattern in patterns:
                        specialization_conditions.append(
                            ExpertNote.expert_specializations.like(pattern)
                        )

            # Get patterns for industry - convert display name to ID first
            industry_id = config.normalize_id(user_profile.core_industry, 'industry')
            industry_to_use = industry_id if industry_id else user_profile.core_industry

            industry_patterns = NameNormalizer.build_sql_like_patterns(industry_to_use)
            industry_conditions = [
                ExpertNote.expert_industry.like(pattern) for pattern in industry_patterns
            ]

            # Also add patterns for the original industry name
            if industry_id and industry_id != user_profile.core_industry:
                extra_patterns = NameNormalizer.build_sql_like_patterns(user_profile.core_industry)
                for pattern in extra_patterns:
                    industry_conditions.append(ExpertNote.expert_industry.like(pattern))
            
            # Also match on industry alone if no specializations match
            articles = base_query.join(ExpertNote).filter(
                or_(
                    or_(*industry_conditions) if industry_conditions else False,
                    or_(*specialization_conditions) if specialization_conditions else False
                )
            ).all()
            
        elif filter_type == "industry":
            # Industry filter: specific industry
            # Convert display name to ID if needed
            industry_id = config.normalize_id(filter_value, 'industry')
            industry_to_use = industry_id if industry_id else filter_value

            # Build patterns for flexible matching
            industry_patterns = NameNormalizer.build_sql_like_patterns(industry_to_use)
            industry_conditions = [
                ExpertNote.expert_industry.like(pattern) for pattern in industry_patterns
            ]

            # Also add patterns for original value
            if industry_id and industry_id != filter_value:
                extra_patterns = NameNormalizer.build_sql_like_patterns(filter_value)
                for pattern in extra_patterns:
                    industry_conditions.append(ExpertNote.expert_industry.like(pattern))

            articles = base_query.join(ExpertNote).filter(
                or_(*industry_conditions)
            ).all()
            
        elif filter_type == "specialization":
            # Specialization filter: specific specialization
            # Convert display name to ID first (same fix as for "core" filter)
            spec_id = config.normalize_id(filter_value, 'specialization')
            spec_to_use = spec_id if spec_id else filter_value
            logger.info(f"Specialization filter: value='{filter_value}' -> spec_id='{spec_id}' -> using='{spec_to_use}'")

            # Build patterns for both ID and display name
            patterns = NameNormalizer.build_sql_like_patterns(spec_to_use)
            logger.info(f"Generated {len(patterns)} patterns for '{spec_to_use}'")
            specialization_conditions = [
                ExpertNote.expert_specializations.like(pattern) for pattern in patterns
            ]

            # Also add patterns for the original filter value if different
            if spec_id and spec_id != filter_value:
                extra_patterns = NameNormalizer.build_sql_like_patterns(filter_value)
                logger.info(f"Adding {len(extra_patterns)} extra patterns for original '{filter_value}'")
                for pattern in extra_patterns:
                    specialization_conditions.append(
                        ExpertNote.expert_specializations.like(pattern)
                    )

            articles = base_query.join(ExpertNote).filter(
                or_(*specialization_conditions)
            ).all()

            # Fallback: if no articles match this specialization, try parent industry
            if not articles and user_profile:
                industry_id = config.normalize_id(user_profile.core_industry, 'industry')
                industry_to_use = industry_id if industry_id else user_profile.core_industry
                industry_patterns = NameNormalizer.build_sql_like_patterns(industry_to_use)
                industry_conds = [ExpertNote.expert_industry.like(p) for p in industry_patterns]
                if industry_id and industry_id != user_profile.core_industry:
                    for p in NameNormalizer.build_sql_like_patterns(user_profile.core_industry):
                        industry_conds.append(ExpertNote.expert_industry.like(p))
                articles = base_query.join(ExpertNote).filter(
                    or_(*industry_conds)
                ).all()
                logger.info(
                    f"Specialization '{filter_value}' returned 0 articles, "
                    f"fell back to industry '{user_profile.core_industry}': {len(articles)} articles"
                )

        elif filter_type == "interest":
            # Interest filter: additional interests - use LIKE patterns for robust matching
            if user_profile.additional_interest_industries and filter_value:
                # Check membership with case-insensitive comparison
                interest_match = any(
                    i.lower() == filter_value.lower()
                    for i in user_profile.additional_interest_industries
                )
                if interest_match:
                    # Try to resolve to canonical ID for best pattern matching
                    config = IndustriesConfig.get_instance()
                    industry_id = config.normalize_id(filter_value, 'industry')
                    industry_to_use = industry_id if industry_id else filter_value

                    industry_patterns = NameNormalizer.build_sql_like_patterns(industry_to_use)
                    industry_conditions = [
                        ExpertNote.expert_industry.like(p) for p in industry_patterns
                    ]
                    # Also add patterns for the original filter value if different
                    if industry_id and industry_id != filter_value:
                        extra_patterns = NameNormalizer.build_sql_like_patterns(filter_value)
                        industry_conditions.extend([
                            ExpertNote.expert_industry.like(p) for p in extra_patterns
                        ])

                    logger.info(f"Interest filter: value='{filter_value}' -> id='{industry_id}' -> {len(industry_conditions)} conditions")
                    articles = base_query.join(ExpertNote).filter(
                        or_(*industry_conditions)
                    ).all()
                else:
                    articles = []
            else:
                articles = []
        else:
            logger.warning(f"Unknown filter type: {filter_type}")
            articles = []
        
        # Remove duplicates by article ID
        unique_articles = {}
        for article in articles:
            unique_articles[article.id] = article
        
        result = list(unique_articles.values())
        logger.info(f"Found {len(result)} articles for filter '{filter_context}' and user {user.id}")
        return result
        
    finally:
        if close_db:
            db.close()


def compute_article_embeddings(articles: List[Article]) -> Dict[uuid.UUID, np.ndarray]:
    """
    Compute embeddings for a list of articles
    
    Args:
        articles: List of Article objects
    
    Returns:
        Dictionary mapping article UUID to embedding vector
    """
    if not articles:
        return {}
    
    try:
        model = get_embedding_model()
        embeddings = {}
        
        for article in articles:
            # Create text for embedding (title + summary or raw_text snippet)
            text_parts = []
            
            if article.title:
                text_parts.append(article.title)
            
            if article.raw_text and not article.is_paywalled:
                # Use first 500 characters of raw text
                text_parts.append(article.raw_text[:500])
            
            # Combine text parts
            text = " ".join(text_parts)
            
            if text.strip():
                # Compute embedding
                result = encode_texts(model, [text])
                embedding = np.array(result[0])
                embeddings[article.id] = embedding
                logger.debug(f"Computed embedding for article {article.id}")
            else:
                logger.warning(f"No text available for embedding article {article.id}")
        
        logger.info(f"Computed embeddings for {len(embeddings)} articles")
        return embeddings
        
    except Exception as e:
        logger.error(f"Error computing embeddings: {e}")
        return {}


def cluster_articles_for_context(
    user: User, 
    filter_context: str, 
    time_window_days: int = None,
    similarity_threshold: float = 0.8,
    db: Session = None
) -> List[Storyboard]:
    """
    Cluster articles for a specific filter context and create storyboards
    
    Args:
        user: User object
        filter_context: Filter context string
        time_window_days: Number of days to look back
        similarity_threshold: Minimum similarity for clustering
        db: Database session
    
    Returns:
        List of created Storyboard objects
    """
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Get filtered articles
        articles = get_articles_for_filter(user, filter_context, time_window_days, db)
        
        if len(articles) < 2:
            logger.info(f"Not enough articles ({len(articles)}) for clustering in context '{filter_context}'")
            return []
        
        # Compute embeddings
        embeddings = compute_article_embeddings(articles)
        
        if len(embeddings) < 2:
            logger.info(f"Not enough embeddings ({len(embeddings)}) for clustering")
            return []
        
        # Prepare data for clustering
        article_ids = list(embeddings.keys())
        embedding_matrix = np.array([embeddings[aid] for aid in article_ids])
        
        # Compute similarity matrix
        similarity_matrix = cosine_similarity(embedding_matrix)
        
        # Convert similarity to distance (1 - similarity)
        distance_matrix = 1 - similarity_matrix
        
        # Perform hierarchical clustering
        # Create more clusters for better storyboard diversity
        if len(articles) <= 3:
            n_clusters = 1  # Force single cluster for very small datasets
        elif len(articles) <= 10:
            n_clusters = min(3, len(articles) // 2)  # 2-5 clusters for small sets
        else:
            # For larger datasets, create more clusters (up to 8)
            n_clusters = min(8, max(3, len(articles) // 5))
        
        clustering = AgglomerativeClustering(
            n_clusters=n_clusters,
            metric='precomputed',
            linkage='average'
        )
        
        cluster_labels = clustering.fit_predict(distance_matrix)
        
        # Group articles by cluster
        clusters = {}
        for i, article_id in enumerate(article_ids):
            cluster_id = cluster_labels[i]
            if cluster_id not in clusters:
                clusters[cluster_id] = []
            clusters[cluster_id].append(article_id)
        
        # Create storyboards for each cluster
        # Phase 1: Generate LLM content in parallel (summary, theme, narrative)
        # Phase 2: Write to DB sequentially (SQLite single-writer constraint)
        from concurrent.futures import ThreadPoolExecutor, as_completed

        failed_summary_indicators = [
            "I'm unable to generate",
            "unable to generate a meaningful summary",
            "JavaScript error",
            "no substantive information",
            "cannot generate",
            "insufficient content"
        ]

        def _generate_cluster_content(cluster_id, cluster_article_ids):
            """Generate LLM content for one cluster (runs in thread pool)."""
            try:
                cluster_articles = [
                    next(a for a in articles if a.id == aid)
                    for aid in cluster_article_ids
                ]
                headline_article = _select_headline_article(cluster_articles, db)
                summary = _generate_cluster_summary(cluster_articles)
                theme = _generate_cluster_theme(cluster_articles)

                # Check for failed summaries
                if any(ind.lower() in summary.lower() for ind in failed_summary_indicators):
                    logger.warning(f"Skipping storyboard with failed summary: {summary[:100]}")
                    return None

                cluster_narrative = _generate_cluster_narrative(cluster_articles, theme)

                return {
                    'cluster_id': cluster_id,
                    'cluster_articles': cluster_articles,
                    'headline_article': headline_article,
                    'summary': summary,
                    'theme': theme,
                    'cluster_narrative': cluster_narrative,
                }
            except Exception as e:
                logger.error(f"Error generating content for cluster {cluster_id}: {e}")
                return None

        # Run LLM generation in parallel (4 workers — bottleneck is API latency, not CPU)
        cluster_results = []
        valid_clusters = [(cid, aids) for cid, aids in clusters.items() if len(aids) >= 1]

        if len(valid_clusters) <= 1:
            # Single cluster — no need for thread pool overhead
            for cid, aids in valid_clusters:
                result = _generate_cluster_content(cid, aids)
                if result:
                    cluster_results.append(result)
        else:
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = {
                    executor.submit(_generate_cluster_content, cid, aids): cid
                    for cid, aids in valid_clusters
                }
                for future in as_completed(futures):
                    try:
                        result = future.result()
                        if result:
                            cluster_results.append(result)
                    except Exception as e:
                        cid = futures[future]
                        logger.error(f"Thread error for cluster {cid}: {e}")

        # Phase 2: Write results to DB sequentially
        storyboards = []
        base_key = resolve_base_cache_key(user, filter_context, db)
        all_cluster_article_ids = [aid for ids in clusters.values() for aid in ids]

        for result in cluster_results:
            cluster_articles = result['cluster_articles']
            headline_article = result['headline_article']

            ranking_score = _compute_storyboard_ranking_score(
                cluster_articles, headline_article, db
            )

            storyboard = Storyboard(
                id=uuid.uuid4(),
                industry=_extract_cluster_industry(cluster_articles, db),
                specializations=_extract_cluster_specializations(cluster_articles, db),
                filter_context=filter_context,
                headline_article_id=headline_article.id,
                summary=result['summary'],
                personal_prompt=None,
                cluster_narrative=result['cluster_narrative'],
                ranking_score=ranking_score,
                base_cache_key=base_key,
            )

            db.add(storyboard)
            db.commit()
            db.refresh(storyboard)

            _create_storyboard_articles(
                storyboard, cluster_articles, embeddings, headline_article, db
            )

            _fill_related_articles(
                storyboard, all_cluster_article_ids, filter_context, db
            )

            storyboards.append(storyboard)
            logger.info(f"Created storyboard {storyboard.id} with {len(cluster_articles)} articles (ranking_score={ranking_score:.3f})")

        logger.info(f"Created {len(storyboards)} storyboards for context '{filter_context}'")
        return storyboards
        
    except Exception as e:
        logger.error(f"Error clustering articles for context '{filter_context}': {e}")
        if db:
            db.rollback()
        return []
        
    finally:
        if close_db:
            db.close()


def _get_source_tier_score(article: Article) -> float:
    """Get source tier score for ranking. Luminary (Tier 2) > Expert (Tier 1) > Discovery (Tier 3)."""
    tier_scores = {
        'tier2_luminary': 0.9,
        'tier1_expert': 0.7,
        'tier3_discovery': 0.5,
    }
    return tier_scores.get(article.ingestion_tier, 0.5)


def _get_priority_score(article: Article, db: Session) -> float:
    """Get priority score from expert notes. Essential=1.0, High=0.7, Normal=0.3."""
    expert_notes = db.query(ExpertNote).filter(ExpertNote.article_id == article.id).all()
    best = 0.3
    for note in expert_notes:
        if note.priority == "Essential":
            return 1.0
        elif note.priority == "High":
            best = max(best, 0.7)
    return best


def _get_freshness_score(article: Article) -> float:
    """Get freshness score. Linear decay over ARTICLE_TIME_WINDOW_DAYS, 0-1."""
    if not article.created_at:
        return 0.0
    days_old = (datetime.now() - article.created_at.replace(tzinfo=None)).days
    return max(0.0, 1.0 - (days_old / settings.ARTICLE_TIME_WINDOW_DAYS))


def _select_headline_article(articles: List[Article], db: Session) -> Article:
    """Select the best headline article using composite score.

    Score = 0.40 * quality + 0.30 * priority + 0.20 * freshness + 0.10 * tier
    """
    def headline_score(article):
        quality = article.quality_score or 0.0
        priority = _get_priority_score(article, db)
        freshness = _get_freshness_score(article)
        tier = _get_source_tier_score(article)
        return 0.40 * quality + 0.30 * priority + 0.20 * freshness + 0.10 * tier

    articles_sorted = sorted(articles, key=headline_score, reverse=True)
    return articles_sorted[0]


def _generate_cluster_summary(articles: List[Article]) -> str:
    """Generate a summary for a cluster of articles"""
    try:
        claude_client = get_claude_client()
        
        # Collect article titles and summaries
        article_info = []
        for article in articles:
            info = f"Title: {article.title or 'Untitled'}"
            if article.raw_text and not article.is_paywalled:
                info += f"\nSnippet: {article.raw_text[:200]}..."
            article_info.append(info)
        
        context = "\n\n".join(article_info)
        
        prompt = f"""Based on these related articles, generate a concise 2-sentence summary that captures the common theme and key insights:

{context}

Summary (2 sentences):"""
        
        response = claude_client.client.messages.create(
            model=claude_client.model,
            max_tokens=150,
            temperature=0.3,
            messages=[{"role": "user", "content": prompt}]
        )
        
        return response.content[0].text.strip()
        
    except Exception as e:
        logger.error(f"Error generating cluster summary: {e}")
        return f"Collection of {len(articles)} related articles on industry trends and insights."


def _generate_cluster_theme(articles: List[Article]) -> str:
    """Generate a theme name for a cluster of articles"""
    try:
        claude_client = get_claude_client()
        
        # Collect article titles
        titles = [article.title for article in articles if article.title]
        titles_text = "\n".join(titles)
        
        prompt = f"""Based on these article titles, generate a short, catchy theme name (3-5 words) that captures the common topic:

{titles_text}

Theme name:"""
        
        response = claude_client.client.messages.create(
            model=claude_client.model,
            max_tokens=50,
            temperature=0.4,
            messages=[{"role": "user", "content": prompt}]
        )
        
        theme = response.content[0].text.strip()
        # Remove quotes if present
        theme = theme.strip('"\'')
        return theme
        
    except Exception as e:
        logger.error(f"Error generating cluster theme: {e}")
        return "Industry Insights"


def _extract_cluster_industry(articles: List[Article], db: Session) -> str:
    """Extract the most common industry from cluster articles"""
    industries = []
    for article in articles:
        expert_notes = db.query(ExpertNote).filter(ExpertNote.article_id == article.id).all()
        for note in expert_notes:
            if note.expert_industry:
                industries.append(note.expert_industry)
    
    if industries:
        # Return most common industry
        return max(set(industries), key=industries.count)
    
    return "General"


def _extract_cluster_specializations(articles: List[Article], db: Session) -> List[str]:
    """Extract common specializations from cluster articles"""
    all_specializations = []
    for article in articles:
        expert_notes = db.query(ExpertNote).filter(ExpertNote.article_id == article.id).all()
        for note in expert_notes:
            if note.expert_specializations:
                all_specializations.extend(note.expert_specializations)
    
    if all_specializations:
        # Return unique specializations
        return list(set(all_specializations))
    
    return []


def _generate_personal_prompt(
    user: User,
    filter_context: str,
    theme: str,
    summary: str,
    db: Session
) -> Optional[str]:
    """
    Generate a personal prompt for a storyboard based on user's specialization.
    
    Args:
        user: User object
        filter_context: Filter context string (e.g., "specialization:food_beverage")
        theme: Storyboard theme
        summary: Storyboard summary
        db: Database session
        
    Returns:
        Personal prompt string or None
    """
    try:
        # Get user profile
        user_profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
        if not user_profile:
            logger.warning(f"No user profile found for user {user.id}")
            return None
        
        # Determine user specialization from filter context or profile
        user_spec = None
        
        # Parse filter context to get specialization
        filter_data = parse_filter_context(filter_context)
        if filter_data["type"] == "specialization" and filter_data.get("value"):
            # Convert specialization name to ID using central config
            spec_name = filter_data["value"]
            config = IndustriesConfig.get_instance()
            user_spec = config.normalize_id(spec_name, 'specialization') or spec_name
        elif user_profile.specializations and len(user_profile.specializations) > 0:
            # Use first specialization from profile
            user_spec = user_profile.specializations[0]
        
        if not user_spec:
            logger.warning(f"Could not determine specialization for user {user.id}")
            return None
        
        # Generate prompt using PersonalPromptService
        prompt_service = PersonalPromptService()
        personal_prompt = prompt_service.generate_prompt(
            user_spec=user_spec,
            theme=theme,
            summary=summary
        )
        
        # Fallback if generation fails
        if not personal_prompt:
            personal_prompt = prompt_service.generate_fallback_prompt(user_spec)
            logger.info(f"Using fallback prompt for user {user.id}: {personal_prompt}")
        
        return personal_prompt
        
    except Exception as e:
        logger.error(f"Error generating personal prompt: {e}")
        return None


def _generate_cluster_narrative(articles: List[Article], theme: str) -> Optional[str]:
    """
    Generate cluster narrative for a storyboard.
    
    Args:
        articles: List of articles in the cluster
        theme: Storyboard theme for context generation
        
    Returns:
        Cluster narrative string or None
    """
    try:
        narrative_service = ClusterNarrativeService()
        cluster_narrative = narrative_service.generate_narrative(
            articles=articles,
            theme=theme,
            include_context=True
        )
        
        if cluster_narrative:
            logger.info(f"Generated cluster narrative for {len(articles)} articles")
        else:
            logger.info(f"No narrative generated (need at least 2 articles)")
        
        return cluster_narrative
        
    except Exception as e:
        logger.error(f"Error generating cluster narrative: {e}")
        return None


def _create_storyboard_articles(
    storyboard: Storyboard,
    articles: List[Article],
    embeddings: Dict[uuid.UUID, np.ndarray],
    headline_article: Article,
    db: Session
):
    """Create StoryboardArticle records with composite ranking.

    Score = 0.50 * centroid_similarity + 0.30 * quality_score + 0.20 * priority_score
    """
    # Calculate centroid of cluster
    cluster_embeddings = [embeddings[a.id] for a in articles if a.id in embeddings]
    if not cluster_embeddings:
        return

    centroid = np.mean(cluster_embeddings, axis=0)

    # Calculate composite score for ranking
    article_scores = []
    for article in articles:
        if article.id in embeddings:
            similarity = cosine_similarity([embeddings[article.id]], [centroid])[0][0]
            quality = article.quality_score or 0.0
            priority = _get_priority_score(article, db)
            score = 0.50 * similarity + 0.30 * quality + 0.20 * priority
            article_scores.append((article, score))

    # Sort by composite score (descending)
    article_scores.sort(key=lambda x: x[1], reverse=True)

    # Create StoryboardArticle records
    for rank, (article, score) in enumerate(article_scores):
        storyboard_article = StoryboardArticle(
            storyboard_id=storyboard.id,
            article_id=article.id,
            rank=rank + 1
        )
        db.add(storyboard_article)

    db.commit()


def _compute_storyboard_ranking_score(
    articles: List[Article],
    headline_article: Article,
    db: Session
) -> float:
    """Compute composite ranking score for a storyboard.

    Score = 0.35 * avg_quality + 0.25 * headline_quality + 0.20 * avg_tier
          + 0.10 * freshness + 0.10 * essential_ratio
    """
    if not articles:
        return 0.0

    # Average article quality
    quality_scores = [a.quality_score or 0.0 for a in articles]
    avg_quality = sum(quality_scores) / len(quality_scores)

    # Headline quality boost
    headline_quality = headline_article.quality_score or 0.0

    # Average source tier score
    tier_scores = [_get_source_tier_score(a) for a in articles]
    avg_tier = sum(tier_scores) / len(tier_scores)

    # Freshness (based on newest article)
    freshness_scores = [_get_freshness_score(a) for a in articles]
    freshness = max(freshness_scores) if freshness_scores else 0.0

    # Essential ratio
    essential_count = sum(1 for a in articles if _get_priority_score(a, db) >= 1.0)
    essential_ratio = essential_count / len(articles)

    return (
        0.35 * avg_quality
        + 0.25 * headline_quality
        + 0.20 * avg_tier
        + 0.10 * freshness
        + 0.10 * essential_ratio
    )


def _fill_related_articles(
    storyboard: Storyboard,
    existing_article_ids: List[uuid.UUID],
    filter_context: str,
    db: Session,
    max_total: int = 5
):
    """Fill storyboards with <3 related articles from same specialization.

    Queries additional articles from the same expert_specializations that
    haven't been assigned to any storyboard in this batch. Caps at max_total.
    """
    # Count current related articles (excluding headline)
    current_count = db.query(StoryboardArticle).filter(
        StoryboardArticle.storyboard_id == storyboard.id,
        StoryboardArticle.article_id != storyboard.headline_article_id
    ).count()

    if current_count >= 3:
        return  # Already has enough related articles

    needed = min(max_total, 5) - current_count
    if needed <= 0:
        return

    # Get specializations from storyboard
    specializations = storyboard.specializations or []
    if not specializations:
        return

    # Build query for fill candidates from same specialization
    spec_conditions = []
    for spec in specializations:
        patterns = NameNormalizer.build_sql_like_patterns(spec)
        for pattern in patterns:
            spec_conditions.append(ExpertNote.expert_specializations.like(pattern))

    if not spec_conditions:
        return

    # Get IDs already in this storyboard
    storyboard_article_ids = {
        row[0] for row in db.query(StoryboardArticle.article_id).filter(
            StoryboardArticle.storyboard_id == storyboard.id
        ).all()
    }

    # Combine with existing_article_ids to exclude all already-assigned articles
    exclude_ids = storyboard_article_ids | set(existing_article_ids)

    # Query candidates
    candidates = db.query(Article).join(ExpertNote).filter(
        or_(*spec_conditions),
        ~Article.id.in_(exclude_ids)
    ).order_by(
        desc(Article.quality_score),
        desc(Article.created_at)
    ).limit(needed).all()

    # Add fill articles to storyboard
    current_max_rank = db.query(StoryboardArticle.rank).filter(
        StoryboardArticle.storyboard_id == storyboard.id
    ).order_by(desc(StoryboardArticle.rank)).first()

    next_rank = (current_max_rank[0] + 1) if current_max_rank else 1

    for article in candidates:
        storyboard_article = StoryboardArticle(
            storyboard_id=storyboard.id,
            article_id=article.id,
            rank=next_rank
        )
        db.add(storyboard_article)
        next_rank += 1

    if candidates:
        db.commit()
        logger.info(f"Filled storyboard {storyboard.id} with {len(candidates)} additional articles")


def _get_or_build_base_storyboards(
    user: User,
    filter_context: str,
    db: Session,
) -> List[Storyboard]:
    """Get or build BASE storyboards for a filter (no personal prompts).

    Base storyboards are shared across all users with the same resolved filter.
    They contain summary, theme, narrative, and ranking — but NOT personal_prompt.
    Cached by base_cache_key (canonical filter key).

    Cache validity:
    - expires_at: hard expiration (default 24h from creation)
    - MAX_STORYBOARD_AGE_HOURS: if cache is older than this, rebuild even if not expired
    - Cache is also explicitly cleared by ingestion orchestrator when new articles arrive
    """
    MAX_STORYBOARD_AGE_HOURS = 48  # Force rebuild if storyboards are older than this

    base_key = resolve_base_cache_key(user, filter_context, db)
    today = date.today().strftime('%Y-%m-%d')

    # Check base cache (keyed by base_cache_key, no user_id)
    # Use a sentinel user_id for base cache entries
    BASE_SENTINEL = uuid.UUID('00000000-0000-0000-0000-000000000000')
    now = datetime.utcnow()  # Use UTC to match SQLite func.now()

    cache_entry = db.query(StoryboardCache).filter(
        and_(
            StoryboardCache.user_id == BASE_SENTINEL,
            StoryboardCache.filter_context == base_key,
            StoryboardCache.expires_at > now
        )
    ).first()

    if cache_entry:
        # Check staleness: if cache is older than MAX_STORYBOARD_AGE_HOURS, force rebuild
        created = cache_entry.created_at.replace(tzinfo=None) if cache_entry.created_at else now
        cache_age = now - created
        max_age = timedelta(hours=MAX_STORYBOARD_AGE_HOURS)

        if cache_age > max_age:
            logger.info(
                f"Base cache STALE for '{base_key}' "
                f"(age={cache_age.total_seconds()/3600:.1f}h > max={MAX_STORYBOARD_AGE_HOURS}h), rebuilding..."
            )
            db.delete(cache_entry)
            db.commit()
        else:
            storyboard_ids = [uuid.UUID(sid) for sid in cache_entry.storyboard_ids]
            storyboards = db.query(Storyboard).filter(
                Storyboard.id.in_(storyboard_ids)
            ).all()
            logger.info(f"Base cache HIT for '{base_key}': {len(storyboards)} storyboards (age={cache_age.total_seconds()/3600:.1f}h)")
            return storyboards

    # Build base storyboards (no personal prompt — LLM calls for summary/theme/narrative only)
    logger.info(f"Base cache MISS for '{base_key}', building storyboards...")
    storyboards = cluster_articles_for_context(user, filter_context, db=db)

    if storyboards:
        cache_entry = StoryboardCache(
            user_id=BASE_SENTINEL,
            filter_context=base_key,
            cache_date=today,
            storyboard_ids=[str(sb.id) for sb in storyboards],
            expires_at=now + timedelta(hours=24),
        )
        db.add(cache_entry)
        db.commit()
        logger.info(f"Cached {len(storyboards)} base storyboards for '{base_key}'")

    return storyboards


def _generate_fallback_prompt(summary: str, user_spec: str = None) -> str:
    """Generate a simple fallback prompt without LLM calls."""
    if user_spec:
        return f"What does this mean for your {user_spec} strategy?"
    if summary:
        # Extract a brief topic from the summary
        topic = summary[:60].split('.')[0].strip()
        return f"How does this affect your business?"
    return "What are the key takeaways for your industry?"


def _apply_cached_prompts_with_fallbacks(
    user: User,
    storyboards: List[Storyboard],
    filter_context: str,
    db: Session,
) -> List[Dict]:
    """Apply cached personal prompts to storyboards. Use fallbacks for missing ones.

    Returns list of storyboard dicts that still need real prompts generated.
    This is NON-BLOCKING — never makes LLM calls.
    """
    if not storyboards:
        return []

    sb_ids = [sb.id for sb in storyboards]

    # Batch-fetch existing prompts for this user
    existing = db.query(UserStoryboardPrompt).filter(
        UserStoryboardPrompt.user_id == user.id,
        UserStoryboardPrompt.storyboard_id.in_(sb_ids),
    ).all()
    prompt_map = {p.storyboard_id: p.personal_prompt for p in existing}

    # Determine user specialization for fallback prompts
    user_profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
    user_spec = None
    if user_profile:
        filter_data = parse_filter_context(filter_context)
        if filter_data["type"] == "specialization" and filter_data.get("value"):
            config = IndustriesConfig.get_instance()
            user_spec = config.normalize_id(filter_data["value"], 'specialization') or filter_data["value"]
        elif user_profile.specializations:
            raw = json.loads(user_profile.specializations) if isinstance(user_profile.specializations, str) else user_profile.specializations
            if raw:
                user_spec = raw[0]

    missing_sb_data = []
    for sb in storyboards:
        prompt = prompt_map.get(sb.id)
        if prompt:
            sb.__dict__['personal_prompt'] = prompt
        else:
            # Use instant fallback — real prompt will be generated in background
            sb.__dict__['personal_prompt'] = _generate_fallback_prompt(sb.summary, user_spec)
            missing_sb_data.append({'id': sb.id, 'summary': sb.summary or ''})

    return missing_sb_data


def _generate_personal_prompts_sync(
    user_id,
    storyboard_data: List[Dict],
    filter_context: str,
):
    """Generate personal prompts for storyboards in a background thread.

    This runs AFTER the response is already sent. Prompts are persisted
    to UserStoryboardPrompt so subsequent requests get real prompts.
    """
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return

        user_profile = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
        user_spec = None
        if user_profile:
            filter_data = parse_filter_context(filter_context)
            if filter_data["type"] == "specialization" and filter_data.get("value"):
                config = IndustriesConfig.get_instance()
                user_spec = config.normalize_id(filter_data["value"], 'specialization') or filter_data["value"]
            elif user_profile.specializations:
                raw = json.loads(user_profile.specializations) if isinstance(user_profile.specializations, str) else user_profile.specializations
                if raw:
                    user_spec = raw[0]

        if not user_spec:
            return

        prompt_service = PersonalPromptService()
        generated = 0

        for sb_info in storyboard_data:
            sb_id = sb_info['id']
            summary = sb_info['summary']

            # Check if already generated (race condition guard)
            exists = db.query(UserStoryboardPrompt).filter(
                UserStoryboardPrompt.user_id == user.id,
                UserStoryboardPrompt.storyboard_id == sb_id,
            ).first()
            if exists:
                continue

            prompt = prompt_service.generate_prompt(
                user_spec=user_spec,
                theme=summary[:100] if summary else "Industry trends",
                summary=summary or "",
            )
            if not prompt:
                prompt = prompt_service.generate_fallback_prompt(user_spec)

            db.add(UserStoryboardPrompt(
                user_id=user.id,
                storyboard_id=sb_id,
                personal_prompt=prompt,
            ))
            generated += 1

        if generated:
            db.commit()
            logger.info(f"Background: generated {generated} personal prompts for user {user.id}")

    except Exception as e:
        logger.error(f"Background prompt generation failed for user {user_id}: {e}")
    finally:
        db.close()


def get_or_build_storyboards_for_filter(
    user: User,
    filter_context: str,
    db: Session = None
) -> List[Storyboard]:
    """
    Get personalized storyboards for a user + filter context.

    Two-layer caching:
    1. Base storyboards cached by canonical filter key (shared across users)
    2. Personal prompts cached per user+storyboard in UserStoryboardPrompt table

    NEVER blocks on LLM calls for personal prompts. If prompts aren't cached yet,
    fallback prompts are used instantly and real prompts are generated in background.
    """
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False

    try:
        # Layer 1: Get or build base storyboards (shared, expensive LLM calls)
        storyboards = _get_or_build_base_storyboards(user, filter_context, db)

        # Layer 2: Apply cached prompts + fallbacks (NEVER blocks on LLM)
        missing_sb_data = _apply_cached_prompts_with_fallbacks(
            user, storyboards, filter_context, db
        )

        # If any prompts are missing, generate them in background thread
        if missing_sb_data:
            import threading
            logger.info(
                f"Kicking off background prompt generation for {len(missing_sb_data)} storyboards "
                f"(user {user.id})"
            )
            thread = threading.Thread(
                target=_generate_personal_prompts_sync,
                args=(user.id, missing_sb_data, filter_context),
                daemon=True,
            )
            thread.start()

        return storyboards

    except Exception as e:
        logger.error(f"Error getting/building storyboards for filter '{filter_context}': {e}")
        return []

    finally:
        if close_db:
            db.close()


def clear_storyboard_cache(user_id: uuid.UUID = None, filter_context: str = None, db: Session = None):
    """
    Clear storyboard cache. Can clear by user, filter, or all base caches.

    Args:
        user_id: User UUID (None clears base caches)
        filter_context: Optional filter context to clear (clears all if None)
        db: Database session
    """
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False

    try:
        if user_id:
            query = db.query(StoryboardCache).filter(StoryboardCache.user_id == user_id)
        else:
            # Clear base caches (sentinel user_id)
            BASE_SENTINEL = uuid.UUID('00000000-0000-0000-0000-000000000000')
            query = db.query(StoryboardCache).filter(StoryboardCache.user_id == BASE_SENTINEL)

        if filter_context:
            query = query.filter(StoryboardCache.filter_context == filter_context)

        deleted_count = query.delete()
        db.commit()

        logger.info(f"Cleared {deleted_count} cache entries")

    finally:
        if close_db:
            db.close()
