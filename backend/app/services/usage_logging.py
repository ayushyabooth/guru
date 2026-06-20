"""
Claude API usage logging (GUR-238).

A single helper to emit a structured, greppable line for every Claude call in
the ingestion / enrichment path, so we can attribute spend per activity from
Railway logs instead of guessing. Pair with the Anthropic Console for $ truth.

Grep `[claude-usage]` in logs to total tokens by activity after a run.
"""
import logging

logger = logging.getLogger(__name__)

# Haiku 4.5 list pricing ($/token). Used only for a rough in-log $ estimate —
# the Anthropic Console is the billing source of truth. Web-search surcharge
# ($/search) is NOT included here; see web_search_requests below.
_HAIKU_IN = 1.0 / 1_000_000
_HAIKU_OUT = 5.0 / 1_000_000
_HAIKU_CACHE_READ = 0.1 / 1_000_000


def log_claude_usage(response, activity: str, **ctx) -> None:
    """Log token usage for one Claude response.

    activity: short tag, e.g. "tier3_discovery", "rich_content",
              "cluster_summary", "cluster_theme", "cluster_narrative".
    ctx:      optional context (spec, article_id, model) folded into the line.
    """
    try:
        u = getattr(response, "usage", None)
        if u is None:
            return
        in_tok = getattr(u, "input_tokens", 0) or 0
        out_tok = getattr(u, "output_tokens", 0) or 0
        cache_read = getattr(u, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(u, "cache_creation_input_tokens", 0) or 0

        # Web-search request count, when present (server_tool_use). Drives the
        # $10/1k-search surcharge that token math alone misses.
        web_searches = 0
        stu = getattr(u, "server_tool_use", None)
        if stu is not None:
            web_searches = getattr(stu, "web_search_requests", 0) or 0

        est = round(in_tok * _HAIKU_IN + out_tok * _HAIKU_OUT + cache_read * _HAIKU_CACHE_READ, 5)
        extra = " ".join(f"{k}={v}" for k, v in ctx.items() if v is not None)
        logger.info(
            f"[claude-usage] activity={activity} in={in_tok} out={out_tok} "
            f"cache_read={cache_read} cache_write={cache_write} "
            f"web_searches={web_searches} est_token_usd={est} {extra}".rstrip()
        )
    except Exception as e:  # never let logging break a real call
        logger.debug(f"usage logging failed for {activity}: {e}")
