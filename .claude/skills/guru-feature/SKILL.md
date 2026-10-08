---
name: guru-feature
description: Use whenever a task builds a new Guru feature or changes anything a Guru user sees (app screens, the agent's behavior or copy, a new block type). Runs the product, design, tracking, build, verify and ship stages in order, and stops for the owner's approval after the requirement and after the design.
---

# The Guru feature pipeline

A real team builds a feature in a set order: product writes the requirement, design draws it, the TPM tracks it, engineering builds it. This skill is that order for Claude Code. Each approval unlocks the next stage. The hook `.claude/hooks/stage_gate.py` asks before edits to app code until the requirement is recorded, and before edits to app UI until the design is, so a stage can't be skipped quietly.

## 0. Start the feature
Name it after its Linear issue (create the issue in GURU-dev if there isn't one):
`python3 .claude/hooks/feature_state.py start "GUR-xxx Short name"`

## 1. Product: the requirement
Write it in chat, then put the approved text in the Linear issue:
- **Vision:** the user's moment, in one sentence.
- **Who:** which accounts (all users, beta, admins).
- **Requirements:** numbered and testable.
- **Done means:** the acceptance criteria, including how it will be proven (a test, an eval case, a screenshot).
- **Not in this version**, and **signals** (how we'd know it works).

Ask for approval. On a clear yes, record it (this command asks the owner to confirm):
`python3 .claude/hooks/feature_state.py approve requirement --note "<one line: what was approved>"`

## 2. UX: the design
If anything visible changes, draft it in the Guru Figma file (`CVsVL7zvjyO3yoLlUJqBxI`) on a page named after the feature:
- Load the `figma-use` and `figma-generate-design` guidance first.
- Use the design language in `mobile/CLAUDE.md`: navy glass tiers by job, indigo when Guru is speaking or asking, green when it worked, Manrope, the block rules. Take the colors from the code tokens in `mobile/constants/`, never from older frames.
- One frame per state the user sees (entry point, main surface, done or error state), plus a one-line note under each saying what it does and why.

Screenshot the page, show it, and wait. On a clear yes:
`python3 .claude/hooks/feature_state.py approve design --frame <figma url> --frame <figma url> ...`
If nothing visible changes, say so, and record `approve design --none "<why>"`.

## 3. TPM: tracking in Linear
Create sub-issues under the feature's issue: backend, app (one per group of frames), and verify-and-ship. Each gets acceptance criteria and its frame links. Add a comment on the parent with the approved requirement and the design links. Then:
`python3 .claude/hooks/feature_state.py link GUR-aaa GUR-bbb ...`

## 4. Build
- A plan first (files, functions, tests), in chat. The owner corrects it.
- Tests and eval cases before code: a T1 case in `backend/evals/cases.yaml` for agent behavior, a contract test for server behavior.
- The smallest diff. Loop until the acceptance criteria pass and the running app matches the frames.

## 5. Verify
`make test-agent`, `make evals` (add `LIVE=1` for a prompt change), and a screenshot of the running app next to each approved frame. Name any difference you chose to keep. A persona run if the change touches a journey.

## 6. Ship
Run the `guru-ship` skill: the pre-push checklist out loud (what the restart does, the schema change, the rollback), the push only on the owner's go, `make watch-deploy` until the new commit serves, the backend checks, then the web preview and promote. Close the Linear issues, then `python3 .claude/hooks/feature_state.py done`.

## Small changes
A bug fix or a copy change still starts with a one-line requirement the owner approves. Skip the design stage only when nothing visible changes, and record that with `--none`.
