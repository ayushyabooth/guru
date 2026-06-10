# Agentic Guru Tab — Technical Architecture (Epic H, GUR-228)

Approved direction: **Journey Pipeline** (Figma frames H1–H5 + "Living Blob — states spec",
file `CVsVL7zvjyO3yoLlUJqBxI`). This doc is the implementation contract between the agent
backend and the generative frontend.

## 1. Principles

1. **Orchestrate, don't duplicate.** The agent's tools are thin wrappers over the existing
   REST endpoints. All business logic (feeds, clustering, metrics, recap) stays where it is.
2. **Declarative generative UI.** The model never emits HTML/JSX — it emits versioned JSON
   *blocks* that the client renders through a registry of existing components. Safe by
   construction (A2UI-style).
3. **Human-in-the-loop on writes.** Reads run autonomously. Every mutation (save,
   not-relevant, recap advance, goal change) is emitted as an `approval` block; the backend
   executes it only after the client returns the user's decision.
4. **The static app is untouched.** /guru is additive; Epics A–G keep working as-is.

## 2. Backend

### 2.1 Endpoint

```
POST /api/v1/agent/turn          (auth: existing bearer token)
Content-Type: application/json
Accept: text/event-stream
```

Request body:
```json
{
  "session_id": "uuid | null",       // null starts a new agent session
  "input": {
    "type": "goal" | "message" | "decision",
    "text": "Catch me up on Education",        // goal/message
    "approval_id": "...", "approved": true     // decision
  }
}
```

SSE events (each `data:` line is JSON):
- `{"event":"status","text":"reading your catch-up feed…"}` — drives the activity ticker + blob thinking state
- `{"event":"block","block":{...}}` — a UI block to append/render
- `{"event":"done","session_id":"..."}` — turn complete (blob returns to idle)
- `{"event":"error","message":"..."}`

### 2.2 Agent loop

Manual tool-use loop (not the runner) so `approval` can pause the turn:

```
model = settings.AGENT_MODEL            # default "claude-sonnet-4-6"; flip to
                                        # "claude-opus-4-8" via config — no code change
messages = restore(session_id) + [user_input]
loop:
  resp = claude.messages.create(model, tools=TOOLS, system=[STATIC_SYSTEM(cache_control),
         USER_CONTEXT], messages, max_tokens=2048)
  for tool_use in resp:
      if tool is a WRITE → emit approval block, persist pending action, END TURN
      else → execute (internal HTTP call w/ user's token), append tool_result
  until stop_reason == end_turn
final text is parsed as a block list (structured output) and streamed
```

- **Sessions** persisted in a new `agent_sessions` table (id, user_id, messages JSON,
  pending_action JSON, created/updated). History truncated to last ~20 turns.
- **Prompt caching**: static system prompt + tool defs carry `cache_control`; user context
  (profile, filters, commitment, ring state) is injected as the *second* system block so the
  big prefix stays byte-stable.
- **Adaptive thinking** on; `effort` default (high) — tune down if latency demands.

### 2.3 Tool registry (wraps existing endpoints)

| Tool | Wraps | R/W |
|---|---|---|
| `get_catchup_feed(filter)` | `GET /catchup-feed` | R |
| `get_divein_feed(filter)` | `GET /divein-feed` | R |
| `get_metrics(filter)` | `GET /me/metrics` | R |
| `get_commitment()` | `GET /me/commitment` | R |
| `get_recap_journey()` | `GET /recap/journey` | R |
| `ask_socratic(article_id, q)` | `POST /socratic/chat` | R |
| `save_article(id)` | `POST /articles/{id}/save` | **W — gated** |
| `mark_not_relevant(id)` | existing not-relevant endpoint | **W — gated** |
| `advance_recap(stage)` | recap stage endpoint | **W — gated** |
| `log_time(ring, secs, ctx)` | `POST /metrics/log-time` | W — auto (telemetry, not user data) |

Write-gating: the loop never executes a W tool directly. It emits an `approval` block with a
`pending_action`; the next `/agent/turn` call with `type:"decision", approved:true` executes
it server-side and resumes the loop.

### 2.4 UI block schema (v1)

Enforced via structured outputs (`output_config.format`, strict JSON schema). Envelope:

```json
{"v":1, "type":"<block type>", "id":"blk_...", ...payload}
```

| type | payload | renders as |
|---|---|---|
| `text` | `md` | GuruFormattedText |
| `plan` | `goal, eta_min, steps:[{n,title,eta,status}]` | plan card w/ step dots |
| `article_card` | `article_id, title, source, reading_time, summary, commitment_flag, actions:[save\|skip\|ask\|open]` | storyboard-style card |
| `carousel` | `items:[article_card]` | horizontal scroll |
| `rings` | `c,d,r (0-1), caption` | Triskelion mini |
| `stats` | `items:[{label,value}]` | stat pills row |
| `quote` | `text, article_id` | amber quote card |
| `prompt_pills` | `prompts:[string]` | glass pills (tap → message) |
| `approval` | `approval_id, title, detail_lines, confirm_label, cancel_label` | indigo approval gate |
| `recap_step` | `stage, title, prompt` | recap stage card |
| `outcome_summary` | `lines:[], commitment_line, rings:{c,d,r}, followups:[]` | green tally card |

Unknown types are ignored by the client (forward compatibility).

## 3. Frontend

- **Route** `mobile/app/(tabs)/guru.tsx` (5th tab) — also reachable via Home logo tap
  (`router.push('/guru')`).
- **GuruBlob** (`components/ui/GuruBlob.tsx`): canvas blob, radius = `R(1+Σ sin(kθ+φt)·a)`
  (3 octaves), radial plasma fill sky→indigo→pink. States: `idle` (3s breathe), `thinking`
  (0.9s agitation + hue shift), `celebrate` (one 1.25× pulse). Respects
  `prefers-reduced-motion` (static). Sizes 64 (hero) / 28 (header) / 22 (tab).
- **AgentProvider / useAgentTurn**: POSTs to `/agent/turn`, parses the SSE stream via
  `fetch` + ReadableStream (EventSource can't carry the bearer header), appends blocks to
  session state, exposes `status` for ticker + blob state.
- **BlockRenderer** (`components/Agent/BlockRenderer.tsx`): `{type → component}` registry
  reusing existing pieces; `article_card`'s `open` action routes to the existing
  `/article/[id]` reader so deep-reading/highlights/Q&A are inherited, not rebuilt.
- **Intent bar** is persistent; sending while a journey is active = interrupt/redirect
  (message goes to the same session; the model decides to adjust the plan).

## 4. Cost & model

Default `claude-sonnet-4-6`: with cached system+tools (~3–4K tokens) a typical 4-iteration
turn ≈ 12–20K cached reads + 3–6K fresh input + ~1.5K output ≈ **$0.02–0.05**. Upgrade path:
set `AGENT_MODEL=claude-opus-4-8` (same API surface; no `temperature`, adaptive thinking).

## 5. Rollout & verification

1. Backend deploys via Railway (auto on push). `AGENT_MODEL` + `AGENT_MAX_ITERS` in settings.
2. Web deploys via Vercel.
3. Prod verification = run each canonical goal end-to-end as a real user; confirm approval
   gates fire for every write; confirm outcome tally matches API state (saves, time logs);
   confirm static tabs unaffected.
