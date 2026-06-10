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

WRITE_TOOLS = {"save_article", "mark_not_relevant"}

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
        "description": "Save an article to the user's dive-in queue. WRITE: requires user approval (handled automatically — just call it when saving is the right action).",
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
        "name": "mark_not_relevant",
        "description": "Mark a storyboard as not relevant, removing it from the user's feed. WRITE: requires user approval.",
        "input_schema": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string"},
                "title": {"type": "string", "description": "Storyboard headline, shown on the approval card"},
            },
            "required": ["storyboard_id", "title"],
        },
    },
]

STATUS_TEXT = {
    "get_catchup_feed": "reading your catch-up feed…",
    "get_divein_feed": "reading your saved queue…",
    "get_metrics": "checking your rings…",
    "get_commitment": "recalling your commitment…",
    "ask_guru": "thinking it through…",
}

# ── System prompt (static → cached; dynamic context appended per session) ────

SYSTEM_STATIC = """You are Guru's agent — the engine behind the app's agentic tab. You turn a user's reading goal into a short, visible journey and execute it step by step using tools. Audience: a busy professional doing focused learning.

PROTOCOL (Journey Pipeline):
1. When given a NEW GOAL: gather what you need with read tools (feed, metrics, commitment), then respond with a `plan` block (3-5 steps, realistic minute estimates) plus one short `text` block. Do NOT execute steps yet — the user approves/starts the plan first.
2. When the user says to start/continue/next: execute the CURRENT step only, then present its result as blocks (e.g. one `article_card` for review, or `rings`/`stats` for progress) and an updated `plan` block with statuses. One step per turn keeps the user in control.
3. Saves and removals go through save_article / mark_not_relevant — the system automatically asks the user to approve; never claim a write happened until you see its tool result.
4. When all steps are done: respond with an `outcome_summary` block tallying what actually happened (only count writes confirmed by tool results) + `prompt_pills` with 2-3 next-step suggestions.
5. Free-form questions at any time: answer them inline (use ask_guru when about a specific article), then offer to resume the journey.

COMMITMENT WEAVING: if the user has a commitment, bias article choices toward it and set commitment_flag=true on qualifying article cards. Mention it naturally, don't preach.

OUTPUT FORMAT (STRICT): your final text in every turn must be ONLY a JSON object:
{"blocks": [ ... ]}
No prose outside the JSON. Block types (v1):
- {"type":"text","md":"markdown string — keep it short and warm"}
- {"type":"plan","goal":"...","eta_min":12,"steps":[{"n":1,"title":"...","eta":"6 min","status":"pending|active|done|skipped"}]}
- {"type":"article_card","article_id":"...","title":"...","source":"...","reading_time":3,"summary":"1-2 sentences","commitment_flag":false,"actions":["save","skip","ask","open"]}
- {"type":"carousel","items":[<article_card>, ...]}  (max 3 items)
- {"type":"rings","c":0.8,"d":0.4,"r":0.0,"caption":"..."}
- {"type":"stats","items":[{"label":"read","value":"4"}]}
- {"type":"quote","text":"...","article_id":"..."}
- {"type":"prompt_pills","prompts":["...","..."]}
- {"type":"outcome_summary","lines":["+14m Catch-up","2 saved"],"commitment_line":"1 article advanced it" ,"rings":{"c":0.86,"d":0.4,"r":0},"followups":["Start my weekly recap"]}
Keep every turn under ~6 blocks. Be concrete and brief; the cards carry the content, the text block carries the voice (sharp, encouraging mentor — never corporate)."""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _slim_article(a: dict) -> dict:
    return {
        "article_id": a.get("id") or a.get("article_id"),
        "title": a.get("title"),
        "source": a.get("source"),
        "reading_time": a.get("reading_time"),
        "summary": (a.get("summary") or a.get("expert_takeaway") or "")[:220],
        "industry": a.get("industry") or a.get("context"),
        "is_saved": a.get("is_saved", False),
    }


def _slim_storyboard(s: dict) -> dict:
    rich = s.get("rich_summary") or {}
    return {
        "storyboard_id": s.get("id") or s.get("storyboard_id"),
        "headline": s.get("headline") or s.get("title"),
        "industry": s.get("industry"),
        "in_focus_article": _slim_article(s.get("in_focus_article") or s.get("article") or {}),
        "whats_in": (rich.get("whats_in_article") or s.get("summary_whats_in") or "")[:260],
        "why_matters": (rich.get("why_it_matters") or "")[:200],
        "spotlight_quotes": (rich.get("spotlight_quotes") or [])[:2],
        "more_articles": [_slim_article(a) for a in (s.get("carousel_articles") or s.get("articles") or [])[:4]],
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
            return json.dumps({
                "saved": [_slim_article(a) for a in (data.get("saved_articles") or [])[:8]],
                "expert_picks": [_slim_article(a) for a in (data.get("essential_articles") or [])[:5]],
                "discovery": [_slim_article(a) for a in (data.get("discovery_articles") or [])[:5]],
            })
        if name == "get_metrics":
            today = data.get("today") or {}
            return json.dumps({
                "today": today,
                "streak": data.get("current_streak"),
                "articles_read": data.get("articles_read"),
                "articles_saved": data.get("articles_saved"),
                "top_topics": data.get("top_topics"),
                "recap_status": data.get("recap_journey_status"),
            })
        if name == "ask_guru":
            return json.dumps({
                "answer": (data.get("response") or "")[:900],
                "follow_ups": data.get("follow_up_prompts", [])[:3],
            })
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
    elif name == "get_commitment":
        status, data = await _call_api(app, token, "GET", "/api/v1/me/commitment")
    elif name == "ask_guru":
        status, data = await _call_api(app, token, "POST", "/api/v1/socratic/chat",
                                       json_body={"article_id": tool_input["article_id"], "question": tool_input["question"]})
    elif name == "save_article":
        status, data = await _call_api(app, token, "POST", f"/api/v1/articles/{tool_input['article_id']}/save")
    elif name == "mark_not_relevant":
        status, data = await _call_api(app, token, "POST", f"/api/v1/storyboards/{tool_input['storyboard_id']}/not-relevant")
    else:
        return json.dumps({"error": f"unknown tool {name}"})
    return _slim_tool_result(name, status, data)


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
        title, detail = "Save this article?", [tool_input.get("title", "")]
        confirm = "Save"
    else:
        title, detail = "Remove from your feed?", [tool_input.get("title", "")]
        confirm = "Remove"
    return {
        "type": "approval", "approval_id": approval_id, "title": title,
        "detail_lines": [d for d in detail if d], "confirm_label": confirm, "cancel_label": "Keep as is",
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

    async def gen():
        nonlocal messages
        try:
            yield f"data: {json.dumps({'event': 'status', 'text': 'thinking…'})}\n\n"
            for _ in range(MAX_ITERS):
                resp = await asyncio.to_thread(
                    client.messages.create,
                    model=AGENT_MODEL,
                    max_tokens=3000,
                    system=system,
                    tools=TOOLS,
                    tool_choice={"type": "auto", "disable_parallel_tool_use": True},
                    messages=messages,
                )
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
                    messages.append({"role": "user", "content": [
                        {"type": "tool_result", "tool_use_id": tool_use.id, "content": result}
                    ]})
                    continue

                final_text = "".join(b.text for b in resp.content if b.type == "text")
                for block in _parse_blocks(final_text):
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
