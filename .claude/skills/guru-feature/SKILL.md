---
name: guru-feature
description: Use whenever a task builds a new Guru feature or changes anything a Guru user sees (app screens, the agent's behavior or copy, a new block type). Runs the product, design, criteria, build, verify, ship and close stages in order, does each stage's work without being asked, and stops for the owner's approval before starting the next.
---

# The Guru feature pipeline

A real team builds a feature in a set order: product writes the requirement, design draws it, the TPM tracks it, engineering builds and tests it. This skill is that order for Claude Code. Run each stage yourself, without waiting to be prompted, and stop at the end of it for the owner's approval before starting the next. The hook `.claude/hooks/stage_gate.py` reads `.claude/feature-state.json` before every edit: it asks before app code until the requirement is approved, and before app UI until the design is, so a stage can't be skipped quietly. Only `feature_state.py approve` records an approval, and the settings make that command ask the owner first.

**Narrate as you go, plainly.** Before each stage, one line: what you're about to do, and what runs behind the scenes (the command, hook, connector or file). After it, one line: what happened, and what the owner is approving. Never label the run itself, and never point out what the owner left out: take the default below and say what you're doing ("Creating the Linear issue.").

**Every stop works the same way:** show the result, say what the next stage will do, and wait for a clear yes or a correction. A correction redoes the stage. Never start the next stage on silence.

**Explain every test and eval in plain English,** so the owner can judge it without reading code. Do it when you propose it (criteria), when you write it (build) and when it runs (verify), in five short lines:
- **What's fake, and what's real:** what the test stands in for, and why that's safe. The code being changed must be on the real side. If it isn't, say so and fix the test.
- **What it does:** the user action or turn it plays out, in the user's words.
- **What it checks:** what the user would see, or what must be true afterwards.
- **Why it fails today,** in one line.
- **What it would not catch.**
For an eval, also name its kind: a scripted case (a fake model misbehaves on purpose, to test what the server lets through) or a live case (the real model, to test what it chooses, graded by code and the LLM judge). End with one question to the owner: "Does this check the thing you care about?"

**Invoked with no description?** Reply with this template, and wait:
- **Who:** who sees it.
- **Now:** what they see today.
- **Should:** what they should see.
- **Must not change:** what stays the same.
- **How I'll know:** the unit test, the eval case.
- **Linear:** the issue, if there is one.

**Defaults, used without comment:** no Linear issue given, create one in GURU-dev. A small visible change (one or two screens): draw it in the empty phone frame on the Live changes page of the Guru Figma file. A bigger feature: a new page named after it.

## 0. Start the feature
Say which branch you're on. If the owner asks for a separate branch, create it first.
Name the feature after its Linear issue:
`python3 .claude/hooks/feature_state.py start "GUR-xxx Short name"`
This writes the state file the stage gate reads. If a feature is already in progress, say which one and where it stands, and carry on from there.

## 1. Product: the requirement
From the owner's few lines, write it in chat:
- **Vision:** the user's moment, in one sentence.
- **Who:** which accounts (all users, beta, admins).
- **Requirements:** numbered and testable.
- **Done means:** the acceptance criteria, including how each will be proven (a unit test, an eval case, a screenshot).
- **Not in this version**, and **signals** (how we'd know it works).

**Stop.** On a clear yes, record it (this command asks the owner to confirm), and put the approved text in the Linear issue:
`python3 .claude/hooks/feature_state.py approve requirement --note "<one line: what was approved>"`

## 2. UX: the design, then the connector check
If anything visible changes, draft it yourself in the Guru Figma file (`CVsVL7zvjyO3yoLlUJqBxI`):
- Load the `figma-use` and `figma-generate-design` guidance first.
- Use the design language in `mobile/CLAUDE.md`: navy glass tiers by job, indigo when Guru is speaking or asking, green when it worked, Manrope, the block rules. Take the colors from the code tokens in `mobile/constants/`, never from older frames.
- One frame per state the user sees (entry point, main surface, done or error state), plus a one-line note under each saying what it does and why.

Then, without being asked, prove the connector reads what you drew: Figma `whoami`, `get_metadata` on the file, and `get_screenshot` of each new frame. Show the screenshots.

**Stop.** On a clear yes:
`python3 .claude/hooks/feature_state.py approve design --frame <figma url> --frame <figma url> ...`
If nothing visible changes, say so, **stop**, and on a yes record `approve design --none "<why>"`.
If the connector fails or drawing stalls, say so in one line and ask the owner to draw or describe the frame. Don't debug it.

## 3. Criteria and tracking
Write three or four acceptance criteria a test can check, and name the proof: the new unit test that must go red, then green; the suites that must stay green (`make test-agent`, `make evals`); and the eval cases the change touches, including a speed case when it could change latency.
A change that fits in one sitting needs only its one Linear issue. Bigger work gets sub-issues (backend, app, verify-and-ship), each with its criteria and frame links, then:
`python3 .claude/hooks/feature_state.py link GUR-aaa GUR-bbb ...`

**Stop** for approval of the criteria.

## 4. Build: the plan, the failing unit test, then the smallest fix
- The plan in chat: files, functions, tests. **Stop** for corrections.
- Write the unit test first, against the real code path. Never fake the thing under test: a test that fakes it proves nothing. For server behavior, a contract test in `backend/tests/`. For agent behavior, also a T1 case in `backend/evals/cases.yaml`.
- Run the unit test and show it red, with its failure line.
- The smallest diff. Run the unit test again and show it green. Loop until every criterion passes and the running app matches the frames.
- Behind the scenes: the stage gate checks the state file before each edit, and each edit to the agent, its tracing, its access checks or ingestion reruns `make test-agent` through `.claude/hooks/agent_tests.py`, so a failure comes straight back.

## 5. Verify: two minutes, only what's new
The full agent suite already ran after the last agent edit (the hook does that), and CI runs every suite again on the push, with Railway deploying only when they pass. So verify runs only what's new:
- The new unit test, green.
- The new eval case and the case this change flips, by name: `make evals CASE=<ids>`.
- The speed case, if the change could touch latency: `make evals LIVE=1 CASE=PERF-01`. For a prompt or agent-behavior change, also the live cases it touches, with the judge's dimension scores.
- One line with the hook's last full-suite result and its count. Don't rerun the full suite, and don't run `make ci`, `make test-app` or `make typecheck-app` here: CI does.
- A visible change: the owner shows the running app next to the frame. Don't drive a browser for it.

Say in one line what ran, and that CI runs the rest on the push.

**Stop:** "Verified. Ship it?"

## 6. Ship
Run the `guru-ship` skill: the pre-push checklist out loud (what the restart does, the schema change, the rollback), the push only on the owner's go, then the backend checks. The hook already ran the agent suite after the last edit, and CI runs everything on the push, so don't run `make ci`. Keep the deploy watch running in the background, and while it builds, run the standing live judge check: `make evals LIVE=1 CASE=QA-03,PLAN-07,STEP-07 RUNS=2 JOBS=6` (about 35 seconds), show the judge's dimension scores, then `make evals-calibrate REPORT=1`. When a visible change is already on screen locally, the web deploy can follow later: say so in one line.

## 7. Use it, then close
- Once the deploy is live, ask the owner for one turn in the app that uses the change, then show that turn's trace naming the new build (`make traces DAYS=1`).
- Offer, in one line, to show the report loop: a report filed from that answer, then `make reports`.
- Close the Linear issues with the build SHA, then:
`python3 .claude/hooks/feature_state.py done`

## Small changes
A bug fix or a copy change still starts with a one-line requirement the owner approves. Skip the design stage only when nothing visible changes, and record that with `--none`.
