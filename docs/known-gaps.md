# Known gaps

What is wrong or unfinished in Guru today, written down so nobody discovers it twice. Some gaps are pinned by a test on purpose: the test changes when the gap is fixed, so a fix is a visible decision, not an accident. A fix updates this file in the same commit.

## The agent

| Gap | What happens | Pinned by |
|---|---|---|
| The iteration cap ends a turn silently | After `MAX_ITERS` model calls in one turn, the turn stops with no final answer and no message to the user. Only what streamed before the cap stays on screen. The trace records outcome `max_iters`. | `test_a_runaway_tool_loop_stops_at_max_iters`, `test_the_iteration_cap_is_traced` |
| A cut-off answer looks finished | The loop only checks for `stop_reason == "tool_use"`. An answer cut off at `max_tokens` is parsed like a finished one, so the user can get a partial turn with no notice; the admin view flags it. A cut inside a tool call would leave a `tool_use` with no `tool_result` (from reading the code; no test yet). | - |
| A tool that raises ends the whole turn | Only HTTP errors go back to the model. A missing required argument (a `KeyError` in `_execute_tool`) or an unhandled exception in the route ends the turn with an `error` event, so the model never gets to adapt. | `test_a_raising_tool_is_named_in_the_trace` |
| Raw exception text reaches the screen | The `error` event carries the exception message, and the app shows it after "Something went wrong". A `KeyError` shows a bare field name. | `test_a_model_error_becomes_an_error_event_and_rolls_back` |
| A malformed answer shows raw model output | When the final text doesn't parse as blocks, `_parse_blocks` returns the whole output as one text block. | `test_parse_blocks_falls_back_to_one_text_block_on_malformed_json` |
| `approval_id` is recorded, not enforced | A decision runs whatever write is pending, whatever card id it carries; a mismatch is only recorded in the trace (`approval_matched`). A decision with nothing pending still runs a model turn. An approval card stays tappable after the user types past it, though the server has already treated that write as declined. | - |
| Unknown block types reach the app | The server forwards any block that has a `type`. The app drops unknown types silently. The trace records every block's type, but no rule flags an unknown one. | - |
| Cold-open mini cards never show an image | The headline strip the server streams after `get_catchup_feed` shows the placeholder square on every card. | - |
| Skip hides the story | The agent calls `mark_not_relevant` on a skip, which hides the story from the catch-up feed under one filter (`core` unless the model passes another). Whether Skip should hide a story or only move on is an open product decision. | - |
| Hard text slices | Some text in `agent.py` is cut with `text[:n]`: tool results in `_slim_tool_result` (the deep-read excerpt at 2,400 characters, for one), the session title and the error text. Two of the slices cut serialized JSON, which can hand the model broken JSON. | - |
| `docs/agentic-ui-architecture.md` has drifted | It says 10 tools, every write gated, strict structured outputs, `claude-sonnet-4-6`, `max_tokens` 2048 and an `AGENT_MAX_ITERS` setting. The code has 18 tools, two gated writes, a tolerant block parser, `AGENT_MODEL` (`claude-sonnet-5` by default), 4096 and a `MAX_ITERS` constant. | - |

## Tests and checks

| Gap | What happens | Pinned by |
|---|---|---|
| The legacy backend suite fails | `make test` has long-standing failures: three files import modules that no longer exist, and the TestClient tests break on the installed httpx. Its tests also create users in the database `DATABASE_URL` names (locally, `backend/test.db`). | - |
| The app type check can't give a signal | `npx tsc --noEmit` in `mobile/` stops on syntax errors in `__tests__/e2e/complete-auth-flow.test.ts`, and while any syntax error exists tsc reports no type errors at all. With that file excluded, it reports type errors in app code too. | - |
