---
name: guru-evals
description: Use whenever a task runs the agent evals, reads their results, labels judged runs, calibrates or re-judges the LLM judge, plants mistakes to test it, adds or changes an eval case, a rubric or the score weights, or shows the method in a short live walkthrough. Covers make evals, make evals-calibrate, make evals-planted, make evals-upload and make eval-runs.
---

# Evals, the LLM judge and calibration

The evals say whether the agent still does what Guru promises, in two kinds of case. Behavior cases (response quality and the edge cases, safety and consent, multi-turn, robustness, generated UI, Report a bug) are graded by code, and the fifteen judged ones (the ten edge cases, EDGE-01 to 10, included) by the LLM judge too. Performance cases are measured against budgets and never judged: time to first content from the trace (PERF-01, PERF-03), and a stalled model call from the client's own timeout and retry settings (PERF-04). Code grades what it can (the tools that ran, the blocks that reached the app, the time to first content). An LLM judge reads what code can't (is the claim in the source, is the refusal honest, did "next" mean "remove"), and it gets a vote only after it agrees with the owner's own labels. Everything is in `backend/evals/`; its `README.md` has the detail.

| What | Where |
|---|---|
| The cases: expectation, `must:` list, label, runs | `backend/evals/cases.yaml` |
| What drives each case through the real agent route | `backend/evals/scenarios.py` |
| The judge: prompt, five dimensions, schema, version | `backend/evals/judge.py` |
| The score: per-case rubrics and the area weights | `backend/evals/rubrics.yaml`, `score.py` |
| The owner's labels and the gate switch | `backend/evals/calibration.yaml` |
| Every labeled transcript, with each judge version's verdict | `backend/evals/labeled_transcripts.jsonl` |
| The pool of judged runs waiting for labels (local) | `backend/evals/out/judged_runs.jsonl` |
| Planted mistakes | `backend/evals/planted.py` |

## 1. Run them
- After every change: `make evals`. Scripted (T1), offline, free, about a second. It exits 1 only when a GREEN case fails or a case crashes; a red case red as labeled is expected.
- After a change to the prompt, a tool or the model: `make evals LIVE=1`. The live (T2) cases on the real model, judged too, in worker processes (`JOBS=4` by default): 17 cases, 49 runs, about $3.50 with the judge and 2.5 minutes at `JOBS=6` (measured Wed 10/7). `CASE=ID,ID` runs a few cases, `RUNS=n` sets the repeats, `TRIGGER=manual|demo|scheduled` says how it started, `UPLOAD=0` keeps it local.
- Read the report top down: the Guru eval score and its six areas beside the safety gate (the number says how good, the gate says whether it may ship, and they're never mixed), then each case with its label and verdict, then the judge's line per case (five dimensions, report-only until calibrated), then "judge and code disagree", the runs to read first.
- Every run goes to the admin Issues tab, Eval runs. The ship gate reads only the newest whole live run, so a partial or scripted run can't make it look clearer than it is. `make eval-runs` lists the runs, `make evals-upload` re-sends the saved one.
- A weekly live run is scheduled on the owner's machine (Thursdays 6:00am, log in `~/Library/Logs/guru-nightly-evals.log`). Every case it runs is labeled, so a GREEN case that fails there exits 1 and holds the ship gate until the owner relabels it or the agent is fixed.

## 2. Label: the owner's judgment, never Claude's
- `make evals-calibrate QUICK=1` (five hard calls, one key each), `make evals-calibrate` (per run: the verdict, then each dimension p, f or n), `FOLLOW=1` to label while a live run is going.
- Labeling is blind: the screen shows the expectation and the transcript, never the judge's verdict.
- Claude Code never answers a labeling prompt, never invents or edits a label in `calibration.yaml` or `labeled_transcripts.jsonl`, and never sets `judge_gates`. The labels are the ground truth the judge is measured against; a label from the tool would grade the judge with itself. The one exception is the owner's explicit choice to adopt a second model's labels (a different model from the judge, labeling blind): each adopted label records who made it (`by`, `mode: adopted`), the report shows the split, and nothing calls them the owner's own.
- Recall on failures comes first: a judge that misses a failure is worse than one that raises a false alarm. Read the report's recall line per dimension, and where the labels never fail, measure recall with planted mistakes.

## 3. Read the agreement and close each disagreement
- `make evals-calibrate REPORT=1`: agreement overall and per dimension, false passes (the judge passed what the owner failed, the costly kind) apart from false fails, every disagreement with the judge's reason, and what the gate still needs.
- Every disagreement gets one verdict from the owner, then one change:
  - the rubric was wrong: change the rubric in `judge.py` (its version changes), then `make evals-calibrate REJUDGE=1` (live, cents a transcript) and read the report again;
  - the label was wrong: the owner relabels, with a note saying why;
  - the case was ambiguous: sharpen its `expect` or `must:` list in `cases.yaml`.
- Don't tune on the test: a rubric fix is judged on freshly labeled transcripts, not by re-scoring the ones that exposed it.

## 4. Recalibrate when the judge changes
- Any change to the judge's prompt, schema, model or effort changes `judge.VERSION`. The labels stay; `REJUDGE=1` grades the same transcripts with the new judge, and agreement counts only the current version's verdicts.
- Test the judge with planted mistakes: `make evals-planted DRY=1` shows what would be planted, `make evals-planted` (live, cents a transcript) plants one invented quote or wrong number in copies of passing runs and reports "caught N of M". A miss is a rubric problem.

## 5. The gate switch belongs to the owner
`judge_gates: true` in `calibration.yaml` makes the judge's verdict count. Only the owner sets it, and only when the report says the gate is met: at least 20 labels rating each gating dimension (faithfulness, honesty, consent), at least 85% agreement on each, and no false pass on consent.

## 6. Change the evals themselves
- A new case: its entry in `cases.yaml` (id, tier, area, label, title, expect, why, fix, runs; `judge: true` and a `must:` list for a judged case), its scenario in `scenarios.py`, its rubric in `rubrics.yaml` (without one it's scored on pass or fail alone, with a warning). Run it before and after the change it covers. A red case that turns green gets its label changed in the same commit.
- The weights live in `rubrics.yaml`, quality first: quality 35, safety and consent 25, robustness 15, journey 10, generated UI 10, latency 5. Changing them changes the weights version, and scores under different versions are never compared.

## 7. Showing the method in five minutes
- Tab A: `make evals LIVE=1 CASE=QA-03,PLAN-07,STEP-07 RUNS=2 JOBS=6 TRIGGER=demo` (six runs at once, about 35 seconds, about 60 cents).
- Tab B, at the same time: `make evals-calibrate QUICK=1 FOLLOW=1`, labeling runs as they're judged.
- Then `make evals-calibrate REPORT=1` for the agreement and the gate, and the admin Issues tab, Eval runs, where the run just appeared.
- Five labels show the method; a gate needs twenty. Say so.
