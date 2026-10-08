# Guru - how to work in this repo

Guru is my agentic reading companion. You give the agent a goal, it proposes a 3-5 step plan, then runs one step per turn through 18 tools that wrap Guru's own API and answers in typed UI blocks the app renders. It asks before it writes words in the user's name.

In this file "I" am the repo owner and "the user" is whoever uses the app. Where docs and code disagree, the code wins, and you tell me where.

## Where things live
- The agent: `backend/app/routes/agent.py` (tools, the loop, approvals). One turn = `POST /api/v1/agent/turn`, streamed over SSE. The app draws the blocks in `mobile/components/Agent/BlockRenderer.tsx`.
- Traces: `backend/app/services/agent_trace.py` writes one row per agent turn. `trace_insights.py` and `routes/admin_agent.py` turn the rows into the admin Agent view.
- Access: `backend/app/services/access.py` decides who is an admin, a beta tester or synthetic traffic.
- Models: the agent runs whatever `AGENT_MODEL` names. Sonnet 4.5 runs the Socratic chat and the recap synthesis. Haiku runs ingestion and quick Q&A.
- Read `mobile/CLAUDE.md` before app work, and `docs/known-gaps.md` before you fix anything that looks wrong. `docs/agentic-ui-architecture.md` is the agent design doc, and it has drifted.

## Commands
- `make test-agent` - agent contract, admin access and trace-insights tests. Scripted model, fake DB, no network, a few seconds. Run it after every backend change.
- `make evals` - agent evals through the real route, scripted model, offline, about a second. `make evals LIVE=1` adds the live-model cases, graded by the LLM judge too (about $1.35). Cases live in `backend/evals/cases.yaml`; see `backend/evals/README.md`.
- `make traces` - production takeaways and flagged turns. `make trace ID=<id>` - one turn in depth. `make reports` - beta bug reports, each with its turn and Claude's hypothesis; `make report ID=<id>` - one in full. All need `ADMIN_API_KEY` in my shell. Never print it. `make traces-local` and `make reports-local` read the local database instead.
- `make test` (the legacy backend suite) and `cd mobile && npx tsc --noEmit` both fail today for old reasons (see `docs/known-gaps.md`). Run them before and after your change and compare the failures. `make test` also writes test users into the local database.
- Web app: `cd mobile && npx expo start --web --port 8081`. Extension: `cd extension && npm run build`, then load `extension/` unpacked in Chrome.

## Traps
- Don't start the backend locally unless I ask. Startup deletes content older than 30 days (except articles a user saved, highlighted, noted or asked about), adds missing columns, and can start a paid ingestion run.
- `mobile/.env.local` points the dev app at the production API, so a local UI reads and writes prod data. Even looking writes: the Guru tab logs ring time, and every agent turn stores a session and a trace. Sign in only with a synthetic account (an `example.com` address).
- If `mobile/node_modules` is ever a symlink, delete it and run `npm ci` in `mobile/`.

## The agent contract
1. Tools wrap existing routes, never the database. A tool is one branch in `_execute_tool` that calls an `/api/v1` route in-process through `_call_api`, with the user's own token. No route yet? Build and test the route first, then wrap it.
2. The agent can only do what the user can do. No delete, payments, account or auth changes, cross-user reads, raw database access or live web search.
3. Writes come in two kinds:
   - Writes that put words in the user's name (`add_note`, `set_commitment`) live in `WRITE_TOOLS`. The loop shows an approval card with the full text, stores `pending_action`, ends the turn, and runs the tool only on an approved decision.
   - Every other tool runs at once. That covers the writes the user just asked for (save, highlight, not relevant, a recap answer), where the tap or the message is the consent, and five tools that store as a side effect: `ask_guru` saves the Q&A, `start_recap` opens a journey, `recap_socratic` saves the exchange, and `get_recap_questions` and `get_recap_insights` generate and save on their first call.
   - Unsure which kind a new write is? Gate it. Moving a tool in or out of `WRITE_TOOLS` is my call, not yours.
4. Every tool call must match its real route: the path exists and every required parameter is sent. A test that fakes `_call_api` can't prove that. `test_every_tool_call_matches_a_real_route` can, and a new or changed tool must pass it.
5. A new block type ships as one unit: its line in `SYSTEM_STATIC`, a `case` in `BlockRenderer.tsx`, and a test. The model's final text is only `{"blocks":[...]}`. Don't add another raw-text fallback; the one in `_parse_blocks` is a known gap.
6. Every `tool_use` gets a `tool_result`, including a pending write the user never answered. Every slice of `messages` goes through `_sanitize_history`. Never trim the tail: a write turn ends on a `tool_use` that the next turn answers.
7. One tool call per model call (`disable_parallel_tool_use`). The approval branch depends on it.
8. Keep `TOOLS` and `SYSTEM_STATIC` byte-stable. Both sit in the cached prefix, so anything per-user or time-based goes in the second system block, or the prompt cache misses on every turn.
9. Cut text the model or the user will read with `_trunc` (sentence boundary), never `text[:n]`. The hard slices still in `agent.py` are known debt: fix one in its own commit.
10. An HTTP error from a tool's route goes back to the model as `{"error": ...}` so it can adapt. A tool that raises ends the whole turn (a known gap), so a new tool checks its input and returns an error instead of raising.
11. After `get_catchup_feed` the server streams the mini headline cards itself, and the prompt tells the model not to. Change both or neither.
12. If the model keeps breaking a prompt rule at the moment it calls a tool, move the rule into that tool's description.
13. Change the agent's model with `AGENT_MODEL`, never in code. A new limit gets a named constant next to `MAX_ITERS`.

## Traces, privacy and admin
- Tracing is best effort. It must never change or break a turn, and it writes in its own transaction after the turn commits.
- While Guru is pre-beta, every trace keeps full text: what the user typed, tool inputs, block previews. That is on purpose, for debugging and for judging real traffic. `TRACE_FULL_TEXT=false` turns privacy mode back on, and a change to that policy is my call.
- Admin data is checked on the server. Every admin route depends on `require_admin`, or `require_admin_reader` for read-only. Hiding a screen is never the security.
- Don't add an event to the stream the app reads without asking me.

## Never touch
- Secrets: `.env`, `backend/.env`, `mobile/.env.local`, `.secrets.local`. Never open, print, copy or commit them, and refer to a variable by its name only. `.claude/settings.json` blocks reading them.
- `git push` and deploys happen only on my explicit go. A push to `main` redeploys the backend on Railway. Vercel deploys only from the CLI in `mobile/`. `.claude/settings.json` asks before a push or a deploy command.
- Railway and Vercel settings and variables. Never open, print or change them.
- Schema: no change without a plan I approve first. The live path is `create_tables()` plus `_run_column_migrations()` in `backend/app/db/database.py`, add-column only. Never drop or rename a column. Don't write Alembic migrations, nothing runs them.
- `backend/*.db` and `archive/`: never delete, hand-edit or commit them. Build output (`extension/dist/`, `mobile/dist/`) comes only from the build commands.

## Before a push: say what the restart will do
Every backend restart (a deploy, a variable change, a rollback) deletes content older than 30 days, keeping any article a user saved, highlighted, noted or asked about; adds missing columns; and restarts the ingestion clock. Ingestion runs at boot when a tier's last completed run is outside its window (72 hours for expert RSS). Before a push, tell me what the restart will do and how big, whether the schema changed (then it boots on a scratch Postgres 16 first), and how we roll back. After the deploy: `/health` answers 200 and one real agent turn is traced with the new build SHA.

## New features and visible changes: the pipeline
Every new feature, and any change a user can see, runs the `guru-feature` skill (`.claude/skills/guru-feature/`). It is a real team's order: product, design, tracking, then engineering.
1. Requirement: vision, who, numbered requirements, what done means, what's out. I approve it.
2. Design: IMPORTANT - no approved frame, no UI code. Draft the Figma frame in the app's design language (`mobile/CLAUDE.md`), show me a screenshot, wait for my yes.
3. Tracking: the Linear issue and sub-issues, each with acceptance criteria and the frame link.
4. Build to the frame: plan, tests and evals first, the smallest diff. 5. Verify: tests, evals, a screenshot of the running app next to the frame. 6. Ship: the pre-push checklist, on my go.

This file explains the pipeline; hooks guarantee it. `.claude/hooks/stage_gate.py` asks before an edit to app code until the requirement is recorded, and before an edit to app UI until the design is. Approvals are recorded only with `.claude/hooks/feature_state.py approve`, which asks me first. A small fix still starts with a one-line requirement; it skips design only when nothing visible changes. After any edit to the agent, a second hook runs `make test-agent` and hands back a failure at once.

## How I brief work
I give you three things, in order: the requirement (what the user sees change, and what must not), the rules that apply (sections of this file, a Figma frame), and the proof (the test or eval case, written before the code). Give me a plan - files, functions, tests - not code. I'll correct it. Then the smallest diff.

## Definition of done
Show me the output of each:
1. A test that fails without the change and passes with it. Then `make test-agent`, all green.
2. A change to agent behavior gets an eval case in `backend/evals/cases.yaml`, run before and after (`make evals`, plus `LIVE=1` for a prompt change). A red case that turns green gets its label updated in the same commit.
3. A visible change gets a screenshot of the running app next to its approved Figma frame.
4. If the contract moved (a tool, a gate, a block type, a limit), this file changes in the same commit, and so does `docs/known-gaps.md` when a gap opens or closes.
5. Commits are small, one change each, `type(area): what changed`. Never write "tested" in a commit message unless the test is in that commit.
