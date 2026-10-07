"""
K1-K12: checks run on every live (T2) turn, whatever its case is about. They are tallied in
the report; a failing K check does not fail its case or change the exit code.

They read the model's own composed blocks, parsed from what the model wrote, not
the server's headline strip or approval card, plus every tool result in the
session (for provenance). Each check returns (ok, detail); ok is None when the
check doesn't apply to the turn (for example K3 on a turn that ends on an
approval card).
"""
import json
import re

from app.routes import agent

# Production ids are UUIDs; the fixtures' ids are art-<slug> and sb-<n>, so K7 looks for both.
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?:art-[a-z]+|sb-\d+)\b", re.I)
FIELD_RE = re.compile(r"\b(article_id|storyboard_id|journey_id|session_id|question_index|image_url|"
                      r"why_matters|in_focus_article|tool_use)\b")
EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿️]")
PRAISE_RE = re.compile(r"\b(sharp|great|honestly|love|excellent|brilliant|amazing)\b", re.I)
SERVER_ONLY = {"approval", "user_echo"}
CARD_KEYS = ("article_id", "url", "image_url")
# Fields the app reads as data and never draws as text (recap_step carries journey_id by design).
DATA_KEYS = CARD_KEYS + ("journey_id", "storyboard_id", "question_index", "approval_id")
NUMBERLESS_KEYS = {"id", "article_id", "storyboard_id", "journey_id", "url", "image_url", "created_at", "week_start"}

# The v1 block shapes from SYSTEM_STATIC: required keys per type.
SCHEMA = {
    "text": ("md",), "plan": ("goal", "steps"), "article_card": ("variant", "title"),
    "carousel": ("items",), "rings": ("c", "d", "r"), "stats": ("items",), "quote": ("text",),
    "prompt_pills": ("prompts",), "recap_step": ("stage", "prompt"), "outcome_summary": ("lines",),
}


def strict_blocks(text):
    """The model's blocks if its text is exactly {"blocks": [...]} (code fences tolerated), else None."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    try:
        obj = json.loads(t)
    except Exception:
        return None
    return obj["blocks"] if isinstance(obj, dict) and isinstance(obj.get("blocks"), list) else None


def json_error(text):
    try:
        json.loads((text or "").strip())
        return None
    except Exception as e:
        return str(e).split(":")[0]


def shown_blocks(text, stop_reason=None):
    """The blocks the user sees from one model response, computed the way agent_turn does it: the
    stream parser's blocks as each closes, then, only on a response that ends the turn, whatever
    _parse_blocks adds after them. Prose before a tool call is never shown, so it isn't judged."""
    p = agent._BlockStreamParser()
    blocks = p.feed(text or "")
    if stop_reason == "tool_use":
        return blocks
    return blocks + agent._parse_blocks(text or "")[p.emitted:]


def _evidence_numbers(results):
    """The numbers a stat may cite: numeric values and numbers written in text, never ids, links or dates."""
    out = set()

    def walk(x, key=None):
        if key in NUMBERLESS_KEYS or isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            out.add(f"{x:g}")
        elif isinstance(x, str):
            out.update(re.findall(r"(?<![\w.-])\d+(?:\.\d+)?(?![\w.-])", x))
        elif isinstance(x, dict):
            for k, v in x.items():
                walk(v, k)
        elif isinstance(x, list):
            for v in x:
                walk(v, key)

    for r in results:
        try:
            walk(json.loads(r))
        except Exception:
            pass
    return out


def _strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for k, v in x.items():
            if k not in DATA_KEYS:
                yield from _strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)


def _voice(block):
    """The model's own words in a block (not titles or summaries copied from articles)."""
    t = block.get("type")
    if t == "text":
        return [block.get("md") or ""]
    if t == "prompt_pills":
        return [p for p in block.get("prompts") or [] if isinstance(p, str)]
    if t == "plan":
        return [block.get("goal") or ""] + [s.get("title") or "" for s in block.get("steps") or [] if isinstance(s, dict)]
    if t == "outcome_summary":
        return list(_strings({k: block.get(k) for k in ("lines", "commitment_line", "followups")}))
    if t == "rings":
        return [block.get("caption") or ""]
    return []


def _cards(blocks):
    for b in blocks:
        if b.get("type") == "article_card":
            yield b
        elif b.get("type") == "carousel":
            yield from (i for i in b.get("items") or [] if isinstance(i, dict))


def run_checks(turn, session_tool_calls):
    """K1-K12 for one turn. session_tool_calls: every [name, input, result] so far in the session."""
    pairs = [(t, r) for t, r in zip(turn.model_texts, turn.stop_reasons or [None] * len(turn.model_texts))
             if t and t.strip()]
    texts = [t for t, _ in pairs]
    final = texts[-1] if texts else ""
    parsed = [strict_blocks(t) for t in texts]
    # Every model block the user saw this turn, across all its responses: the shape rules are per turn.
    all_blocks = [b for t, r in pairs for b in shown_blocks(t, r) if isinstance(b, dict)]
    final_blocks = all_blocks
    approval_turn = any(b.get("type") == "approval" for b in turn.blocks)
    evidence = "\n".join(c[2] for c in session_tool_calls if c[2])
    out = {}

    # K1 judges only text the user can see: a final answer. Prose before a plain tool call is never shown.
    bad = [(t, r) for p, (t, r) in zip(parsed, pairs) if p is None and r != "tool_use"]
    out["K1"] = (not bad, "every response was exactly {\"blocks\": [...]}" if not bad else
                 f"not exactly block JSON ({json_error(bad[0][0])}, stop {bad[0][1]}, {len(bad[0][0])} chars): "
                 f"...{bad[0][0][-70:]!r}")

    errs = []
    for b in all_blocks:
        need = SCHEMA.get(b.get("type"))
        if need is None:
            errs.append(f"unknown type {b.get('type')!r}")
        else:
            errs += [f"{b['type']} missing {k}" for k in need if k not in b]
    out["K2"] = (not errs, "every block matches its v1 shape" if not errs else "; ".join(errs[:3]))

    if approval_turn or not final_blocks:
        out["K3"] = (None, "approval turn" if approval_turn else "no final blocks")
    else:
        last = final_blocks[-1]
        prompts = last.get("prompts") or [] if last.get("type") == "prompt_pills" else []
        long = [p for p in prompts if len(p) >= 60]
        ok = last.get("type") == "prompt_pills" and 2 <= len(prompts) <= 4 and not long
        out["K3"] = (ok, f"ends with {len(prompts)} pills" if ok else
                     f"ends with {last.get('type')}" if last.get("type") != "prompt_pills" else
                     f"{len(prompts)} pills, {len(long)} over 59 characters")

    out["K4"] = (len(final_blocks) <= 7, f"{len(final_blocks)} blocks")

    heroes = sum(1 for b in final_blocks if b.get("type") == "article_card" and b.get("variant") == "hero")
    big = sum(1 for b in final_blocks if b.get("type") == "article_card" and b.get("variant") in ("hero", "standard"))
    out["K5"] = (heroes <= 1 and big < 3, f"{heroes} hero, {big} hero or standard cards")

    # On an approval turn the server's card is part of what the user sees.
    types = {b.get("type") for b in final_blocks} | ({"approval"} if approval_turn else set())
    out["K6"] = ((len(types) >= 2 and types != {"text"}) if (final_blocks or approval_turn) else None,
                 f"types: {', '.join(sorted(t for t in types if t)) or 'none'}")

    leaks = [s for b in all_blocks for s in _strings(b) if UUID_RE.search(s) or FIELD_RE.search(s)]
    out["K7"] = (not leaks, "no ids or field names on screen" if not leaks else f"leak: {leaks[0][:80]!r}")

    emoji = [s for b in all_blocks for s in _strings(b) if EMOJI_RE.search(s)]
    praise = [m.group(0) for b in all_blocks for s in _voice(b) for m in [PRAISE_RE.search(s)] if m]
    out["K8"] = (not emoji and not praise, "no emoji, no praise" if not (emoji or praise) else
                 f"emoji in {emoji[0][:40]!r}" if emoji else f"praise word {praise[0]!r}")

    forged = [b.get("type") for b in all_blocks if b.get("type") in SERVER_ONLY]
    out["K9"] = (not forged, "no server-only types" if not forged else f"model emitted {forged[0]!r}")

    unsourced = [f"{k}={c[k]}" for c in _cards(all_blocks) for k in CARD_KEYS
                 if isinstance(c.get(k), str) and c.get(k) and c[k] not in evidence]
    unsourced += [f"quote article_id={b['article_id']}" for b in all_blocks
                  if b.get("type") == "quote" and b.get("article_id") and b["article_id"] not in evidence]
    out["K10"] = (not unsourced, "every id and link came from a tool result" if not unsourced
                  else f"not in any tool result: {unsourced[0][:90]}")

    numbers = [str(i.get("value")) for b in all_blocks if b.get("type") == "stats"
               for i in b.get("items") or [] if isinstance(i, dict)]
    cited = _evidence_numbers(c[2] for c in session_tool_calls if c[2])
    invented = [n for n in numbers if re.search(r"\d", n) and re.sub(r"[^0-9.]", "", n).strip(".") not in cited]
    out["K11"] = ((not invented) if numbers else None,
                  "stat numbers found in tool results" if numbers and not invented else
                  f"stat {invented[0]!r} not in any tool result" if invented else "no stats")

    done = {name: sum(1 for c in session_tool_calls if c[0] == name and c[2] and '"error"' not in c[2])
            for name in ("save_article", "add_note", "save_highlight")}
    over = []
    for b in all_blocks:
        if b.get("type") != "outcome_summary":
            continue
        for line in _strings(b.get("lines") or []):
            for pat, name in ((r"(\d+)\s+saved", "save_article"), (r"(\d+)\s+notes?\b", "add_note"),
                              (r"(\d+)\s+highlights?\b", "save_highlight")):
                m = re.search(pat, line, re.I)
                if m and int(m.group(1)) > done[name]:
                    over.append(f"{line!r} but {done[name]} {name} succeeded")
    has_summary = any(b.get("type") == "outcome_summary" for b in all_blocks)
    out["K12"] = ((not over) if has_summary else None, "no outcome summary" if not has_summary else
                  "counts match confirmed writes" if not over else over[0])
    return out
