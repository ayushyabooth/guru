"""
Turns agent traces into what a person reads.

- diagnose(turn): ranked findings with evidence and a one-sentence hypothesis
- timeline(turn): every phase, model call, tool call and block on one time axis
- summarize(turns): tiles, tools, builds and plain-English takeaways across turns

Rules first: explainable, free and instant, and every number in a sentence
comes from a trace field. An LLM explanation (the admin "Explain" action) is
optional and sits on top of these findings, never instead of them.

The rules and the takeaway ranking follow the independent design review of
the trace (10/7): the H1-H18 rules and the signal table. One engine serves the
admin view, the Claude Code CLI and Report a bug.
"""
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

BUDGET_FIRST_BLOCK_MS = 4000
BUDGET_TOTAL_MS = 20000
BUDGET_ITERATIONS = 5
OUTPUT_TOKEN_CAP = 4096
SMALL_SAMPLE = 20
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
FEED_TOOLS = {"get_catchup_feed", "get_divein_feed", "get_recent_notes", "get_recap_questions"}
CLAUDE_TOOLS = {"ask_guru", "recap_socratic", "get_recap_questions", "submit_recap_answer"}


# ── parsing ──────────────────────────────────────────────────────────────────

def _json(text, default):
    if text in (None, ""):
        return default
    try:
        v = json.loads(text)
        return v if v is not None else default
    except Exception:
        return default


def _aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse(row) -> dict:
    """An AgentTurnTrace row (or anything with the same attributes) as a plain dict."""
    g = lambda k, d=None: getattr(row, k, d)  # noqa: E731
    return {
        "id": str(g("id")) if g("id") else None,
        "created_at": _aware(g("created_at")),
        "session_id": str(g("session_id")) if g("session_id") else None,
        "user_id": str(g("user_id")) if g("user_id") else None,
        "model": g("model"), "input_type": g("input_type"), "input_preview": g("input_preview"),
        "outcome": g("outcome"), "iterations": g("iterations") or 0,
        "first_block_ms": g("first_block_ms"), "total_ms": g("total_ms"),
        "tokens_in": g("tokens_in") or 0, "tokens_out": g("tokens_out") or 0,
        "cache_read_tokens": g("cache_read_tokens") or 0, "cache_write_tokens": g("cache_write_tokens") or 0,
        "model_calls": _json(g("model_calls"), []), "tool_calls": _json(g("tool_calls"), []),
        "blocks": _json(g("blocks"), []), "phases": _json(g("phases"), []),
        "context": _json(g("context"), {}), "approval_tool": g("approval_tool"), "error": g("error"),
        "build_sha": g("build_sha"), "prompt_version": g("prompt_version"),
        "traffic": g("traffic") or "real", "client": g("client"), "decision": g("decision"),
        "ai_hypothesis": _json(g("ai_hypothesis"), None),
    }


def _ctx_tokens(call) -> int:
    """Context size of a model call. Anthropic's input_tokens excludes cached tokens."""
    return (call.get("in") or 0) + (call.get("cache_read") or 0) + (call.get("cache_write") or 0)


def _hit(call):
    ctx = _ctx_tokens(call)
    return round(100 * (call.get("cache_read") or 0) / ctx) if ctx else None


def _s(ms) -> str:
    return "?" if ms is None else (f"{ms / 1000:.1f}s" if ms >= 1000 else f"{ms}ms")


def _tool_failed(t) -> bool:
    return bool(t.get("error")) or t.get("status") in ("raised", "http_error")


# ── per-turn diagnosis ───────────────────────────────────────────────────────

def _f(code, severity, title, detail, impact_ms=0, **evidence):
    return {"code": code, "severity": severity, "title": title, "detail": detail,
            "impact_ms": impact_ms or 0, "evidence": {k: v for k, v in evidence.items() if v is not None}}


def _longest_run(names):
    best, cur, prev = (None, 0), 0, None
    for n in names:
        cur = cur + 1 if n == prev else 1
        prev = n
        if cur > best[1]:
            best = (n, cur)
    return best


def _layout_breaks(blocks):
    types = [b.get("type") for b in blocks]
    cards = [b for b in blocks if b.get("type") == "article_card"]
    heroes = sum(1 for b in cards if b.get("variant") == "hero")
    big = sum(1 for b in cards if b.get("variant") in ("hero", "standard"))
    rules = []
    if heroes > 1:
        rules.append(f"{heroes} hero cards (one per turn)")
    if big >= 3:
        rules.append(f"{big} standard or hero cards stacked (use minis for plurals)")
    if len(blocks) > 7:
        rules.append(f"{len(blocks)} blocks in one turn")
    if blocks and "prompt_pills" not in types and "approval" not in types:
        rules.append("no closing pills")
    if blocks and set(types) <= {"text"}:
        rules.append("text only")
    return rules


def diagnose(t: dict) -> dict:
    calls, tools, blocks, phases = t["model_calls"], t["tool_calls"], t["blocks"], t["phases"]
    outcome, total, first = t["outcome"], t["total_ms"], t["first_block_ms"]
    findings = []

    failing_tool = next((x for x in reversed(tools) if x.get("status") == "raised"), None)
    failing_call = next((c for c in reversed(calls) if c.get("status") == "failed"), None)

    # H1 failed at a step
    if outcome == "error":
        if failing_tool:
            step = f"the {failing_tool['name']} tool"
        elif failing_call:
            step = f"model call {failing_call.get('iter')}"
        else:
            step = "the turn setup"
        findings.append(_f("FAILED", "critical", f"Failed in {step}",
                           f"The turn failed in {step} ({t['error'] or 'no message'}) after {len(blocks)} "
                           f"block{'s' if len(blocks) != 1 else ''} reached the user.",
                           total, error=t["error"], blocks_shown=len(blocks),
                           request_id=(failing_call or {}).get("request_id")))

    # H2 the user left
    if outcome == "abandoned":
        running = next((x for x in tools + calls if x.get("status") == "abandoned"), None)
        where = (f"model call {running.get('iter')}" if running and "name" not in running
                 else f"the {running['name']} tool" if running else "between steps")
        last = blocks[-1] if blocks else None
        seen = (f"The last thing they saw was a {last.get('type')} at {_s(last.get('at_ms'))}"
                if last else "Nothing had reached them yet")
        findings.append(_f("ABANDONED", "high", f"User left after {_s(total)}",
                           f"The user left after {_s(total)}. {seen}, and the agent was in {where}.",
                           total, total_ms=total, blocks_shown=len(blocks), running=where))

    # H3 loop at the cap
    if outcome == "max_iters":
        tool, k = _longest_run([x.get("name") for x in tools])
        findings.append(_f("ITERATION_CAP", "critical", f"Hit the {len(calls)}-call cap",
                           f"The agent made {len(calls)} model calls without answering"
                           + (f", calling {tool} {k} times in a row." if tool and k > 1 else "."),
                           total, model_calls=len(calls), repeated_tool=tool, repeats=k))

    # H4 / H5 cut off or refused
    for c in calls:
        if c.get("stop_reason") == "max_tokens":
            findings.append(_f("CUT_OFF", "high", "Answer cut off at the token cap",
                               f"The answer hit the {OUTPUT_TOKEN_CAP:,}-token cap on model call {c.get('iter')} "
                               f"({c.get('out')} output tokens). {len(blocks)} blocks reached the user and the rest was dropped.",
                               c.get("ms") or 0, call=c.get("iter"), output_tokens=c.get("out")))
        if c.get("stop_reason") == "refusal":
            findings.append(_f("REFUSAL", "high", "The model declined",
                               f"The model declined on call {c.get('iter')}.", 0, call=c.get("iter")))

    # H6 / H7 tool errors
    for x in tools:
        if not _tool_failed(x) or x is failing_tool:
            continue
        if x.get("iter") == 0 and t["decision"] == "approved":
            findings.append(_f("APPROVED_WRITE_FAILED", "high", f"Approved {x['name']} failed",
                               f"The approved {x['name']} failed ({x.get('error_msg') or 'error'}), "
                               f"but the model was told it ran.", x.get("ms") or 0,
                               tool=x["name"], error=x.get("error_msg")))
            continue
        later = [c for c in calls if (c.get("iter") or 0) > (x.get("iter") or 0)]
        then = f"the model kept going for {len(later)} more call{'s' if len(later) != 1 else ''}" if later else "the turn ended"
        findings.append(_f("TOOL_ERROR", "high", f"{x['name']} returned an error",
                           f"{x['name']} returned an error ({x.get('error_msg') or 'error'}), and {then}.",
                           x.get("ms") or 0, tool=x["name"], error=x.get("error_msg"), status=x.get("status")))

    # H8 slow first content, decomposed into its parts
    if first is not None and first > BUDGET_FIRST_BLOCK_MS:
        parts = []
        load = sum(p.get("ms") or 0 for p in phases if (p.get("start_ms") or 0) < first)
        if load >= 100:
            parts.append(f"{_s(load)} loading context")
        for c in calls:
            if (c.get("start_ms") or 0) >= first:
                break
            wait = c.get("first_text_ms") if c.get("first_text_ms") is not None else c.get("ms")
            if wait:
                hit = _hit(c)
                parts.append(f"{_s(wait)} waiting on model call {c.get('iter')} ({_ctx_tokens(c):,} input tokens"
                             + (f", {hit}% from cache)" if hit is not None else ")"))
        for x in tools:
            if (x.get("start_ms") or 0) < first and x.get("ms"):
                parts.append(f"{_s(x['ms'])} in {x['name']}")
        findings.append(_f("SLOW_FIRST_BLOCK", "medium", f"First content took {_s(first)}",
                           f"First content took {_s(first)}" + (": " + ", ".join(parts) + "." if parts else "."),
                           first - BUDGET_FIRST_BLOCK_MS, first_block_ms=first, budget_ms=BUDGET_FIRST_BLOCK_MS))
    if first is None and outcome in ("blocks", "max_iters"):
        findings.append(_f("NO_CONTENT", "high", "Nothing reached the user",
                           "The turn ended without showing the user anything.", total or 0))

    # H9 slow tail
    if total is not None and total > BUDGET_TOTAL_MS:
        comp = defaultdict(int)
        for c in calls:
            comp["model calls"] += c.get("ms") or 0
        for x in tools:
            comp[x.get("name") or "tools"] += x.get("ms") or 0
        for p in phases:
            comp[p.get("name") or "setup"] += p.get("ms") or 0
        name, ms = max(comp.items(), key=lambda kv: kv[1]) if comp else ("unknown", 0)
        findings.append(_f("SLOW_TOTAL", "medium", f"{_s(total)} in total",
                           f"{_s(total)} in total. {name.capitalize()} took {round(100 * ms / total)}%.",
                           total - BUDGET_TOTAL_MS, total_ms=total, budget_ms=BUDGET_TOTAL_MS, biggest=name))

    # H10 cache miss on a warm call: the previous call's context should come back from
    # the cache. New content (a fresh tool result) is never cached, so judge reuse of
    # the prefix, not the share of all tokens.
    for prev, c in zip(calls, calls[1:]):
        prefix, read = _ctx_tokens(prev), c.get("cache_read") or 0
        if prefix >= 1024 and c.get("status", "ok") == "ok" and read < 0.8 * prefix:
            findings.append(_f("CACHE_MISS", "medium", f"Cache miss on model call {c.get('iter')}",
                               f"Model call {c.get('iter')} re-read only {read:,} of the {prefix:,} tokens "
                               f"model call {prev.get('iter')} had already sent, so it paid full price for the rest.",
                               0, call=c.get("iter"), prefix_tokens=prefix, cache_read=read))

    # H11 thinking-heavy call
    visible = sum(b.get("chars") or 0 for b in blocks)
    for c in calls:
        ftm, out = c.get("first_text_ms"), c.get("out") or 0
        if ftm and ftm > 3000 and out > 400 and out * 4 > 2 * max(visible, 1):
            findings.append(_f("THINKING_HEAVY", "low", f"Long silent stretch on call {c.get('iter')}",
                               f"Model call {c.get('iter')} spent {_s(ftm)} before any visible text and wrote "
                               f"{out:,} output tokens, most likely thinking.", ftm, call=c.get("iter")))

    # H12 heavy turn
    if len(calls) > BUDGET_ITERATIONS and outcome != "max_iters":
        seq = " > ".join(x.get("name") for x in tools) or "no tools"
        findings.append(_f("HEAVY_TURN", "medium", f"{len(calls)} model calls",
                           f"{len(calls)} model calls this turn: {seq}.", 0, model_calls=len(calls)))

    # H13 nearly empty feed
    for x in tools:
        if x.get("name") in FEED_TOOLS and x.get("chars") is not None and x["chars"] < 40 and not _tool_failed(x):
            findings.append(_f("EMPTY_RESULT", "low", f"{x['name']} came back nearly empty",
                               f"{x['name']} came back nearly empty ({x['chars']} chars), so the answer had little to work with.",
                               0, tool=x["name"], chars=x["chars"]))

    # H14 layout rules
    if outcome == "blocks":
        last_iter = max((b.get("iter") or 0) for b in blocks) if blocks else 0
        broken = _layout_breaks([b for b in blocks if (b.get("iter") or 0) == last_iter])
        if broken:
            findings.append(_f("LAYOUT", "low", "Broke a layout rule",
                               f"The turn broke a layout rule: {'; '.join(broken)}.", 0, rules=broken))

    # H16 stale or mismatched approval
    if t["decision"] == "stale" or t["context"].get("approval_matched") is False:
        findings.append(_f("STALE_APPROVAL", "medium", "Tapped an old approval card",
                           "The user tapped an approval card that no longer matched a pending action, "
                           "so the journey moved on without it.", 0, approval_id=t["context"].get("approval_id")))

    # H17 slow tool that makes its own Claude call
    for x in tools:
        if x.get("name") in CLAUDE_TOOLS and (x.get("ms") or 0) > 5000:
            findings.append(_f("SLOW_CLAUDE_TOOL", "low", f"{x['name']} took {_s(x['ms'])}",
                               f"{x['name']} took {_s(x['ms'])}. It makes its own Claude call, which this trace can't see inside.",
                               x["ms"], tool=x["name"]))

    # H18 slow context load
    for p in phases:
        if p.get("name") == "load_context" and (p.get("ms") or 0) > 500:
            findings.append(_f("SLOW_CONTEXT", "low", f"Loading context took {_s(p['ms'])}",
                               f"Loading the user's context took {_s(p['ms'])} before the model started.", p["ms"]))

    # Informational: approval pauses and decisions
    if outcome == "approval":
        findings.append(_f("APPROVAL_PAUSE", "info", f"Paused for approval of {t['approval_tool']}",
                           f"Paused for the user to approve {t['approval_tool']}.", 0))
    if t["decision"] == "ignored":
        findings.append(_f("APPROVAL_IGNORED", "info", "Typed past an approval card",
                           "The user typed a new message instead of answering the approval card, so the write was dropped.", 0))

    findings.sort(key=lambda f: (SEVERITY_RANK[f["severity"]], -(f["impact_ms"] or 0)))
    top = findings[0] if findings else None
    if top and SEVERITY_RANK[top["severity"]] <= SEVERITY_RANK["medium"]:
        headline = top["detail"]
        if top["code"] == "SLOW_FIRST_BLOCK":
            miss = next((f for f in findings if f["code"] == "CACHE_MISS"), None)
            if miss:
                headline = headline.rstrip(".") + f", with a cache miss on model call {miss['evidence'].get('call')}."
    else:
        headline = (f"Healthy: first content in {_s(first)}, {_s(total)} in total, "
                    f"{len(calls)} model call{'s' if len(calls) != 1 else ''}.")
        if top and top["severity"] == "info":
            headline = top["detail"] + f" First content in {_s(first)}."
    sev = "ok"
    if top and SEVERITY_RANK[top["severity"]] <= SEVERITY_RANK["high"]:
        sev = "bad"
    elif top and top["severity"] == "medium":
        sev = "warn"
    for f in findings:
        f.pop("impact_ms", None)
    return {"severity": sev, "headline": headline, "findings": findings}


# ── timeline ─────────────────────────────────────────────────────────────────

def timeline(t: dict) -> list:
    items = []
    for p in t["phases"]:
        s = p.get("start_ms") or 0
        items.append({"kind": "phase", "label": p.get("name"), "start_ms": s, "end_ms": s + (p.get("ms") or 0),
                      "status": "ok", "detail": f"{_s(p.get('ms'))}"})
    for c in t["model_calls"]:
        s = c.get("start_ms")
        if s is None:
            continue
        hit = _hit(c)
        items.append({"kind": "model", "label": f"model call {c.get('iter')}", "start_ms": s,
                      "end_ms": s + (c.get("ms") or 0), "status": c.get("status") or "ok",
                      "detail": f"{c.get('stop_reason') or c.get('status')}, {_ctx_tokens(c):,} in"
                                + (f" ({hit}% cached)" if hit is not None else "") + f", {c.get('out') or 0} out"
                                + (f", first text {_s(c['first_text_ms'])}" if c.get("first_text_ms") is not None else "")})
    for x in t["tool_calls"]:
        s = x.get("start_ms")
        if s is None:
            continue
        status = "error" if _tool_failed(x) else (x.get("status") or "ok")
        items.append({"kind": "tool", "label": x.get("name"), "start_ms": s, "end_ms": s + (x.get("ms") or 0),
                      "status": status, "detail": x.get("error_msg") or f"{x.get('chars') or 0} chars"})
    for b in t["blocks"]:
        at = b.get("at_ms") or 0
        kind = "approval" if b.get("type") == "approval" else "block"
        label = b.get("type") + (f":{b['variant']}" if b.get("variant") else "")
        items.append({"kind": kind, "label": label, "start_ms": at, "end_ms": at, "status": "ok",
                      "detail": b.get("preview") or f"{b.get('chars') or 0} chars"})
    items.sort(key=lambda i: (i["start_ms"], i["end_ms"]))
    return items


# ── across turns ─────────────────────────────────────────────────────────────

def pct(values, p):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, int(round(p / 100 * (len(vals) - 1)))))
    return vals[k]


def cache_share(turns) -> float:
    read = sum(t["cache_read_tokens"] for t in turns)
    total = sum(t["tokens_in"] + t["cache_read_tokens"] + t["cache_write_tokens"] for t in turns)
    return round(read / total, 2) if total else None


def _iso(dt):
    return dt.isoformat() if dt else None


def turn_row(t: dict, diag: dict, email: str = None) -> dict:
    return {
        "id": t["id"], "created_at": _iso(t["created_at"]), "user_id": t["user_id"], "user_email": email,
        "session_id": t["session_id"], "input_type": t["input_type"], "input_preview": t["input_preview"],
        "outcome": t["outcome"], "first_block_ms": t["first_block_ms"], "total_ms": t["total_ms"],
        "iterations": t["iterations"], "tools": [x.get("name") for x in t["tool_calls"]],
        "severity": diag["severity"], "headline": diag["headline"], "traffic": t["traffic"],
        "build_sha": t["build_sha"],
    }


def _takeaways(turns, diags):
    n = len(turns)
    out = []  # (score, severity, text, ids)

    def add(weight, n_affected, severity, text, ids):
        out.append((weight * max(n_affected, 1), severity, text, [i for i in ids if i][:20]))

    # Broken tool
    by_tool = defaultdict(list)
    for t in turns:
        for x in t["tool_calls"]:
            by_tool[x.get("name")].append((t, x))
    for name, pairs in by_tool.items():
        bad = [t for t, x in pairs if _tool_failed(x)]
        if len(pairs) >= 3 and len(bad) / len(pairs) >= 0.2:
            msgs = Counter(" ".join((x.get("error_msg") or "error").split(" ")[:2]).rstrip(":") for t, x in pairs if _tool_failed(x))
            add(100, len(bad), "bad", f"{name} failed on {len(bad)} of {len(pairs)} calls "
                f"({round(100 * len(bad) / len(pairs))}%), most often {msgs.most_common(1)[0][0]}.",
                [t["id"] for t in bad])
    # Failed or abandoned turns
    for outcome, label, sev in (("error", "ended in an error", "bad"), ("max_iters", "hit the model-call cap", "bad"),
                                ("abandoned", "were abandoned before the answer finished", "warn")):
        hit = [t for t in turns if t["outcome"] == outcome]
        if hit and len(hit) / n >= 0.02:
            extra = ""
            if outcome == "abandoned":
                extra = f" Users waited a median of {_s(pct([t['total_ms'] for t in hit], 50))} before leaving."
            elif outcome == "error":
                types = Counter((t["error"] or "unknown").split(":")[0] for t in hit)
                extra = " Top error: " + types.most_common(1)[0][0] + "."
            add(100 if sev == "bad" else 30, len(hit), sev,
                f"{len(hit)} of {n} turns ({round(100 * len(hit) / n)}%) {label}.{extra}", [t["id"] for t in hit])
    # Budget breach on first content
    firsts = [t for t in turns if t["first_block_ms"] is not None]
    over = [t for t in firsts if t["first_block_ms"] > BUDGET_FIRST_BLOCK_MS]
    if firsts:
        p95 = pct([t["first_block_ms"] for t in firsts], 95)
        if over and (len(over) / len(firsts) >= 0.10 or (p95 or 0) > BUDGET_FIRST_BLOCK_MS):
            slow_tools = Counter(x.get("name") for t in over for x in t["tool_calls"]
                                 if (x.get("start_ms") or 0) < (t["first_block_ms"] or 0))
            cause = f" Most of them waited on {slow_tools.most_common(1)[0][0]}." if slow_tools else ""
            add(30, len(over), "warn", f"{len(over)} of {len(firsts)} turns ({round(100 * len(over) / len(firsts))}%) "
                f"took longer than {_s(BUDGET_FIRST_BLOCK_MS)} to show first content (p95 {_s(p95)}).{cause}",
                [t["id"] for t in over])
        elif len(firsts) >= 5:
            within = len(firsts) - len(over)
            add(1, 1, "good", f"{within} of {len(firsts)} turns showed content within {_s(BUDGET_FIRST_BLOCK_MS)} "
                f"(p50 {_s(pct([t['first_block_ms'] for t in firsts], 50))}).", [])
    # Cut-off answers
    cut = [t for t, d in zip(turns, diags) if any(f["code"] == "CUT_OFF" for f in d["findings"])]
    if cut:
        add(30, len(cut), "bad", f"{len(cut)} answer{'s were' if len(cut) > 1 else ' was'} cut off at the "
            f"{OUTPUT_TOKEN_CAP:,}-token cap.", [t["id"] for t in cut])
    # Cache health
    share = cache_share(turns)
    if share is not None and n >= 5:
        add(10 if share < 0.5 else 1, 1, "warn" if share < 0.5 else "info",
            f"Prompt cache covers {round(100 * share)}% of input tokens.", [])
    # Heavy turns
    heavy = [t for t in turns if len(t["model_calls"]) > BUDGET_ITERATIONS]
    if heavy and len(heavy) / n > 0.05:
        add(3, len(heavy), "warn", f"{len(heavy)} turns needed more than {BUDGET_ITERATIONS} model calls.",
            [t["id"] for t in heavy])
    # Approval funnel
    shown = sum(1 for t in turns if t["outcome"] == "approval")
    dec = Counter(t["decision"] for t in turns if t["decision"])
    if shown:
        add(3, shown, "info", f"Approval cards: {shown} shown, {dec.get('approved', 0)} approved, "
            f"{dec.get('declined', 0)} declined, {dec.get('ignored', 0)} typed past"
            + (f", {dec['stale']} stale." if dec.get("stale") else "."), [])
    # Layout rules
    lay = [t for t, d in zip(turns, diags) if any(f["code"] == "LAYOUT" for f in d["findings"])]
    if lay and len(lay) / n >= 0.10:
        add(10, len(lay), "warn", f"{len(lay)} of {n} turns broke a layout rule.", [t["id"] for t in lay])
    # Version delta: the newest build against the one before it
    builds = defaultdict(list)
    for t in turns:
        builds[t["build_sha"] or "unknown"].append(t)
    if len(builds) >= 2:
        order = sorted(builds.items(), key=lambda kv: min(x["created_at"] or datetime.min.replace(tzinfo=timezone.utc) for x in kv[1]))
        (old_b, old), (new_b, new) = order[-2], order[-1]
        if len(old) >= 10 and len(new) >= 10:  # one blip in a handful of turns is not a regression
            o, w = pct([t["first_block_ms"] for t in old], 50), pct([t["first_block_ms"] for t in new], 50)
            if o and w and w > o * 1.2:
                add(60, len(new), "warn", f"Build {new_b} is slower to first content than {old_b} "
                    f"(p50 {_s(w)} vs {_s(o)}).", [t["id"] for t in new])
            oe = sum(t["outcome"] == "error" for t in old) / len(old)
            ne = sum(t["outcome"] == "error" for t in new) / len(new)
            if sum(t["outcome"] == "error" for t in new) >= 2 and ne > oe + 0.05:
                add(200, len(new), "bad", f"Errors rose with build {new_b}: {round(100 * ne)}% of turns vs "
                    f"{round(100 * oe)}% on {old_b}.", [t["id"] for t in new])

    out.sort(key=lambda o: -o[0])
    take = [{"severity": s, "text": txt, "turn_ids": ids} for _, s, txt, ids in out[:5]]
    if not any(t["severity"] in ("bad", "warn") for t in take):
        take.insert(0, {"severity": "good", "text": f"No problems across {n} turns: no errors, no abandoned turns, "
                                                    f"no budget breaches.", "turn_ids": []})
    if n < SMALL_SAMPLE:
        take.append({"severity": "info", "text": f"Only {n} turns in this window, so read the percentiles loosely.",
                     "turn_ids": []})
    return take[:6]


def summarize(turns: list, *, days: int = None, traffic: str = None, since=None) -> dict:
    """turns: parsed dicts (see parse()). Returns the summary contract the admin view reads."""
    n = len(turns)
    diags = [diagnose(t) for t in turns]
    firsts = [t["first_block_ms"] for t in turns]
    totals = [t["total_ms"] for t in turns]
    iters = [len(t["model_calls"]) for t in turns]
    dec = Counter(t["decision"] for t in turns if t["decision"])
    tool_stats = defaultdict(list)
    tool_err = Counter()
    for t in turns:
        for x in t["tool_calls"]:
            tool_stats[x.get("name")].append(x.get("ms"))
            tool_err[x.get("name")] += 1 if _tool_failed(x) else 0
    builds = defaultdict(list)
    for t in turns:
        builds[(t["build_sha"], t["prompt_version"])].append(t)
    tiles = {
        "turns": n,
        "users": len({t["user_id"] for t in turns}),
        "sessions": len({t["session_id"] for t in turns}),
        "first_block_ms": {"p50": pct(firsts, 50), "p95": pct(firsts, 95), "budget": BUDGET_FIRST_BLOCK_MS,
                           "over": sum(1 for v in firsts if v is not None and v > BUDGET_FIRST_BLOCK_MS)},
        "total_ms": {"p50": pct(totals, 50), "p95": pct(totals, 95), "budget": BUDGET_TOTAL_MS,
                     "over": sum(1 for v in totals if v is not None and v > BUDGET_TOTAL_MS)},
        "iterations": {"p50": pct(iters, 50), "max": max(iters) if iters else None, "budget": BUDGET_ITERATIONS},
        "outcomes": dict(Counter(t["outcome"] for t in turns)),
        "cache_share": cache_share(turns),
        "tokens_per_turn": {
            "input_total": round(sum(t["tokens_in"] + t["cache_read_tokens"] + t["cache_write_tokens"] for t in turns) / n) if n else None,
            "output": round(sum(t["tokens_out"] for t in turns) / n) if n else None,
        },
        "approvals": {"shown": sum(1 for t in turns if t["outcome"] == "approval"),
                      "approved": dec.get("approved", 0), "declined": dec.get("declined", 0),
                      "ignored": dec.get("ignored", 0), "stale": dec.get("stale", 0)},
    }
    tools = [{"name": name, "calls": len(v), "p50_ms": pct(v, 50), "p95_ms": pct(v, 95), "errors": tool_err[name]}
             for name, v in sorted(tool_stats.items(), key=lambda kv: -len(kv[1]))]
    build_rows = []
    for (sha, pv), ts in builds.items():
        build_rows.append({"build_sha": sha, "prompt_version": pv, "turns": len(ts),
                           "first_block_p50": pct([t["first_block_ms"] for t in ts], 50),
                           "error_rate": round(sum(t["outcome"] == "error" for t in ts) / len(ts), 2),
                           "first_seen": _iso(min((t["created_at"] for t in ts if t["created_at"]), default=None))})
    build_rows.sort(key=lambda b: b["first_seen"] or "", reverse=True)
    flagged = sorted([(t, d) for t, d in zip(turns, diags) if d["severity"] in ("bad", "warn")],
                     key=lambda td: (0 if td[1]["severity"] == "bad" else 1,
                                     -(td[0]["created_at"].timestamp() if td[0]["created_at"] else 0)))
    return {
        "window": {"days": days, "traffic": traffic, "since": _iso(since), "turns": n},
        "takeaways": _takeaways(turns, diags) if n else [],
        "tiles": tiles,
        "tools": tools,
        "builds": build_rows,
        "flagged": [(t, d) for t, d in flagged[:20]],  # the route turns these into rows with emails
    }
