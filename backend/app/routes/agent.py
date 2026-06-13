"""
Agentic Guru tab backend (Epic H, GUR-228).

POST /api/v1/agent/turn — SSE-streamed agent turn. A manual Claude tool-use
loop where every tool is a thin wrapper over an EXISTING /api/v1 endpoint
(called in-process via httpx ASGITransport with the user's own bearer token),
so no business logic is duplicated. The model's final text is a versioned JSON
block list ("generative UI") rendered by the frontend BlockRenderer.

Human-in-the-loop: read tools execute autonomously; WRITE tools never execute
directly — the loop emits an `approval` block, persists the pending action on
the AgentSession, and ends the turn. The next turn with input.type="decision"
executes (or declines) it and resumes.

Architecture contract: docs/agentic-ui-architecture.md
"""
import asyncio
import json
import logging
import queue
import threading
import uuid
from typing import Optional

import anthropic
import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.agent_session import AgentSession

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/agent", tags=["agent"])

AGENT_MODEL = getattr(settings, "AGENT_MODEL", None) or "claude-sonnet-4-6"
MAX_ITERS = 8
MAX_HISTORY_MSGS = 40  # keep sessions bounded

# ── Tools (thin wrappers over existing endpoints) ────────────────────────────

# Writes that COMPOSE content on the user's behalf (notes, commitments) get an
# approval gate. save/not-relevant do NOT (R19, founder): the user's tap or
# message IS the consent — asking again was double-confirmation. The system
# prompt forbids calling them unprompted. Recap progression likewise acts on
# the user's direct instruction.
WRITE_TOOLS = {"add_note", "set_commitment"}

TOOLS = [
    {
        "name": "get_catchup_feed",
        "description": "Get today's catch-up feed: storyboards with in-focus article, summaries, spotlight quotes. Call this for 'catch me up' style goals. Filter examples: 'core', 'specialization:Curriculum Development', 'interest:Consumer'.",
        "input_schema": {"type": "object", "properties": {"filter": {"type": "string", "description": "Content filter context. Default 'core'."}}},
    },
    {
        "name": "get_divein_feed",
        "description": "Get the dive-in feed: the user's saved-for-later articles, expert picks, and discovery pool. Call for 'clear my saved queue' / deep-reading goals.",
        "input_schema": {"type": "object", "properties": {"filter": {"type": "string", "description": "Content filter context. Default 'core'."}}},
    },
    {
        "name": "get_metrics",
        "description": "Get the user's progress: today's + weekly ring minutes (catchup/divein/recap), streak, articles read/saved, top topics. Optional filter scopes it.",
        "input_schema": {"type": "object", "properties": {"filter": {"type": "string"}}},
    },
    {
        "name": "get_recent_notes",
        "description": "The user's recent notes across articles (their own captured thinking). REQUIRED material for the weekly recap; also useful to avoid duplicate crux notes.",
        "input_schema": {"type": "object", "properties": {"days": {"type": "integer", "description": "Window, default 7"}}},
    },
    {
        "name": "get_commitment",
        "description": "Get the user's One Commitment from their last weekly recap. Use it to bias article selection ('commitment weaving') and set commitment_flag on qualifying article_card blocks.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "ask_guru",
        "description": "Ask the Socratic Q&A engine a question about a specific article. Returns a concise mentor answer plus follow-up prompts. Use for free-form questions about an article.",
        "input_schema": {
            "type": "object",
            "properties": {
                "article_id": {"type": "string", "description": "Article UUID"},
                "question": {"type": "string"},
            },
            "required": ["article_id", "question"],
        },
    },
    {
        "name": "save_article",
        "description": "Save an article to the user's dive-in queue. Executes IMMEDIATELY — call it ONLY when the user just asked to save (tapped Save / said save it). If YOU think something deserves saving unprompted, suggest it in text/pills and wait for their word.",
        "input_schema": {
            "type": "object",
            "properties": {
                "article_id": {"type": "string"},
                "title": {"type": "string", "description": "Article title, shown on the approval card"},
            },
            "required": ["article_id", "title"],
        },
    },
    {
        "name": "save_highlight",
        "description": "Save an exact quote from an article as a HIGHLIGHT (lands in the user's Notes tab alongside reader highlights, feeds recap). Executes IMMEDIATELY — call ONLY when the user just asked to highlight/keep a quote; never unprompted.",
        "input_schema": {
            "type": "object",
            "properties": {
                "article_id": {"type": "string"},
                "quote": {"type": "string", "description": "The exact quote text"},
                "title": {"type": "string", "description": "Article title"},
            },
            "required": ["article_id", "quote", "title"],
        },
    },
    {
        "name": "mark_not_relevant",
        "description": "Mark a storyboard as not relevant, removing it from the user's feed. Executes IMMEDIATELY — call it ONLY when the user just asked to skip/remove it; never unprompted.",
        "input_schema": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string"},
                "title": {"type": "string", "description": "Storyboard headline, shown on the approval card"},
            },
            "required": ["storyboard_id", "title"],
        },
    },
    {
        "name": "get_article_deep",
        "description": "Get an article's full deep-read content (text + rich insights). Use for deep-dive goals so you can discuss specifics, pull takeaways, and propose notes.",
        "input_schema": {
            "type": "object",
            "properties": {"article_id": {"type": "string"}},
            "required": ["article_id"],
        },
    },
    {
        "name": "add_note",
        "description": "Save a note onto an article (appears in the user's Notes alongside their highlights, feeds the weekly recap). WRITE: requires user approval. PROTOCOL: in this SAME response, BEFORE this tool call, you MUST write your {\"blocks\":[...]} JSON containing a substantive text block (for a user take: one genuine counterargument). Calling this tool with no preceding blocks in the response is a protocol violation — the user would see a bare dialog.",
        "input_schema": {
            "type": "object",
            "properties": {
                "article_id": {"type": "string"},
                "note": {"type": "string", "description": "The note text — concise, in the user's voice"},
                "title": {"type": "string", "description": "Article title, shown on the approval card"},
            },
            "required": ["article_id", "note", "title"],
        },
    },
    {
        "name": "get_recap_state",
        "description": "Get the user's recap journeys (latest first): journey_id, status, current stage. Call before starting or resuming a weekly recap.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "start_recap",
        "description": "Start (or resume) this week's recap journey. Returns journey_id, stage, and the Stage-1 week snapshot. Call when the user asks to run their weekly recap.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_recap_questions",
        "description": "Get the Stage-2 guided active-recall questions for a recap journey.",
        "input_schema": {
            "type": "object",
            "properties": {"journey_id": {"type": "string"}},
            "required": ["journey_id"],
        },
    },
    {
        "name": "submit_recap_answer",
        "description": "Submit the user's answer (their own typed words) to a Stage-2 question. No approval needed — the user's message is the consent.",
        "input_schema": {
            "type": "object",
            "properties": {
                "journey_id": {"type": "string"},
                "question_index": {"type": "integer"},
                "response": {"type": "string", "description": "The user's answer, verbatim or lightly cleaned"},
            },
            "required": ["journey_id", "question_index", "response"],
        },
    },
    {
        "name": "recap_socratic",
        "description": "Stage-3 Socratic dialogue inside the recap: send the user's reflection and get the mentor's probing response.",
        "input_schema": {
            "type": "object",
            "properties": {
                "journey_id": {"type": "string"},
                "message": {"type": "string"},
            },
            "required": ["journey_id", "message"],
        },
    },
    {
        "name": "get_recap_insights",
        "description": "Get the Stage-4 extracted insights for a recap journey (themes + takeaways for the week).",
        "input_schema": {
            "type": "object",
            "properties": {"journey_id": {"type": "string"}},
            "required": ["journey_id"],
        },
    },
    {
        "name": "set_commitment",
        "description": "Set the user's One Commitment for next week on a recap journey. WRITE: requires user approval. PROTOCOL: in this SAME response, BEFORE this tool call, write your {\"blocks\":[...]} JSON with a short text block framing the commitment. A bare dialog is a protocol violation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "journey_id": {"type": "string"},
                "text": {"type": "string", "description": "The commitment, one sentence, actionable"},
            },
            "required": ["journey_id", "text"],
        },
    },
]

STATUS_TEXT = {
    "get_catchup_feed": "reading your catch-up feed…",
    "get_divein_feed": "reading your saved queue…",
    "get_metrics": "checking your rings…",
    "get_recent_notes": "gathering your notes…",
    "get_commitment": "recalling your commitment…",
    "save_highlight": "keeping that quote…",
    "ask_guru": "thinking it through…",
    "get_article_deep": "reading the article closely…",
    "get_recap_state": "checking your recap…",
    "start_recap": "preparing your week's snapshot…",
    "get_recap_questions": "writing your recall questions…",
    "submit_recap_answer": "weighing your answer…",
    "recap_socratic": "reflecting with you…",
    "get_recap_insights": "extracting your insights…",
}

# ── System prompt (static → cached; dynamic context appended per session) ────

SYSTEM_STATIC = """You are Guru's agent — the engine behind the app's agentic tab. You turn a user's reading goal into a short, visible journey and execute it step by step using tools. Audience: a busy professional doing focused learning.

PROTOCOL (Journey Pipeline):
1. When given a NEW GOAL: gather what you need with read tools (feed, metrics, commitment), then respond with a `plan` block (3-5 steps, realistic minute estimates) plus one short `text` block. Do NOT execute steps yet — the user approves/starts the plan first.
2. When the user says to start/continue/next: execute the CURRENT step only, then present its result as blocks (e.g. one `article_card` for review, or `rings`/`stats` for progress) and an updated `plan` block with statuses. One step per turn keeps the user in control.
3. Saves and removals (save_article / mark_not_relevant) execute IMMEDIATELY — the user's tap or message is the consent, never ask them to confirm again. Only call them when the user just asked; if YOU want to suggest saving something, offer it via text/pills and wait. Notes and commitments (add_note / set_commitment) are approval-gated automatically. Never claim a write happened until you see its tool result.
4. When all steps are done: respond with an `outcome_summary` block tallying what actually happened (only count writes confirmed by tool results) + `prompt_pills` with 2-3 next-step suggestions.
5. Free-form questions at any time: answer them inline (use ask_guru when about a specific article), then offer to resume the journey.

REFLECTION CAPTURE (R21): reflection is only learning if it's KEPT. When the user answers a reflection question (or shares any substantive thinking about a story), respond to their idea briefly — engage with the substance, never grade it — then ALWAYS offer to keep it: call add_note with their reflection phrased in THEIR words (light cleanup only), tied to the story's article. The approval card is the offer ("Add this note?"). One reflection = one note; don't pile on. This mirrors the Catch-up feed's "What comes to mind?" jot flow — the agent experience must never be the place reflections go to die.

CATCH-UP DEPTH (R20): the feed arrives PRE-PROCESSED with editorial nuance — use it, don't flatten it. For every in-focus story: (1) the card carries `why_matters` (you get up to 400 chars — pick the sharpest thread, don't generically summarize); (2) pair it with ONE `quote` block from `spotlight_quotes` when one lands; (3) weave `between_the_lines` into your text block — that's the non-obvious read your user can't get from the headline; (4) your closing `prompt_pills` MUST include 1-2 of the story's `reflection_questions` (lightly trimmed to pill length) — these are crafted to make the user think, and questions are how catch-up becomes learning. Vary which nuance leads based on the story: a contrarian piece leads with between_the_lines; a news piece leads with why_matters; an essay leads with its best quote.

COMMITMENT WEAVING: if the user has a commitment, bias article choices toward it and set commitment_flag=true on qualifying article cards. Mention it naturally, don't preach.

DIVE-IN CRUX PROTOCOL (GUR-231 — dive-in mode, saved-queue walks, "build the crux", any dive-in journey): dive-in is NOT catch-up. Catch-up triages many stories; dive-in builds DETAILED UNDERSTANDING of few. The journey is a queue walk: plan 2-3 saved articles (by the session's time budget), each getting the full crux descent before moving on. Per article, across 1-2 turns:
1. `article_card` (standard) to set the stage, then the DESCENT in order: `text` — the CORE ARGUMENT (the author's real claim, from `core_argument`, sharpened not quoted); `quote` — the strongest evidence line (from `strongest_evidence`/`spotlight_quotes`); `text` — the COUNTERPOINTS (from `counterpoints` + `between_the_lines`: what would change the author's mind, where the argument is weakest). You present all of this — the user's job is judgment, not recall.
2. Then ask for THEIR TAKE — one pointed question ("Where do you land — does the evidence carry the claim?"), pills offering stances to react to. Engage with whatever they say; push back where their take skips the counterpoint.
3. After their take: offer the CRUX NOTE via add_note — markdown structured exactly as: **Argument:** … / **Evidence:** … / **Counterpoint:** … / **My take:** <their words>. Title the note "Crux — <short article title>". One crux note per article.
4. Update the `plan` block; next article is the next step. The outcome_summary tallies cruxes built.
CRUX INTERACTION (R24): the descent must END in the user's thinking, not in your prose. After presenting argument/evidence/counterpoints, explicitly invite their response with ONE pointed question, and the closing pills must include: a stance to react to, "Keep that quote" (→ save_highlight with the exact quote you showed), and "Capture a note on this". When the user asks to highlight/keep a quote, call save_highlight immediately (their word is the consent). Their take always gets the VOICE counterargument, then the add_note offer.
If crux fields are missing on an article (older content), call get_article_deep and compose the descent yourself from the full text — never skip the protocol. Use ask_guru for their follow-up questions. Deep-read option: the card keeps the "open" action — reading in full in the reader (highlights/notes) is always one tap.

CAPTURE STEP (GUR-231, ALL journey modes): every plan's FINAL step is "Capture takeaways". When the journey reaches it, harvest 1-3 note candidates from the session — the user's own words where they contributed, the sharpest insight where they didn't — and offer them via add_note ONE at a time (each approval card is one offer). The outcome_summary must tally notes captured ("3 cruxes · 2 notes"). A journey that ends with zero capture offers is a failure.

RECAP READINESS (GUR-231): get_metrics returns notes_this_week. Weave it in naturally where it motivates — after a capture ("that's four this week — Friday's recap will have real material"), or when proposing a journey ("no notes yet this week; let's fix that while we read"). Never nag; always tie it to the recap payoff.

WEEKLY RECAP ("run my recap" / "what did I learn") — the recap is about what the USER thought, not what they read (R23 judges). Call get_recap_state, then start_recap if none active this week; ALSO call get_recent_notes — the user's captured notes are the recap's raw material. Walk the stages conversationally, ONE question per turn:
- Stage 1 snapshot: QUOTE 1-3 of the user's own notes back to them (short `quote` blocks attributed as "your note on <article>") + minimal honest stats (articles read, notes captured — numbers from tool results ONLY; never editorialize the week or pad with filler metrics like filters explored).
- Stage 2: anchor recall questions on the user's NOTES and prior answers when they exist (the article content is the fallback, not the default). Present each as a `recap_step` block {"type":"recap_step","stage":2,"title":"Active recall","prompt":"<the question>","journey_id":"...","question_index":0}; submit answers with submit_recap_answer; engage with the substance per VOICE, no grading.
- Stage 3: one reflective exchange via recap_socratic.
- Stage 4: get_recap_insights → present as `text` + `quote`; then propose ONE commitment that ties directly to one of the user's notes and call set_commitment (approval-gated automatically).
End with `outcome_summary`. If the user has too little activity for a meaningful recap, say so and suggest a catch-up instead.

OUTPUT FORMAT (STRICT): your final text in every turn must be ONLY a JSON object:
{"blocks": [ ... ]}
No prose outside the JSON. Block types (v1):
- {"type":"text","md":"markdown string — keep it short and warm"}
- {"type":"plan","goal":"...","eta_min":12,"steps":[{"n":1,"title":"...","eta":"6 min","status":"pending|active|done|skipped"}]}
- {"type":"article_card","variant":"hero|standard|mini","article_id":"...","title":"...","source":"...","url":"https://...","image_url":"https://...","reading_time":3,"summary":"1-2 sentences","why_matters":"1 sentence — the personal stake","commitment_flag":false,"actions":["save","skip","ask","open"]}
  (ALWAYS include url, image_url and why_matters when you have them. hero = full-bleed image card; standard = side-thumb card; mini = compact tappable row, summary/actions omitted.)
- {"type":"carousel","items":[<article_card>, ...]}  (max 3 items)
- {"type":"rings","c":0.8,"d":0.4,"r":0.0,"caption":"..."}
- {"type":"stats","items":[{"label":"read","value":"4","big":false}]}  (big=true → stat-hero: one number worth feeling)
- {"type":"quote","text":"...","article_id":"..."}
- {"type":"prompt_pills","prompts":["...","..."]}
- {"type":"recap_step","stage":2,"title":"Active recall","prompt":"<question for the user>","journey_id":"...","question_index":0}
- {"type":"outcome_summary","lines":["+14m Catch-up","2 saved"],"commitment_line":"1 article advanced it" ,"rings":{"c":0.86,"d":0.4,"r":0},"followups":["Start my weekly recap"]}
Keep every turn under ~6 blocks. Be concrete and brief; the cards carry the content, the text block carries the voice (sharp, encouraging mentor — never corporate).

BROWSER WIDGET (extension): if the user asks about the Guru widget/extension, reading with Guru on external sites, or why articles open without Guru overlays, give these exact install steps as a numbered list (Chrome/Chromium only): 1) Download the widget from https://mobile-guru8.vercel.app/guru-extension.zip and unzip it. 2) Type chrome://extensions into a new tab (it can't be linked). 3) Toggle ON "Developer mode" (top-right). 4) Click "Load unpacked" (top-left) and select the unzipped folder. 5) Reload the article page — the Guru orb appears bottom-right. Also mention the in-app Setup page (the "Get the full Guru experience" card on Home or the Guru tab) walks them through it with live detection.

VOICE (NON-NEGOTIABLE, R23 judges): never praise the user or their input — no "sharp", "great", "honestly", "insight that ages well", no grades, NO EMOJI anywhere. Respond to the SUBSTANCE of what they said: name the strongest part of their idea by restating its consequence, then complicate it. When the user gives a take or thesis, your next move is ONE genuine counterargument or complication (steelman the other side, specific to their claim) BEFORE any note offer — they came to think, not to be agreed with. Confidence is specificity, not enthusiasm. Never assert unverifiable observations ("the system noticed…") and never cite a number that isn't in a tool result.

APPROVAL PREAMBLE (ALWAYS, PROTOCOL-LEVEL): never let an approval card be the whole turn — a response that calls add_note/set_commitment without blocks JSON earlier in that same response is INVALID. When calling add_note or set_commitment, the SAME response must first output your blocks JSON with one short text block reacting to the substance (for a user take: the counterargument above), THEN the tool call. A bare dialog feels like talking to a form.

FAST FIRST CONTENT (catch-up goals): your get_catchup_feed call auto-renders an instant headline strip of mini cards to the user (the system does this — not you). Do NOT render your own mini list; after the tool result, lead DIRECTLY with the in-focus story (hero card + descent). Keep pills under 60 characters — a pill is an action, not an essay.

NO SCAFFOLDING (ALWAYS): internal identifiers — UUIDs, article/journey/storyboard ids, field names — must NEVER appear in any user-visible text, pill, title, or detail line. Refer to articles by short title only ("Save 'Policy Blueprint'", never "(article c5af1e5d-…)"). IDs belong exclusively in tool-call arguments; you already know which article is in focus from the conversation.

ENGAGEMENT RULE (ALWAYS): end EVERY turn with a `prompt_pills` block of 2-4 next-best actions, mixing: (1) the natural next step, (2) one lateral move (switch mode — e.g. "Dive into my saved queue", "Run my recap", "Show my progress"), (3) one curiosity hook about the current item. Never leave the user without tappable options. Pair an article step with its spotlight quote as a `quote` block when available — context should come in subtly, not as walls of text.

PRESENTATION INTELLIGENCE — you choose HOW to present, within these rules:
1. ONE hero max per turn: the single thing deserving attention right now (the new in-focus story, a commitment match, the journey finale). Heroes always carry image_url when available (use the storyboard's image_url for its in-focus article).
2. STANDARD for the one item actively being worked. MINI rows for anything plural — queues, what's left, skipped items, recap lists. NEVER stack 3+ standard/hero cards.
3. Vary shapes every turn: mix at least two of {card, mini rows, stat/quote, rings, pills}. Text blocks ≤2 sentences — the blocks carry content, text carries voice.
4. Match emphasis to context: draw attention (hero, big stat) when stakes are high; go deep (standard + quote + why_matters) when focused; recede (minis + pills) when the user is triaging.
A text-only turn is a failure. A wall of same-shaped cards is a failure."""


# ── Helpers ──────────────────────────────────────────────────────────────────


def _trunc(text, n: int) -> str:
    """Sentence-boundary truncation (GUR-231 judges: hard slices fed mid-word
    cuts to the model, which echoed them verbatim into cards/quotes/pills).
    Cuts at the last sentence end before n; falls back to the last word."""
    t = (text or "").strip()
    if len(t) <= n:
        return t
    cut = t[:n]
    for mark in (". ", "! ", "? "):
        i = cut.rfind(mark)
        if i >= int(n * 0.4):
            return cut[: i + 1].strip()
    i = cut.rfind(" ")
    return (cut[:i].rstrip(" ,;:—-") + "…") if i > 0 else cut

def _slim_article(a: dict) -> dict:
    rich = a.get("rich_summary") or {}
    wc = a.get("word_count")
    return {
        "article_id": a.get("id") or a.get("article_id"),
        "title": a.get("title"),
        "source": a.get("source"),
        "url": a.get("url"),
        "image_url": a.get("article_image_url") or a.get("thumbnail_url") or a.get("image_url"),
        "reading_time": a.get("reading_time") or (max(1, round(wc / 200)) if wc else None),
        "summary": _trunc(a.get("summary") or rich.get("whats_in_article") or a.get("expert_takeaway"), 220),
        "why_matters": _trunc(rich.get("why_it_matters"), 200),
        "spotlight_quote": _trunc((rich.get("spotlight_quotes") or [None])[0], 240),
        "industry": a.get("industry") or a.get("context"),
        "is_saved": a.get("is_saved", False),
    }


def _slim_storyboard(s: dict) -> dict:
    # Real /catchup-feed shape: theme/summary/cluster_narrative/personal_prompt
    # + headline_article (the in-focus article) + related_articles.
    art = s.get("headline_article") or s.get("in_focus_article") or s.get("article") or {}
    rich = art.get("rich_summary") or {}
    return {
        "storyboard_id": s.get("id") or s.get("storyboard_id"),
        "theme": s.get("theme") or s.get("headline") or s.get("title"),
        "image_url": s.get("visual_url"),  # hero image for the in-focus card
        "industry": s.get("industry"),
        "summary": _trunc(s.get("summary"), 400),
        "narrative": _trunc(s.get("cluster_narrative"), 400),
        "personal_prompt": _trunc(s.get("personal_prompt"), 220),
        "in_focus_article": _slim_article(art),
        # R20 (founder): surface the feed's full pre-processed nuance — the
        # agent was working from crumbs (why_matters cut to 200 of ~510 chars;
        # between_the_lines and the article's socratic_prompts never sent).
        "whats_in_article": _trunc(rich.get("whats_in_article"), 350),
        "why_matters": _trunc(rich.get("why_it_matters"), 400),
        "between_the_lines": _trunc(rich.get("between_the_lines"), 320),
        "spotlight_quotes": (rich.get("spotlight_quotes") or [])[:3],
        "reflection_questions": (art.get("socratic_prompts") or [])[:3],
        "more_articles": [_slim_article(a) for a in (s.get("related_articles") or s.get("carousel_articles") or [])[:4]],
    }


def _slim_tool_result(name: str, status: int, data) -> str:
    """Compact tool output so feeds don't blow up the context window."""
    try:
        if status >= 400:
            return json.dumps({"error": f"HTTP {status}", "detail": str(data)[:300]})
        if name == "get_catchup_feed":
            sbs = data.get("storyboards") or data.get("items") or []
            return json.dumps({"storyboards": [_slim_storyboard(s) for s in sbs[:5]]})
        if name == "get_divein_feed":
            # GUR-231: saved articles carry the full crux material (pre-processed
            # at ingestion) — the dive-in journey is built on it.
            def _crux(a: dict) -> dict:
                rich = a.get("rich_summary") or {}
                out = _slim_article(a)
                out.update({
                    "core_argument": _trunc(rich.get("core_argument"), 300),
                    "strongest_evidence": (rich.get("strongest_evidence") or [])[:3],
                    "counterpoints": (rich.get("counterpoints") or [])[:2],
                    "between_the_lines": _trunc(rich.get("between_the_lines"), 300),
                    "spotlight_quotes": (rich.get("spotlight_quotes") or [])[:3],
                    "reflection_questions": (a.get("socratic_prompts") or [])[:2],
                })
                return out
            return json.dumps({
                "saved": [_crux(a) for a in (data.get("saved_articles") or [])[:8]],
                "expert_picks": [_slim_article(a) for a in (data.get("essential_articles") or [])[:5]],
                "discovery": [_slim_article(a) for a in (data.get("discovery_articles") or [])[:5]],
            })
        if name == "get_recent_notes":
            return json.dumps({"notes": [
                {"article_id": n.get("article_id"), "article_title": n.get("article_title"),
                 "note": _trunc(n.get("note"), 400), "created_at": (n.get("created_at") or "")[:10]}
                for n in (data.get("notes") or [])[:10]
            ]})
        if name == "get_metrics":
            today = data.get("today") or {}
            return json.dumps({
                "today": today,
                "streak": data.get("current_streak"),
                "articles_read": data.get("articles_read"),
                "articles_saved": data.get("articles_saved"),
                "top_topics": data.get("top_topics"),
                "recap_status": data.get("recap_journey_status"),
                "notes_this_week": data.get("notes_this_week", 0),
            })
        if name == "ask_guru":
            return json.dumps({
                "answer": _trunc(data.get("response"), 900),
                "follow_ups": data.get("follow_up_prompts", [])[:3],
            })
        if name == "get_article_deep":
            content = data.get("content") or data.get("full_text") or data.get("text") or ""
            return json.dumps({
                "title": data.get("title"),
                "source": data.get("source"),
                "content_excerpt": content[:2400],
                "summary": (data.get("summary") or "")[:400],
            })
        if name == "get_recap_state":
            sessions = data if isinstance(data, list) else data.get("sessions") or data.get("journeys") or []
            slim = [{"journey_id": s.get("id") or s.get("journey_id"), "status": s.get("status"),
                     "stage": s.get("current_stage") or s.get("stage"), "week_start": s.get("week_start")}
                    for s in sessions[:3]]
            return json.dumps({"journeys": slim})
        if name == "get_recap_questions":
            qs = data.get("questions") if isinstance(data, dict) else data
            slim_q = []
            for i, q in enumerate((qs or [])[:6]):
                if isinstance(q, dict):
                    slim_q.append({"index": q.get("index", i), "question": (q.get("question") or q.get("text") or "")[:300],
                                   "type": q.get("type") or q.get("question_type")})
                else:
                    slim_q.append({"index": i, "question": str(q)[:300]})
            return json.dumps({"questions": slim_q})
        if name in ("start_recap", "submit_recap_answer", "recap_socratic", "get_recap_insights", "set_commitment"):
            return json.dumps(data)[:2200]
        return json.dumps(data)[:1500]
    except Exception:
        return str(data)[:800]


async def _call_api(app, token: str, method: str, path: str, json_body=None, params=None):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://internal", timeout=60) as c:
        r = await c.request(method, path, json=json_body, params=params, headers={"Authorization": token})
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text


async def _execute_tool(app, token: str, name: str, tool_input: dict) -> str:
    f = (tool_input or {}).get("filter") or "core"
    if name == "get_catchup_feed":
        status, data = await _call_api(app, token, "GET", "/api/v1/catchup-feed", params={"filter": f})
    elif name == "get_divein_feed":
        status, data = await _call_api(app, token, "GET", "/api/v1/divein-feed", params={"filter": f, "limit": 10, "offset": 0})
    elif name == "get_metrics":
        params = {"filter": f} if tool_input.get("filter") else None
        status, data = await _call_api(app, token, "GET", "/api/v1/me/metrics", params=params)
    elif name == "get_recent_notes":
        status, data = await _call_api(app, token, "GET", "/api/v1/me/notes",
                                       params={"days": tool_input.get("days") or 7, "limit": 10})
    elif name == "get_commitment":
        status, data = await _call_api(app, token, "GET", "/api/v1/me/commitment")
    elif name == "ask_guru":
        status, data = await _call_api(app, token, "POST", "/api/v1/socratic/chat",
                                       json_body={"article_id": tool_input["article_id"], "question": tool_input["question"]})
    elif name == "save_article":
        status, data = await _call_api(app, token, "POST", f"/api/v1/articles/{tool_input['article_id']}/save")
    elif name == "save_highlight":
        status, data = await _call_api(app, token, "POST", f"/api/v1/articles/{tool_input['article_id']}/annotations",
                                       json_body={"highlighted_text": _trunc(tool_input.get("quote"), 500), "note_text": "",
                                                  "color": "amber", "start_offset": 0, "end_offset": 0})
    elif name == "mark_not_relevant":
        status, data = await _call_api(app, token, "POST", f"/api/v1/storyboards/{tool_input['storyboard_id']}/not-relevant")
    elif name == "get_article_deep":
        status, data = await _call_api(app, token, "GET", f"/api/v1/articles/{tool_input['article_id']}/deep")
    elif name == "add_note":
        status, data = await _call_api(app, token, "POST", f"/api/v1/articles/{tool_input['article_id']}/annotations",
                                       json_body={"highlighted_text": "Note", "note_text": tool_input["note"],
                                                  "color": "gold", "start_offset": 0, "end_offset": 0})
    elif name == "get_recap_state":
        status, data = await _call_api(app, token, "GET", "/api/v1/recap/sessions")
    elif name == "start_recap":
        status, data = await _call_api(app, token, "POST", "/api/v1/recap/start", json_body={"force_new": False})
    elif name == "get_recap_questions":
        status, data = await _call_api(app, token, "GET", f"/api/v1/recap/{tool_input['journey_id']}/questions")
    elif name == "submit_recap_answer":
        status, data = await _call_api(app, token, "POST", f"/api/v1/recap/{tool_input['journey_id']}/answer",
                                       json_body={"question_index": int(tool_input["question_index"]),
                                                  "response": tool_input["response"]})
    elif name == "recap_socratic":
        status, data = await _call_api(app, token, "POST", f"/api/v1/recap/{tool_input['journey_id']}/socratic",
                                       json_body={"message": tool_input["message"]})
    elif name == "get_recap_insights":
        status, data = await _call_api(app, token, "GET", f"/api/v1/recap/{tool_input['journey_id']}/insights")
    elif name == "set_commitment":
        status, data = await _call_api(app, token, "POST", f"/api/v1/recap/{tool_input['journey_id']}/commitment",
                                       json_body={"text": tool_input["text"]})
    else:
        return json.dumps({"error": f"unknown tool {name}"})
    return _slim_tool_result(name, status, data)


class _BlockStreamParser:
    """Incrementally extracts completed block objects from the model's
    streaming `{"blocks":[...]}` output so the UI renders each block the
    moment its JSON closes, instead of waiting ~6s for the full response
    (GUR-229: blocks used to land in one burst at end-of-turn)."""

    def __init__(self):
        self.buf = ""
        self.pos = 0            # scan cursor
        self.in_array = False   # seen the opening '[' of "blocks"
        self.obj_start = -1     # index of current object's '{'
        self.depth = 0
        self.in_str = False
        self.esc = False
        self.emitted = 0
        self.done = False       # blocks array closed; ignore any further text

    def feed(self, chunk: str) -> list:
        self.buf += chunk
        if self.done:
            return []
        out = []
        if not self.in_array:
            m = self.buf.find('"blocks"')
            if m == -1:
                return out
            b = self.buf.find("[", m)
            if b == -1:
                return out
            self.in_array = True
            self.pos = b + 1
        i = self.pos
        while i < len(self.buf):
            c = self.buf[i]
            if self.in_str:
                if self.esc:
                    self.esc = False
                elif c == "\\":
                    self.esc = True
                elif c == '"':
                    self.in_str = False
            elif c == '"':
                self.in_str = True
            elif c == "{":
                if self.depth == 0:
                    self.obj_start = i
                self.depth += 1
            elif c == "}":
                self.depth -= 1
                if self.depth == 0 and self.obj_start >= 0:
                    try:
                        obj = json.loads(self.buf[self.obj_start:i + 1])
                        if isinstance(obj, dict) and obj.get("type"):
                            out.append(obj)
                            self.emitted += 1
                    except Exception:
                        pass
                    self.obj_start = -1
            elif c == "]" and self.depth == 0:
                self.done = True  # array closed; ignore trailing text
                i += 1
                break
            i += 1
        self.pos = i
        return out


def _parse_blocks(raw: str) -> list:
    """Tolerant parse of the model's final {'blocks':[...]} output."""
    t = (raw or "").strip()
    if t.startswith("```"):
        t = t.split("```")[1]
        if t.startswith("json"):
            t = t[4:]
        t = t.strip()
    start = t.find("{")
    if start > 0:
        t = t[start:]
    try:
        parsed = json.loads(t)
        if isinstance(parsed, dict) and isinstance(parsed.get("blocks"), list):
            return [b for b in parsed["blocks"] if isinstance(b, dict) and b.get("type")]
        if isinstance(parsed, list):
            return [b for b in parsed if isinstance(b, dict) and b.get("type")]
    except Exception:
        pass
    return [{"type": "text", "md": raw.strip()}] if raw and raw.strip() else []


def _serialize_content(content) -> list:
    out = []
    for block in content:
        if block.type == "text":
            out.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            out.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
        # thinking blocks are not persisted (single-turn value only)
    return out


def _approval_block(name: str, tool_input: dict, approval_id: str) -> dict:
    if name == "save_article":
        title, detail, confirm, cancel = "Save this article?", [tool_input.get("title", "")], "Save", "Keep as is"
    elif name == "mark_not_relevant":
        title, detail, confirm, cancel = "Remove from your feed?", [tool_input.get("title", "")], "Remove", "Keep as is"
    elif name == "add_note":
        title = "Add this note to the article?"
        detail = [f'"{tool_input.get("note") or ""}"', tool_input.get("title", "")]  # FULL text — never ask approval on a cut preview (GUR-231 judges)
        confirm, cancel = "Add note", "Discard"
    elif name == "set_commitment":
        title = "Set as next week's commitment?"
        detail = [f'"{tool_input.get("text") or ""}"', "This will shape next week's reading."]
        confirm, cancel = "Commit", "Not yet"
    else:
        title, detail, confirm, cancel = "Proceed?", [], "Yes", "No"
    return {
        "type": "approval", "approval_id": approval_id, "title": title,
        "detail_lines": [d for d in detail if d], "confirm_label": confirm, "cancel_label": cancel,
    }


# ── Route ────────────────────────────────────────────────────────────────────

class AgentInput(BaseModel):
    type: str  # "goal" | "message" | "decision"
    text: Optional[str] = None
    approval_id: Optional[str] = None
    approved: Optional[bool] = None


class AgentTurnRequest(BaseModel):
    session_id: Optional[str] = None
    input: AgentInput


@router.post("/turn")
async def agent_turn(
    body: AgentTurnRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token = request.headers.get("authorization", "")
    app = request.app

    # Load or create the session
    sess = None
    if body.session_id:
        sess = db.query(AgentSession).filter(
            AgentSession.id == body.session_id, AgentSession.user_id == current_user.id
        ).first()
    if not sess:
        sess = AgentSession(id=uuid.uuid4(), user_id=current_user.id,
                            title=(body.input.text or "Guru session")[:200], messages="[]")
        db.add(sess)
        db.commit()
        db.refresh(sess)

    messages = json.loads(sess.messages or "[]")
    pending = json.loads(sess.pending_action) if sess.pending_action else None

    # Dynamic per-user context (second system block — static block stays cacheable)
    profile = getattr(current_user, "profile", None)
    commitment_text = None
    try:
        _, cdata = await _call_api(app, token, "GET", "/api/v1/me/commitment")
        if isinstance(cdata, dict):
            commitment_text = cdata.get("commitment") or cdata.get("text")
    except Exception:
        pass
    dyn_lines = ["USER CONTEXT:"]
    if profile is not None:
        dyn_lines.append(f"- Core industry: {getattr(profile, 'core_industry', None)}")
        dyn_lines.append(f"- Specializations: {getattr(profile, 'specializations', None)}")
        dyn_lines.append(f"- Additional interests: {getattr(profile, 'additional_interest_industries', None)}")
    dyn_lines.append(f"- Commitment from last recap: {commitment_text or 'none yet'}")
    system = [
        {"type": "text", "text": SYSTEM_STATIC, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": "\n".join(dyn_lines)},
    ]

    # Apply the incoming input
    inp = body.input
    if inp.type == "decision" and pending:
        if inp.approved:
            result = await _execute_tool(app, token, pending["name"], pending["input"])
            tool_result_content = f"User APPROVED. Executed: {result}"
        else:
            tool_result_content = "User DECLINED this action. Do not retry it; adjust and continue."
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": pending["tool_use_id"], "content": tool_result_content}
        ]})
        sess.pending_action = None
        pending = None
    elif inp.text:
        # An unresolved pending write + a fresh message: resolve the dangling
        # tool_use first (API requires a result for every tool_use).
        if pending:
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": pending["tool_use_id"],
                 "content": "User did not decide; treat as declined."}
            ]})
            sess.pending_action = None
            pending = None
        messages.append({"role": "user", "content": inp.text})
    else:
        messages.append({"role": "user", "content": "Continue."})

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    session_id = str(sess.id)

    def _stream_model(q):
        """Runs the SDK's sync stream in a worker thread; forwards text deltas
        and the final message through a queue (GUR-229 streaming fix)."""
        try:
            with client.messages.stream(
                model=AGENT_MODEL,
                max_tokens=4096,  # 3000 cut crux descents mid-stream (R24); cap not spend
                system=system,
                tools=TOOLS,
                tool_choice={"type": "auto", "disable_parallel_tool_use": True},
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    q.put(("text", text))
                q.put(("final", stream.get_final_message()))
        except Exception as e:  # surfaced in gen()
            q.put(("error", e))

    async def gen():
        nonlocal messages
        minis_sent = False
        try:
            yield f"data: {json.dumps({'event': 'status', 'text': 'thinking…'})}\n\n"
            for _ in range(MAX_ITERS):
                # Stream the model call: emit each completed block as its JSON
                # closes so content flows instead of bursting at end-of-turn.
                q: "queue.Queue" = queue.Queue()
                threading.Thread(target=_stream_model, args=(q,), daemon=True).start()
                parser = _BlockStreamParser()
                resp = None
                while resp is None:
                    kind, payload = await asyncio.to_thread(q.get)
                    if kind == "text":
                        for block in parser.feed(payload):
                            yield f"data: {json.dumps({'event': 'block', 'block': block})}\n\n"
                    elif kind == "final":
                        resp = payload
                    else:
                        raise payload
                messages.append({"role": "assistant", "content": _serialize_content(resp.content)})

                if resp.stop_reason == "tool_use":
                    tool_use = next(b for b in resp.content if b.type == "tool_use")
                    if tool_use.name in WRITE_TOOLS:
                        approval_id = f"apr_{uuid.uuid4().hex[:10]}"
                        sess.pending_action = json.dumps({
                            "approval_id": approval_id, "tool_use_id": tool_use.id,
                            "name": tool_use.name, "input": tool_use.input,
                        })
                        block = _approval_block(tool_use.name, tool_use.input, approval_id)
                        yield f"data: {json.dumps({'event': 'block', 'block': block})}\n\n"
                        break
                    yield f"data: {json.dumps({'event': 'status', 'text': STATUS_TEXT.get(tool_use.name, 'working…')})}\n\n"
                    result = await _execute_tool(app, token, tool_use.name, tool_use.input or {})
                    # R23 FAST FIRST CONTENT: the catch-up cold open measured 26s
                    # to first content. The instant fix is deterministic — as soon
                    # as the feed tool returns, the SERVER streams a headline strip
                    # of mini cards so the user sees their feed in ~2-4s while the
                    # model composes the in-focus story (prompt forbids the model
                    # from rendering its own mini list).
                    if tool_use.name == "get_catchup_feed" and not minis_sent:
                        minis_sent = True
                        try:
                            sbs = json.loads(result).get("storyboards") or []
                            for sb in sbs[:5]:
                                art = sb.get("in_focus_article") or {}
                                if not art.get("article_id"):
                                    continue
                                mini = {
                                    "type": "article_card", "variant": "mini",
                                    "article_id": art.get("article_id"),
                                    "title": art.get("title"),
                                    "source": art.get("source"),
                                    "url": art.get("url"),
                                    "image_url": art.get("image_url"),
                                    "reading_time": art.get("reading_time"),
                                }
                                yield f"data: {json.dumps({'event': 'block', 'block': mini})}\n\n"
                        except Exception:
                            pass
                    messages.append({"role": "user", "content": [
                        {"type": "tool_result", "tool_use_id": tool_use.id, "content": result}
                    ]})
                    # Fill the inter-iteration gap — the next model call takes
                    # 1.5-3s before its first streamed block (GUR-229).
                    yield f"data: {json.dumps({'event': 'status', 'text': 'composing…'})}\n\n"
                    continue

                # Streaming already emitted parser.emitted blocks; emit only the
                # remainder (covers prose-fallback turns and parser misses).
                final_text = "".join(b.text for b in resp.content if b.type == "text")
                for block in _parse_blocks(final_text)[parser.emitted:]:
                    yield f"data: {json.dumps({'event': 'block', 'block': block})}\n\n"
                break

            # Persist (bounded) history
            sess.messages = json.dumps(messages[-MAX_HISTORY_MSGS:])
            db.commit()
            yield f"data: {json.dumps({'event': 'done', 'session_id': session_id})}\n\n"
        except Exception as e:
            logger.exception("agent turn failed")
            db.rollback()
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)[:300]})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
