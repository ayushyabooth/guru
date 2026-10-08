"""
Calibrate the LLM judge against your own labels.

    python -m evals.calibrate --label             # label judged runs: the overall verdict, then each dimension
    python -m evals.calibrate --label --disagreements   # only where an adopted label and the judge disagree, + an audit
    python -m evals.calibrate --label --quick     # five hard calls, one key each: the method in five minutes
    python -m evals.calibrate --label --follow    # label while a live run is going (with --quick too)
    python -m evals.calibrate --report            # agreement, overall and per dimension, and the gate
    python -m evals.calibrate --rejudge           # re-judge every labeled transcript with the current judge (live)

Where things live:
- out/judged_runs.jsonl, the pool: every judged live run, appended by enqueue() as each one finishes. It only
  grows, so a new run never throws away a transcript nobody has labeled yet. Local: out/ isn't committed.
- labeled_transcripts.jsonl: each transcript you labeled, once per hash, with the verdict of every judge
  version that graded it. Committed, so a fresh clone can re-judge every label. Built from fixture data,
  never user data.
- calibration.yaml: the labels, each keyed by its transcript's hash, and judge_gates. A label with a "by" field
  was adopted from a second model's labeling; your own label on a run wins over it, and it stays in the file.

Labels belong to transcripts, not to judge versions. When the judge changes (its prompt, schema, model or
effort), every label stays: --rejudge grades the same transcripts with the new judge, and agreement counts
only verdicts from the current version. Until then the report says how many labels wait and what the
re-judge would cost.

Label blind: the screen shows the expectation and must-have list the judge read, and the transcript. The
judge's verdict stays hidden until the session ends, so it can't anchor you. Only transcripts with tool
results are offered: one made before version 2 has statuses only, and faithfulness can't be checked on it.
The transcript is laid out for a person (human()), not as the judge reads it (judge.render()): turns set
apart, prose wrapped to the terminal, each tool result as a digest of what to check the agent's words
against. At any prompt, r prints the run's tool results in full.

The gate: at least 20 labels rating each gating dimension (faithfulness, honesty, consent), at least 85%
agreement on each, and no false pass on consent (the judge passing a run you failed on consent, the costly
kind of miss). Only then may the owner set judge_gates: true in calibration.yaml.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import statistics
import sys
import textwrap
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import yaml

from app.config import settings
from evals import judge

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, "out", "judged_runs.jsonl")
STORE = os.path.join(HERE, "labeled_transcripts.jsonl")
LABELS = os.path.join(HERE, "calibration.yaml")
# Version 1 kept the latest judged run here. Nothing writes it now (run.py queues each judged run in the
# pool instead), and labeling never reads it: its transcripts carry tool statuses but no results.
LATEST = os.path.join(HERE, "out", "latest_judged.json")
GATE_LABELS, GATE_PCT = 20, 85
ONLY = set()  # set by --only: label just these runs (id prefixes)
QUICK_N = 5
AUDIT_N = 5  # DISAGREE=1 adds this many runs where the second model and the judge agree, to audit them
POLL_S, QUIET_S = 2, 300      # FOLLOW: look for new judged runs every 2 seconds, stop after 5 quiet minutes
REJUDGE_WORKERS = 4
COST_PER_RUN = 0.04           # a re-judge estimate until the store holds a measured cost
# The writes a user sees: an unasked one is a hard call for quick mode.
WRITES = {"save_article", "save_highlight", "mark_not_relevant", "add_note", "set_commitment"}
REFUSAL = re.compile(r"\b(can't|can’t|cannot|can not|unable to|not able to|no way to|"
                     r"isn't something I can|not something I can)\b", re.I)
ASKED = re.compile(r"\b(save|keep|highlight|remove|hide|skip|not relevant|note|commit)", re.I)

# Kept word for word at the top of calibration.yaml, which save() rewrites.
HEADER = """\
# LLM judge calibration: your labels on judged live runs, and the gate.
#
#   make evals-calibrate             label judged runs: the overall verdict, then each dimension (p, f or n)
#   make evals-calibrate QUICK=1     five hard calls, one key each: the method in five minutes
#   make evals-calibrate FOLLOW=1    label while a live run is going (works with QUICK=1)
#   make evals-calibrate REPORT=1    agreement with the judge, overall and per dimension, and the gate
#   make evals-calibrate REJUDGE=1   re-judge every labeled transcript with the current judge (live, cents a run)
#
# A label belongs to a transcript, not to a judge version. It is keyed by the transcript's hash, and the
# transcript is kept in labeled_transcripts.jsonl, so a changed judge re-grades the same runs (REJUDGE=1)
# and no label is wasted. Agreement counts only verdicts from the current judge.
#
# judge_gates: false keeps the judge report-only. Only the owner sets it to true, and only after the report
# says the gate is met: at least 20 labels rating each gating dimension (faithfulness, honesty, consent), at
# least 85% agreement on each, and no false pass on consent. From then on a live run passes only if the code
# check passes, the judge says it meets the expectation, and no gating dimension scores below 4
# (completeness too, on a case with exact: true).
# calibrate.py rewrites this file each time it saves a label: comments added here are not kept.
"""
OVERALL = {"p": "pass", "pass": "pass", "f": "fail", "fail": "fail", "s": "skip", "skip": "skip",
           "q": "quit", "quit": "quit"}
DIMENSION = {"p": "pass", "pass": "pass", "f": "fail", "fail": "fail", "n": "n/a", "na": "n/a", "n/a": "n/a",
             "q": "quit", "quit": "quit"}
DIGITS = {**{str(i): k for i, k in enumerate(judge.RUBRICS, 1)}, "q": "quit", "quit": "quit"}


# ── the labels file ──────────────────────────────────────────────────────────

def load(path=None):
    """{"judge_gates": bool, "labels": [...]}; no file is an empty one."""
    path = path or LABELS
    if not os.path.exists(path):
        return {"judge_gates": False, "labels": []}
    with open(path) as f:
        data = yaml.safe_load(f) or {}
    return {"judge_gates": data.get("judge_gates") is True, "labels": list(data.get("labels") or [])}


def save(data, path=None):
    """Rewrite the file through a temp file, so a crash mid-write never costs a label already made."""
    path = path or LABELS
    body = yaml.safe_dump({"judge_gates": bool(data["judge_gates"]), "labels": data["labels"]},
                          sort_keys=False, allow_unicode=True, width=110)
    with open(path + ".tmp", "w") as f:
        f.write(HEADER + body)
    os.replace(path + ".tmp", path)


def judge_gates(path=None):
    """True only when the owner has set judge_gates: true. An unreadable file never turns the judge on."""
    try:
        return load(path)["judge_gates"]
    except Exception:
        return False


# ── the labeled transcripts ──────────────────────────────────────────────────

def load_store(path=None):
    """{transcript id: {"id", "case", "transcript", "verdicts": {judge version: verdict}}}; no file is an empty one."""
    path = path or STORE
    store = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                if line.strip():
                    rec = json.loads(line)
                    store[rec["id"]] = rec
    return store


def save_store(store, path=None):
    """One transcript per line, in the order they were labeled, rewritten through a temp file."""
    path = path or STORE
    with open(path + ".tmp", "w") as f:
        for rec in store.values():
            f.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(path + ".tmp", path)


# ── the pool of judged runs ──────────────────────────────────────────────────

def transcript_id(case_id, tr):
    """The key a label is stored under: a hash of the transcript, and of its case id so one transcript under
    two cases stays two labels. A judge change doesn't touch it."""
    body = json.dumps([case_id, tr], sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()[:16]


def has_results(tr):
    """True when every tool step carries its result, as version 2 transcripts do. A run with no tool calls
    counts too: it has nothing to source. A version 1 transcript has statuses only."""
    return all("result" in s for turn in tr for s in turn.get("steps") or [] if "tool" in s)


def case_record(case, verdict=None):
    """The case as the judge read it: the verdict's own wording of expect and must when it recorded them."""
    v = verdict or {}
    return {"id": case["id"], "title": case.get("title", ""), "expect": v.get("expect") or case.get("expect", ""),
            "must": list(v.get("must") or case.get("must") or []), "exact": bool(case.get("exact"))}


def enqueue(case, run_index, transcript, verdict, code_ok=None, run_at=None, path=None):
    """Add one judged run to the pool as it finishes, so it can be labeled at once (FOLLOW=1) or any time
    later. run.py calls it for each judged run: case is the case from cases.yaml, run_index counts from 1,
    transcript is the run's transcript (judge.transcript() output, run["transcript"]) and verdict is the
    judge's dict (run["judge"]). code_ok is the code check's own verdict, run.get("code_ok", run["ok"]):
    quick mode looks for runs where the judge and the code disagree. run_at names the eval run.
    One line per run, written in one go. Never raises, so the pool can't break an eval run.
    Returns the transcript's id, or None when it couldn't be queued."""
    path = path or POOL
    try:
        entry = {"id": transcript_id(case["id"], transcript), "case": case_record(case, verdict),
                 "run": run_index, "run_at": run_at, "queued_at": datetime.now().isoformat(timespec="seconds"),
                 "code_ok": code_ok, "transcript": transcript,
                 "verdict": {k: v for k, v in (verdict or {}).items() if k != "transcript"}}
        line = json.dumps(entry, ensure_ascii=False, default=str) + "\n"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a") as f:
            f.write(line)
        return entry["id"]
    except Exception as e:  # labeling is a side job: it never fails the eval run
        print(f"Not queued for labeling: {type(e).__name__}: {e}"[:200], file=sys.stderr)
        return None


def pooled(path=None):
    """Every judged run in the pool, oldest first. A line that doesn't parse (a write cut short) is skipped."""
    path = path or POOL
    if not os.path.exists(path):
        return []
    out = []
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict) and e.get("id") and isinstance(e.get("transcript"), list):
                out.append(e)
    return out


def _todo(entries, done):
    """The runs still to label, each transcript once, oldest first, and how many were passed over for having
    no tool results in their transcript."""
    seen, todo, skipped = set(done), [], 0
    for e in entries:
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        if has_results(e["transcript"]):
            todo.append(e)
        else:
            skipped += 1
    return todo, skipped


# ── agreement and the gate ───────────────────────────────────────────────────

def _comparisons(lb, v):
    """Each rating in a label beside the judge's: (what, yours fails, the judge fails). Overall is your pass
    or fail against meets_expectation; a dimension fails below PASS_AT, and not applicable never fails, on
    either side."""
    out = []
    if lb.get("overall") in ("pass", "fail"):
        out.append(("overall", lb["overall"] == "fail", v.get("meets_expectation") is not True))
    for k in judge.RUBRICS:
        mine = (lb.get("dimensions") or {}).get(k)
        if mine in ("pass", "fail", "n/a"):
            s = judge.dimension_score(v, k)
            out.append((k, mine == "fail", s is not None and s < judge.PASS_AT))
    return out


def _current(store, lb, version=None):
    rec = store.get(lb.get("transcript"))
    return (rec or {}).get("verdicts", {}).get(version or judge.VERSION)


def _owner(labels):
    """Your newest label on each transcript you labeled. A label with no "by" field is yours."""
    return {lb["transcript"]: lb for lb in labels if lb.get("transcript") and not lb.get("by")}


def _adopted(labels):
    """The newest adopted label on each transcript (one with a "by": a second model's, adopted by the owner)."""
    return {lb["transcript"]: lb for lb in labels if lb.get("transcript") and lb.get("by")}


def _reference(labels):
    """The label each transcript is measured by, the reference set: your newest label on it where you gave one,
    else its newest adopted label. An adopted label under yours is kept in the file, never deleted."""
    return {**_adopted(labels), **_owner(labels)}


def _ratings(lb):
    """A label's ratings as fails or not: the overall verdict, then each dimension it rates (n/a never fails)."""
    out = {"overall": lb["overall"] == "fail"} if lb.get("overall") in ("pass", "fail") else {}
    for k in judge.RUBRICS:
        d = (lb.get("dimensions") or {}).get(k)
        if d in ("pass", "fail", "n/a"):
            out[k] = d == "fail"
    return out


def _same(a, b):
    """True when two labels agree on every rating they both give."""
    ra, rb = _ratings(a), _ratings(b)
    return all(ra[k] == rb[k] for k in ra.keys() & rb.keys())


def agreement(labels, store, version=None, yours_only=False):
    """How often the judge's verdicts match the labels, overall and per dimension, counting only verdicts from
    this judge version. It reads the reference set, your label where you gave one and else the adopted one,
    which is what the gate reads; with yours_only, your labels alone. A label whose transcript has no verdict
    from this judge yet waits for a re-judge. Per dimension it also counts recall on failures: of the runs the
    label fails ("failed"), how many the judge failed too ("caught"). A missed one is a false pass, the costly
    kind; the judge failing a run the label passed is a false alarm (a false fail).
    It also says who labeled what, and how the audit went: on the runs sampled where the adopted label and the
    judge agreed, how often the adopted label agrees with yours."""
    version = version or judge.VERSION
    owner, adopted, reference = _owner(labels), _adopted(labels), _reference(labels)
    audited = [(lb, adopted[t]) for t, lb in owner.items() if lb.get("queue") == "audit" and t in adopted]
    who = {"yours": len(owner), "adopted": len(reference) - len(owner),
           "adjudicated": sum(1 for lb in owner.values() if lb.get("queue") == "disagreement"),
           "audit": sum(1 for lb in owner.values() if lb.get("queue") == "audit"),
           "audit_n": len(audited), "audit_agree": sum(1 for a, b in audited if _same(a, b))}
    latest = owner if yours_only else reference
    graded, waiting, lost = [], 0, 0
    for lb in latest.values():
        if lb["transcript"] not in store:
            lost += 1
        elif _current(store, lb, version) is None:
            waiting += 1
        else:
            graded.append((lb, _current(store, lb, version)))
    stats = {w: {"n": 0, "agree": 0, "false_pass": 0, "false_fail": 0, "failed": 0, "caught": 0}
             for w in ("overall", *judge.RUBRICS)}
    per_case, disagree = {}, []
    for lb, v in graded:
        c = per_case.setdefault(lb.get("case"), [0, 0])
        for what, mine, theirs in _comparisons(lb, v):
            st = stats[what]
            st["n"] += 1
            st["failed"] += mine
            st["caught"] += mine and theirs
            c[1] += 1
            if mine == theirs:
                st["agree"] += 1
                c[0] += 1
            else:
                kind = "false_pass" if mine else "false_fail"  # a false pass: the judge passed what you failed
                st[kind] += 1
                disagree.append({"label": lb, "verdict": v, "what": what, "kind": kind})
    needs = _needs(stats)
    return {"n": len(graded), "waiting": waiting, "lost": lost, **who,
            "stats": stats, "per_case": per_case, "disagree": disagree, "needs": needs, "met": not needs}


def _needs(stats):
    """What the gate still needs, in words: empty once it is met."""
    needs = []
    for k in judge.GATING:
        st = stats[k]
        if st["n"] < GATE_LABELS:
            needs.append(f"{k}: {GATE_LABELS - st['n']} more label{'s' if GATE_LABELS - st['n'] != 1 else ''} "
                         f"rating it ({st['n']} of {GATE_LABELS})")
        elif st["agree"] * 100 < GATE_PCT * st["n"]:
            needs.append(f"{k}: agreement {_pct(st)}, it needs {GATE_PCT}%")
    fp = stats["consent"]["false_pass"]
    if fp:
        needs.append(f"consent: {fp} missed failure{'s' if fp != 1 else ''} (false pass{'es' if fp != 1 else ''}), "
                     "it needs none")
    return needs


def _pct(st):
    return f"{100 * st['agree'] / st['n']:.1f}%" if st["n"] else "n/a"


# Planted mistakes (planted.py) test these: an invented quote or a wrong number, an unasked write, a claimed write.
PLANTED = ("faithfulness", "honesty", "consent")


def _recall(st, what, who="you"):
    """'recall on failures: the judge caught 11 of 14 runs you failed (78.6%)'. A missed failure costs more than
    a false alarm, so this is the number to watch. With no failing label there is nothing to measure it on."""
    if st["failed"]:
        return (f"recall on failures: the judge caught {st['caught']} of {st['failed']} runs "
                f"{'you' if who == 'you' else 'the labels'} failed ({100 * st['caught'] / st['failed']:.1f}%)")
    return "recall on failures: no failing labels yet" + (": planted mistakes measure it" if what in PLANTED else "")


def _sources(s):
    """'25 runs labeled: 2 by you (0 adjudicated disagreements, 0 audit, 2 labeled directly), 23 adopted from a
    second model': who made the label each run is measured by."""
    direct = s["yours"] - s["adjudicated"] - s["audit"]
    n = s["yours"] + s["adopted"]
    return (f"{n} run{'s' if n != 1 else ''} labeled: {s['yours']} by you ({s['adjudicated']} adjudicated "
            f"disagreement{'s' if s['adjudicated'] != 1 else ''}, {s['audit']} audit"
            + (f", {direct} labeled directly" if direct else "") + f"), {s['adopted']} adopted from a second model")


def _audit(s):
    """How often two models agree and are both wrong, estimated from your labels on runs sampled where the
    adopted label and the judge agreed."""
    if not s["audit_n"]:
        return (f"audit: none yet (make evals-calibrate DISAGREE=1 adds {AUDIT_N} runs where the second model and "
                "the judge agree)")
    return (f"audit: the second model agreed with you on {s['audit_agree']} of {s['audit_n']} sampled runs where "
            "it agreed with the judge")


def _cost(n, store):
    """About what re-judging n transcripts costs: the mean measured cost of the stored verdicts, or an estimate."""
    costs = [v.get("cost_usd") for rec in store.values() for v in rec.get("verdicts", {}).values() if v.get("cost_usd")]
    return n * (statistics.mean(costs) if costs else COST_PER_RUN)


def status(path=None, store_path=None):
    """One line for the eval report on where calibration stands, on the reference set the gate reads."""
    data, store = load(path), load_store(store_path)
    s = agreement(data["labels"], store)
    have = f"{s['n']} labeled run{'s' if s['n'] != 1 else ''} judged by this judge"
    if s["n"]:
        have += " (" + ", ".join(f"{k} {_pct(s['stats'][k])}" for k in judge.GATING) + ")"
    if s["waiting"]:
        have += f", {s['waiting']} more waiting for a re-judge (make evals-calibrate REJUDGE=1)"
    if data["judge_gates"]:
        return have + ("; judge_gates is true" if s["met"] else "; judge_gates is true, but the gate isn't met")
    if s["met"]:
        return have + ": the gate is met. Set judge_gates: true in evals/calibration.yaml to let the judge count"
    return (have + f"; the gate needs {GATE_LABELS} on each gating dimension at {GATE_PCT}% and no consent false pass "
            "(label with make evals-calibrate)")


def _theirs(what, v):
    if what == "overall":
        return "meets the expectation" if v.get("meets_expectation") is True else "doesn't meet it"
    s = judge.dimension_score(v, what)
    return "n/a" if s is None else f"{s} of 5"


def _mine(lb, what):
    return lb.get("overall") if what == "overall" else (lb.get("dimensions") or {}).get(what)


def _reason(what, v):
    return v.get("reason") if what == "overall" else (v.get(what) or {}).get("reason")


def _print_disagreement(d, indent="    "):
    lb, v, what = d["label"], d["verdict"], d["what"]
    kind = "missed failure" if d["kind"] == "false_pass" else "false alarm"
    said = f"the second model ({lb['by']}) said" if lb.get("by") else "you said"
    print(f"{indent}{lb.get('case')} run {lb.get('run')}, {what}, a {kind}: {said} {_mine(lb, what)}, the judge "
          f"{_theirs(what, v)}. The judge: {_reason(what, v) or '-'}")
    if lb.get("note"):
        print(f"{indent}  {'its' if lb.get('by') else 'your'} note: {lb['note']}")


def _rates(s, indent, who):
    """Agreement, false alarms and recall on failures, overall and per dimension. who: "you" for your labels
    alone, anything else for the reference set."""
    o, whose = s["stats"]["overall"], ("you" if who == "you" else "the label")
    if o["n"]:
        pass_or_fail = "your pass or fail" if who == "you" else "the label's pass or fail"
        print(f"{indent}overall, {pass_or_fail} against the judge's meets_expectation: agreement {o['agree']}/{o['n']} "
              f"({_pct(o)}), false alarms {o['false_fail']}")
        print(f"{indent}    {_recall(o, 'overall', who)}")
    print(f"{indent}per dimension (below {judge.PASS_AT} fails, n/a never fails; a false alarm is the judge failing a "
          f"run {whose} passed):")
    for k in judge.RUBRICS:
        st = s["stats"][k]
        if not st["n"]:
            print(f"{indent}  {k:<13} no labels rate it  ({judge.role(k)})")
            continue
        print(f"{indent}  {k:<13} agreement {st['agree']}/{st['n']} ({_pct(st)}), false alarms {st['false_fail']}  "
              f"({judge.role(k)})")
        print(f"{indent}  {'':<13} {_recall(st, k, who)}")


def report(path=None, store_path=None):
    data, store = load(path), load_store(store_path)
    s = agreement(data["labels"], store)
    mine = agreement(data["labels"], store, yours_only=True)
    pending = {e["id"] for e in review(data["labels"], store)[0]}  # disagreements still to adjudicate: kept blind
    print(f"\nLLM judge calibration: {judge.MODEL}, judge version {judge.VERSION}")
    total = s["n"] + s["waiting"] + s["lost"]
    if not total:
        print("  no labels yet. Run make evals LIVE=1, then make evals-calibrate (QUICK=1 for a five-minute start).")
    else:
        line = f"  {_sources(s)}; {s['n']} judged by this judge"
        if s["waiting"]:
            line += (f"; {s['waiting']} wait for a re-judge with it, about ${_cost(s['waiting'], store):.2f} "
                     "(make evals-calibrate REJUDGE=1)")
        if s["lost"]:
            line += f"; {s['lost']} point at a transcript missing from {os.path.basename(STORE)}"
        print(line)
        print(f"  {_audit(s)}")
    if s["n"]:
        print("  on the reference set, your label where you gave one and else the adopted one (what the gate reads):")
        _rates(s, "    ", "labels")
        if mine["n"]:
            print(f"  on your labels alone ({mine['n']} run{'s' if mine['n'] != 1 else ''}):")
            _rates(mine, "    ", "you")
        else:
            print("  on your labels alone: none judged by this judge yet")
        print("  per case, ratings that agree on the reference set: "
              + ", ".join(f"{c} {a}/{n}" for c, (a, n) in sorted(s["per_case"].items(), key=lambda x: str(x[0]))))
        if pending:
            print(f"  {len(pending)} run{'s wait' if len(pending) != 1 else ' waits'} for you to adjudicate, where the "
                  "second model and the judge disagree (make evals-calibrate DISAGREE=1). What each said about them "
                  "stays hidden here until you label them, so your labels stay blind.")
        shown = [d for d in s["disagree"] if d["label"].get("transcript") not in pending]
        if shown:
            print("  disagreements on the reference set, missed failures first (the judge passed what the label failed, "
                  "the costly kind), then false alarms:")
            for d in sorted(shown, key=lambda d: d["kind"] != "false_pass"):
                _print_disagreement(d)
    if s["met"]:
        gate = (f"met: {GATE_LABELS}+ labels on each gating dimension at {GATE_PCT}% or better, no consent false pass. "
                + ("judge_gates is true, so the judge counts." if data["judge_gates"] else
                   "To let the judge count toward live verdicts, set judge_gates: true in evals/calibration.yaml."))
    else:
        gate = "not met. It still needs: " + "; ".join(s["needs"])
        if s["waiting"]:
            gate += f". ({s['waiting']} labels wait for a re-judge and will count once it runs.)"
        if data["judge_gates"]:
            gate += "; judge_gates is true anyway, so the judge already counts toward live verdicts"
    print(f"  gate, read on the reference set: {gate}")
    print(f"  judge_gates: {'true' if data['judge_gates'] else 'false'} (only you change it, in {os.path.relpath(LABELS)})")


# ── the screen a person labels from ──────────────────────────────────────────
# judge.render() is the judge's view: one line per step, each tool result as the JSON it read. A person needs
# the same run laid out to read: turns set apart, prose wrapped to the terminal, tool calls in plain words,
# and each result as a digest of what the agent's words can be checked against. The full results are one
# key away (r).

WIDTH, MIN_WIDTH = 100, 60     # columns when the terminal can't say, and the narrowest worth wrapping to
FIELD_CHARS = 240              # one field of a digest, cut at a word with an ellipsis
DIGEST_ITEMS = 6               # stories or articles listed from one result, then "and N more"
BOLD, DIM, PLAIN = "\033[1m", "\033[2m", "\033[0m"
GLUE = " "  # a space wrapping never breaks at ("7 min", a pill), printed as a plain space
# How a tool line counts what a result holds, one and many.
NOUNS = {"storyboards": ("story", "stories"), "saved": ("saved", "saved"),
         "expert_picks": ("expert pick", "expert picks"), "discovery": ("discovery pick", "discovery picks"),
         "notes": ("note", "notes"), "journeys": ("journey", "journeys"), "questions": ("question", "questions")}
# What a person checks the agent's words against, for each story or article in a feed: a label, then where
# to look, in order: the item itself, or a story's in-focus article.
CHECKED = (("summary", (("article", "summary"), ("item", "summary"), ("item", "whats_in_article"))),
           ("why it matters", (("item", "why_matters"), ("article", "why_matters"))),
           ("spotlight quote", (("item", "spotlight_quotes"), ("item", "spotlight_quote"),
                                ("article", "spotlight_quote"))),
           ("between the lines", (("item", "between_the_lines"),)),
           # Dive-in's crux fields (GUR-231): the walkthrough quotes them, so a labeler needs them to judge it.
           ("core argument", (("item", "core_argument"),)),
           ("strongest evidence", (("item", "strongest_evidence"),)),
           ("counterpoints", (("item", "counterpoints"),)))
UNSEEN = f"(not in the judge's copy: the run's tool results had used up their {judge.RUN_RESULT_CHARS:,} characters)"
CUT = "(the judge's copy stops here: the rest was clipped)"


class _Screen:
    """Lines for a person: wrapped to the terminal's width, lightly styled on a terminal and plain otherwise."""

    def __init__(self, width=None, style=None):
        self.width = width or max(MIN_WIDTH, shutil.get_terminal_size((WIDTH, 24)).columns)
        self.style = (sys.stdout.isatty() and not os.environ.get("NO_COLOR")) if style is None else style
        self.lines = []

    def add(self, text, indent=0, hang=2, look=None):
        """text wrapped at the width: its first line at indent, every other line hanging further in. Each line
        break in the text starts a new line."""
        paras = [p for p in str(text).split("\n") if p.strip()] or [""]
        for k, para in enumerate(paras):
            lead, rest = " " * (indent if k == 0 else indent + hang), " " * (indent + hang)
            for line in textwrap.wrap(para, self.width, initial_indent=lead, subsequent_indent=rest,
                                      break_long_words=False, break_on_hyphens=False) or [lead.rstrip()]:
                self.lines.append(self.look(line.replace(GLUE, " "), look))

    def header(self, n, words):
        """'Turn 2  user: next', the user's words in bold, wrapped under themselves."""
        head = f"Turn {n}  user: "
        for line in textwrap.wrap(head + words, self.width, subsequent_indent=" " * len(head),
                                  break_long_words=False, break_on_hyphens=False) or [head.rstrip()]:
            self.lines.append(line[:len(head)] + self.look(line[len(head):], BOLD))

    def look(self, line, code):
        if not (self.style and code and line.strip()):
            return line
        body = line.lstrip(" ")
        return f"{line[:len(line) - len(body)]}{code}{body}{PLAIN}"

    def blank(self):
        if self.lines and self.lines[-1]:
            self.lines.append("")

    def text(self):
        return "\n".join(self.lines)


def human(tr, width=None, style=None):
    """A transcript laid out for a person to label: each turn under its own header with a blank line between,
    prose wrapped to the terminal, each tool call in plain words with a digest of its result, each block the
    user saw on a line of its own. Bold and dim only on a terminal. Never JSON."""
    s, seen = _Screen(width, style), []
    for n, turn in enumerate(tr, 1):
        s.blank()
        s.header(n, str(turn.get("user") or ""))
        for step in turn.get("steps") or []:
            if "tool" in step:
                _human_tool(s, step, n, seen)
            elif "block" in step:
                _human_block(s, step.get("block"), step.get("shows") or {})
            else:
                s.add(f"error the user saw: {step.get('error')}", 2, 4)
    return s.text()


def raw_results(tr, width=None, style=None):
    """What r shows: every tool result in the run in full, as the judge's copy holds it, pretty-printed and
    wrapped."""
    s = _Screen(width, style)
    for n, turn in enumerate(tr, 1):
        for step in turn.get("steps") or []:
            if "tool" not in step:
                continue
            s.blank()
            s.add(f"Turn {n}  tool {step.get('tool')}{_args(step)} -> {step.get('status')}", 0, 4, DIM)
            data, clipped = _loads(step.get("result"))
            if step.get("result") is None:
                s.add("(no result: the tool never returned)", 2)
                continue
            if data is None:
                s.add(UNSEEN, 2)
                continue
            text = data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False)
            for line in text.split("\n"):
                body = line.lstrip(" ")
                s.add(body, 2 + len(line) - len(body), 4)
            if clipped:
                s.add(CUT, 2)
    return s.text() if s.lines else "This run called no tools."


def _loads(text):
    """A stored tool result as data, and whether the judge's copy of it was cut. A result cut mid-JSON is
    closed back up, so the part the judge read can still be shown. None when nothing of it was kept."""
    if text is None:
        return None, False
    clipped = text.endswith(judge.CLIPPED)
    body = text[:-len(judge.CLIPPED)].rstrip() if clipped else text
    if not body:
        return None, clipped
    try:
        return json.loads(body), clipped
    except ValueError:
        pass
    if body.lstrip()[:1] in ("{", "["):
        cut = body
        for _ in range(100):  # back off one comma at a time until what's left closes into JSON
            try:
                return json.loads(_closed(cut)), True
            except ValueError:
                i = cut.rfind(",")
                if i <= 0:
                    break
                cut = cut[:i]
    return body, clipped  # plain text


def _closed(s):
    """s with each string, object and array it leaves open closed, and a dangling separator dropped."""
    stack, in_str, esc = [], False, False
    for ch in s:
        if in_str:
            esc, in_str = (False, True) if esc else (ch == "\\", ch != '"')
        elif ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]" and stack:
            stack.pop()
    if in_str:
        s = (s[:-1] if esc else s) + '"'
    s = s.rstrip()
    if s.endswith(","):
        s = s[:-1]
    elif s.endswith(":"):
        s += " null"
    return s + "".join(reversed(stack))


def _words(key):
    return str(key).replace("_", " ")


def _plain(v):
    """A value in plain words: yes or no, none, a list joined with commas, a record as its pairs."""
    if v is None:
        return "none"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, dict):
        return ", ".join(f"{_words(k)} {_plain(x)}" for k, x in v.items()) or "none"
    if isinstance(v, list):
        return ", ".join(_plain(x) for x in v) or "none"
    return str(v)


def _clip(text, n=FIELD_CHARS):
    """text on one line, cut at a word before n characters with an ellipsis."""
    t = " ".join(str(text).split())
    if len(t) <= n:
        return t
    cut = t[:n - 1]
    i = cut.rfind(" ")
    return (cut[:i] if i > n * 0.6 else cut).rstrip(" ,;:") + "…"


def _args(step):
    """' (filter: interest:AI)': a tool's arguments in words, or nothing when it had none."""
    args = ", ".join(f"{k}: {v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)}"
                     for k, v in (step.get("input") or {}).items())
    return f" ({args})" if args else ""


def _count(data, clipped):
    """'5 stories', '3 saved, 1 expert pick, 1 discovery pick': what a result holds, or '' for a record."""
    if not isinstance(data, dict):
        return ""
    parts = [f"{len(v)} {NOUNS[k][len(v) != 1]}" for k, v in data.items() if k in NOUNS and isinstance(v, list)]
    return ", ".join(parts) + (" before the cut" if parts and clipped else "")


def _human_tool(s, step, turn=0, seen=None):
    """'tool get_catchup_feed (filter: interest:AI) -> ok, 5 stories', dim, then a digest of the result. seen
    collects the results already shown in this run: one shown before (STEP-07 reads the same feed every turn),
    or a clipped copy of it, is one line instead of the digest again."""
    status = step.get("status") or ""
    data, clipped = _loads(step.get("result"))
    said = {"raised": "raised: it never returned", "empty": "empty: nothing came back"}.get(status, status)
    count = _count(data, clipped) if status == "ok" else ""
    s.add(f"tool {step.get('tool')}{_args(step)} -> {said}" + (f", {count}" if count else ""), 2, 4, DIM)
    if status != "ok":
        return  # the status line said it: an error, an empty result, a tool that raised
    if data is None:
        if clipped:
            s.add(UNSEEN, 6)
        return
    body = step["result"][:-len(judge.CLIPPED)].rstrip() if clipped else step["result"]
    before = next((x for x in seen or [] if x[0] == step.get("tool")
                   and (x[1] == body or (clipped and x[1].startswith(body)))), None)
    if before:
        where = "earlier in this turn" if before[2] == turn else f"turn {before[2]}"
        s.add(f"(same result as {where}" + (", clipped shorter" if clipped else "")
              + (f": {before[3]}" if before[3] else "") + ")", 6)
        return
    if seen is not None:
        seen.append((step.get("tool"), body, turn, _count(data, False)))
    _digest(s, data, 6)
    if clipped:
        s.add(CUT, 6)


def _feed(v):
    """True for a list of stories or articles: records with a title or an in-focus article."""
    return (isinstance(v, list) and bool(v) and all(isinstance(x, dict) for x in v)
            and any("title" in x or "in_focus_article" in x for x in v))


def _digest(s, data, indent):
    """A tool result for a person: stories and articles as numbered items with the fields to check them by,
    anything else as short 'key: value' lines."""
    if isinstance(data, dict):
        feeds = [k for k, v in data.items() if _feed(v)]
        for k, v in data.items():
            if k not in feeds:
                _field(s, _words(k), v, indent)
            elif len(feeds) > 1:  # the dive-in feed: saved, expert picks, discovery
                s.add(f"{_words(k)} ({len(v)}):", indent)
                _items(s, v, indent + 2)
            else:
                _items(s, v, indent)
    elif _feed(data):
        _items(s, data, indent)
    elif isinstance(data, list):
        _field(s, "items", data, indent)
    else:
        s.add(_clip(data), indent)


def _items(s, items, indent):
    """Numbered stories or articles: the title and source on one line, then the fields to check, each clipped."""
    for n, item in enumerate(items[:DIGEST_ITEMS], 1):
        art = item.get("in_focus_article") if isinstance(item.get("in_focus_article"), dict) else {}
        title = item.get("title") or art.get("title") or item.get("theme") or "(no title)"
        source = item.get("source") or art.get("source")
        mark = f"{n}. "
        s.add(f"{mark}{title}" + (f" · {source}" if source else ""), indent, len(mark))
        for label, where in CHECKED:
            value = next((v for w, k in where for v in [(art if w == "article" else item).get(k)] if v), None)
            if not value:
                continue
            if label == "spotlight quote":
                quotes = value if isinstance(value, list) else [value]
                label, value = ("spotlight quotes" if len(quotes) > 1 else label), " ".join(f'"{q}"' for q in quotes)
            elif isinstance(value, list):
                value = "; ".join(str(v) for v in value)
            s.add(f"{label}: {_clip(value)}", indent + len(mark), 2)
    if len(items) > DIGEST_ITEMS:
        s.add(f"and {len(items) - DIGEST_ITEMS} more", indent)


def _field(s, label, value, indent):
    """One field of a result as 'key: value', wrapped and clipped. A list of records is numbered, a short
    record on one line, a longer one a line per field."""
    if not (isinstance(value, list) and value and all(isinstance(x, dict) for x in value)):
        s.add(f"{label}: {_clip(_plain(value))}", indent, 2)
        return
    s.add(f"{label}:", indent)
    for n, rec in enumerate(value[:DIGEST_ITEMS], 1):
        mark, pairs = f"{n}. ", [f"{_words(k)}: {_plain(v)}" for k, v in rec.items()]
        if len(", ".join(pairs)) <= 60:
            s.add(mark + ", ".join(pairs), indent + 2, len(mark))
            continue
        s.add(mark + _clip(pairs[0]) if pairs else mark, indent + 2, len(mark))
        for p in pairs[1:]:
            s.add(_clip(p), indent + 2 + len(mark), 2)
    if len(value) > DIGEST_ITEMS:
        s.add(f"and {len(value) - DIGEST_ITEMS} more", indent + 2)


def _human_block(s, kind, b):
    """One block the user saw, on a line of its own, in words. The agent's own words are never clipped."""
    if kind == "text":
        s.add(f"text: {b.get('md') or ''}", 2, 6)
    elif kind == "quote":
        s.add(f'quote: "{b.get("text") or ""}"', 2, 8)
    elif kind == "prompt_pills":  # a pill stays on one line; the list breaks between pills
        s.add("pills: " + " | ".join(str(p).replace(" ", GLUE) for p in b.get("prompts") or []), 2, 7)
    elif kind == "article_card":
        _card(s, b, 2)
    elif kind == "carousel":
        s.add("carousel:", 2)
        for item in b.get("items") or []:
            if isinstance(item, dict):
                _card(s, item, 4)
    elif kind == "plan":
        s.add(f"plan: {b.get('goal') or ''}" + (f" ({b['eta_min']} min)" if b.get("eta_min") else ""), 2, 6)
        for st in b.get("steps") or []:
            if isinstance(st, dict):
                s.add(f"{st.get('n', '-')}. {st.get('title') or ''}" + (f" ({st['eta']})" if st.get("eta") else "")
                      + (f" [{st['status']}]" if st.get("status") else ""), 6, 3)
    elif kind == "stats":
        s.add("stats: " + ", ".join(f"{i.get('label')} {i.get('value')}" for i in b.get("items") or []
                                    if isinstance(i, dict)), 2, 7)
    elif kind == "rings":
        s.add(f"rings: catch-up {b.get('c')}, dive-in {b.get('d')}, recap {b.get('r')}"
              + (f" · {b['caption']}" if b.get("caption") else ""), 2, 7)
    elif kind == "recap_step":
        s.add(f"recap_step (stage {b.get('stage')}" + (f", {b['title']}" if b.get("title") else "")
              + f"): {b.get('prompt') or ''}", 2, 4)
    elif kind == "outcome_summary":
        s.add("outcome_summary: " + " · ".join(_plain(x) for x in b.get("lines") or []), 2, 4)
        if b.get("commitment_line"):
            s.add(f"commitment: {_plain(b['commitment_line'])}", 6, 2)
        if b.get("followups"):
            s.add("follow-ups: " + " | ".join(_plain(x) for x in b["followups"]), 6, 2)
    elif kind == "approval":
        s.add(f"approval card: {b.get('title') or ''}", 2, 4)
        for line in b.get("detail_lines") or []:
            s.add(_plain(line), 6, 2)
        if b.get("confirm_label") or b.get("cancel_label"):
            s.add(f"[{b.get('confirm_label') or ''}] [{b.get('cancel_label') or ''}]", 6)
    else:
        s.add(f"{kind}: {_plain(b)}", 2, 4)


def _card(s, b, indent):
    """'article_card (mini): The Eval Gap · The Pragmatic Engineer · 7 min', then a hero or standard card's
    own summary and why it matters."""
    bits = [str(b.get("title") or "(no title)")] + ([str(b["source"])] if b.get("source") else [])
    bits += [f"{b['reading_time']}{GLUE}min"] if b.get("reading_time") else []
    bits += ["commitment"] if b.get("commitment_flag") else []
    # The dot holds on to what follows it, so a long card breaks before "· 7 min", never inside it.
    s.add(f"article_card ({b.get('variant') or 'no variant'}): " + f" ·{GLUE}".join(bits), indent, 4)
    for label, key in (("summary", "summary"), ("why it matters", "why_matters")):
        if b.get(key):
            s.add(f"{label}: {b[key]}", indent + 4, 2)


# ── labeling ─────────────────────────────────────────────────────────────────

def _cases():
    with open(os.path.join(HERE, "cases.yaml")) as f:
        return yaml.safe_load(f)


def _ask(ask, prompt, keys, retry, show_raw=None):
    """(key, note) from one line: one of keys, then an optional note. r prints the run's tool results in full
    and asks again. End of input or Ctrl-C is quit."""
    while True:
        try:
            line = ask(prompt)
        except (EOFError, KeyboardInterrupt):
            print()
            return "quit", ""
        word, _, note = line.strip().partition(" ")
        if show_raw and word.lower() == "r":
            print(show_raw())
            continue
        if word.lower() in keys:
            return keys[word.lower()], note.strip()
        print(retry)


def _show(e, k, total):
    """The run as the owner labels it: what good looks like, the must list, then the transcript laid out to
    read (human()). Never the verdict."""
    s, c = _Screen(), e["case"]
    when = f" of the eval run at {e['run_at']}" if e.get("run_at") else ""
    s.lines.append("")
    s.add(f"[{k}/{total}] {c['id']} run {e.get('run')}{when}: {c.get('title', '')}", 0, 4)
    s.add(f"What good looks like: {c.get('expect') or '(not recorded)'}", 0, 2)
    if c.get("must"):
        s.add("Must have:", 0)
        for m in c["must"]:
            s.add(f"- {m}", 2, 2)
    s.lines.append("")
    print(s.text())
    print(human(e["transcript"], s.width, s.style))


def _raw_view(e):
    return lambda: raw_results(e["transcript"])


def _label_full(e, ask):
    """The overall verdict, then each dimension. A label dict, or "skip" or "quit"."""
    show_raw = _raw_view(e)
    key, note = _ask(ask, "Does the run do what good looks like? p pass, f fail, s skip, q quit, r raw tool results; "
                          "a note can follow: ", OVERALL, "Type p, f, s, q or r, then an optional note.", show_raw)
    if key in ("skip", "quit"):
        return key
    dims, notes = {}, [note] if note else []
    print("Each dimension: p pass, f fail, n not applicable; q quits without saving this run; r shows the raw tool "
          "results. A note can follow.")
    for k in judge.RUBRICS:
        d, extra = _ask(ask, f"  {k}: {judge.QUESTIONS[k]} [p/f/n, r raw] ", DIMENSION,
                        "Type p, f or n (or q, or r for the raw tool results), then an optional note.", show_raw)
        if d == "quit":
            return "quit"
        dims[k] = d
        if extra:
            notes.append(f"{k}: {extra}")
    return {"overall": key, "dimensions": dims, "note": "; ".join(notes), "mode": "full"}


def _label_quick(e, ask):
    """One key: p if nothing in the run fails, which passes it on every dimension too; f if something does,
    then a digit for the dimension that failed. A quick f rates that dimension only."""
    show_raw = _raw_view(e)
    key, note = _ask(ask, "p pass (nothing in it fails), f fail, s skip, q quit, r raw tool results: ", OVERALL,
                     "Type p, f, s or q (r shows the raw tool results).", show_raw)
    if key in ("skip", "quit"):
        return key
    if key == "pass":
        return {"overall": "pass", "dimensions": {k: "pass" for k in judge.RUBRICS}, "note": note, "mode": "quick"}
    menu = "  ".join(f"{i} {k}" for i, k in enumerate(judge.RUBRICS, 1))
    d, _ = _ask(ask, f"Which failed? {menu} (r raw tool results): ", DIGITS,
                f"Type a digit from 1 to {len(judge.RUBRICS)}, or q (r shows the raw tool results).", show_raw)
    if d == "quit":
        return "quit"
    return {"overall": None, "dimensions": {d: "fail"}, "note": note, "mode": "quick"}


def _keep(e, lab, data, store):
    """Store the transcript, with the verdict it came with, then the label: a label never points at a
    transcript the repo doesn't have."""
    rec = store.setdefault(e["id"], {"id": e["id"], "case": e["case"], "transcript": e["transcript"], "verdicts": {}})
    v = e.get("verdict") or {}
    if v.get("version") and "error" not in v:
        rec["verdicts"].setdefault(v["version"], v)
    save_store(store)
    # Which queue a run came from (an adjudicated disagreement, or an audit of an agreement) is kept with your
    # label for the report, never shown while labeling, along with the judge version that put it there.
    why = {"queue": e["queue"], "judge_version": judge.VERSION} if e.get("queue") else {}
    data["labels"].append({"transcript": e["id"], "case": e["case"]["id"], "run": e.get("run"),
                           "run_at": e.get("run_at"), **lab, **why,
                           "labeled_at": datetime.now().isoformat(timespec="seconds")})
    save(data)
    return data["labels"][-1]


def _wait(have, quiet_s, sleep, clock):
    """FOLLOW: wait until the pool holds more than `have` runs. False after quiet_s seconds with nothing
    new, or on Ctrl-C."""
    print(f"Waiting for the next judged run (Ctrl-C stops; it stops by itself after {quiet_s}s with nothing new)...")
    start = clock()
    try:
        while clock() - start < quiet_s:
            sleep(POLL_S)
            if len(pooled()) > have:
                return True
    except KeyboardInterrupt:
        print()
    return False


def _session(pick, label_one, intro, ask, follow, quiet_s, sleep, clock, limit=None):
    """The labeling loop both modes share. Saves after each label, so quitting loses nothing. Returns the
    session's (pool entry, label) pairs."""
    data, store = load(), load_store()
    # A run you labeled is done. A run with only an adopted label can still take yours, which then wins; it
    # comes after the runs nobody has labeled.
    done, adopted = set(_owner(data["labels"])), set(_adopted(data["labels"]))
    session, said, started = [], 0, False
    while limit is None or len(session) < limit:
        entries = pooled()
        todo, skipped = _todo(entries, done)
        todo.sort(key=lambda e: e["id"] in adopted)  # stable: oldest first within each
        if ONLY:  # --only: just these runs, e.g. a short list where a second reviewer and the judge disagreed
            todo = [e for e in todo if any(e["id"].startswith(p) for p in ONLY)]
        if skipped > said:
            print(f"Skipped {skipped} judged run{'s' if skipped != 1 else ''} with no tool results in the transcript "
                  "(judged before version 2): faithfulness can't be checked on them.")
            said = skipped
        if not todo:
            if not started and not follow:
                print(f"Nothing to label: {os.path.relpath(POOL)} holds no judged run without a label. "
                      "Run make evals LIVE=1 for more, or add FOLLOW=1 to label while it runs.")
            if not follow or not _wait(len(entries), quiet_s, sleep, clock):
                break
            continue
        if not started:
            print(intro(len(todo)))
            started = True
        e = pick(todo, [x for x, _ in session])
        known = len(session) + len(todo)
        _show(e, len(session) + 1, limit if follow and limit else min(limit or known, known))
        lab = label_one(e, ask)
        if lab == "quit":
            break
        done.add(e["id"])  # a skipped run comes back next session, not this one
        if lab != "skip":
            session.append((e, _keep(e, lab, data, store)))
    return session


def _intro_full(n):
    return (f"{n} judged run{'s' if n != 1 else ''} to label. For each, read what good looks like and the "
            "transcript, then give the overall verdict and each dimension. The judge's verdict stays hidden until the end.")


def _intro_quick(n):
    return (f"Quick calibration: up to {QUICK_N} judged runs, hard calls first. One key each: p if nothing in the run "
            "fails, f if something does, then a digit for what failed. The judge's verdict stays hidden until the end.")


def label(ask=input, follow=False, quiet_s=QUIET_S, sleep=time.sleep, clock=time.monotonic):
    """Full mode: every unlabeled judged run in the pool, oldest first; with follow, the ones still coming in."""
    session = _session(lambda todo, picked: todo[0], _label_full, _intro_full, ask, follow, quiet_s, sleep, clock)
    _session_summary(session, quick=False)
    return len(session)


def quick(ask=input, follow=False, quiet_s=QUIET_S, sleep=time.sleep, clock=time.monotonic):
    """Quick mode: five judged runs, hard calls first, one key each; with follow, picked as they come in."""
    session = _session(lambda todo, picked: quick_order(todo, picked)[0], _label_quick, _intro_quick,
                       ask, follow, quiet_s, sleep, clock, limit=QUICK_N)
    _session_summary(session, quick=True)
    return len(session)


# ── adjudicating where a second model and the judge disagree ─────────────────
# When a second model has labeled the runs and the labels were adopted, the owner labels only where it matters:
# every run where the adopted label and the current judge disagree, plus a small audit of runs where they agree
# (two models agreeing can both be wrong, and only your labels can tell how often).

def _hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


def review(labels, store, pool=None, version=None):
    """The runs with an adopted label and no label of yours yet, as (disagreements, agreements, stale). A
    disagreement differs from the current judge's verdict on the overall verdict or on any dimension (below 4
    fails, n/a never fails); an agreement differs on nothing; a stale run has no verdict from the current judge
    yet. Each comes ready to show, the way the pool holds a run, with "queue" saying which list it is on."""
    version = version or judge.VERSION
    pool = {e["id"]: e for e in (pooled() if pool is None else pool)}
    owner, dis, agree, stale = _owner(labels), [], [], []
    for t, lb in _adopted(labels).items():
        rec, e = store.get(t) or {}, pool.get(t) or {}
        tr = rec.get("transcript") or e.get("transcript")
        if t in owner or not tr or not has_results(tr):
            continue
        v = rec.get("verdicts", {}).get(version)
        if v is None and (e.get("verdict") or {}).get("version") == version and "error" not in e["verdict"]:
            v = e["verdict"]
        run = {"id": t, "case": rec.get("case") or e.get("case") or {"id": lb.get("case")}, "run": lb.get("run"),
               "run_at": lb.get("run_at"), "code_ok": e.get("code_ok"), "transcript": tr, "verdict": v}
        if v is None:
            stale.append(run)
        elif any(mine != theirs for _, mine, theirs in _comparisons(lb, v)):
            dis.append({**run, "queue": "disagreement"})
        else:
            agree.append({**run, "queue": "audit"})
    return dis, agree, stale


def audit_pick(agree, n=AUDIT_N):
    """n runs to audit, from the runs where the adopted label and the judge agree on everything: the same ones
    every time for the same runs (ranked by a hash of each transcript id), spread across cases, the first of
    each case and then the second."""
    nth, keyed = Counter(), []
    for e in sorted(agree, key=lambda e: _hash("audit:" + e["id"])):
        keyed.append(((nth[e["case"]["id"]], _hash("audit:" + e["id"])), e))
        nth[e["case"]["id"]] += 1
    return [e for _, e in sorted(keyed, key=lambda x: x[0])][:n]


def disagreements(ask=input, audit=AUDIT_N):
    """Label every run whose adopted label and current verdict disagree, plus runs where they agree until you
    have audited `audit` of them in all (so running it again doesn't keep adding audits), in one mixed list so
    you can't tell which is which. Shown blind like every mode: never the judge's verdict, never the adopted
    label. Full mode: the overall verdict, then each dimension. Your label wins over the adopted one for that
    run; the adopted one stays in the file."""
    data, store = load(), load_store()
    dis, agree, stale = review(data["labels"], store)
    audit = max(0, audit - sum(1 for lb in _owner(data["labels"]).values() if lb.get("queue") == "audit"))
    if stale:
        print(f"{len(stale)} run{'s' if len(stale) != 1 else ''} with an adopted label and no verdict from judge version "
              f"{judge.VERSION}: re-judge first: make evals-calibrate REJUDGE=1")
        for e in stale:
            print(f"  {e['case']['id']} run {e.get('run')} (transcript {e['id'][:8]})")
    todo = sorted(dis + audit_pick(agree, audit), key=lambda e: _hash("order:" + e["id"]))
    if ONLY:
        todo = [e for e in todo if any(e["id"].startswith(p) for p in ONLY)]
    if not todo:
        print(f"Nothing to adjudicate: no run with an adopted label and no label of yours disagrees with judge "
              f"version {judge.VERSION}, and none is left to audit.")
        return 0
    print(f"{len(todo)} run{'s' if len(todo) != 1 else ''} to label. For each, read what good looks like and the "
          "transcript, then give the overall verdict and each dimension. The judge's verdict and the second model's "
          "label stay hidden.")
    session = []
    for k, e in enumerate(todo, 1):
        _show(e, k, len(todo))
        lab = _label_full(e, ask)
        if lab == "quit":
            break
        if lab != "skip":
            session.append((e, _keep(e, lab, data, store)))
    _session_summary(session, quick=False)
    return len(session)


def _refusal_without_pills(tr):
    """A turn that says it can't do something and ends with no pills: no next move after a refusal."""
    for turn in tr:
        blocks = [s for s in turn.get("steps") or [] if "block" in s]
        words = " ".join(str(b["shows"].get("md") or b["shows"].get("text") or "") for b in blocks
                         if isinstance(b.get("shows"), dict))
        if blocks and blocks[-1]["block"] not in ("prompt_pills", "approval") and REFUSAL.search(words):
            return True
    return False


def _unasked_write(tr):
    """A write the user sees, called in a turn whose words never ask for one. A tap on an approval card asks."""
    return any(any(s.get("tool") in WRITES for s in turn.get("steps") or [])
               and not (turn.get("user") or "").startswith(judge.TAPPED) and not ASKED.search(turn.get("user") or "")
               for turn in tr)


def _hardness(e):
    """((has no current verdict, rank), why) for quick mode: rank 0 is the hardest call, 4 an ordinary run."""
    v = e.get("verdict") or {}
    current = v.get("version") == judge.VERSION and "error" not in v
    if (current and isinstance(e.get("code_ok"), bool) and isinstance(v.get("meets_expectation"), bool)
            and v["meets_expectation"] != e["code_ok"]):
        return (0, 0), "the judge and the code check disagree"
    low = judge.gate_failures(e["case"], v) if current else []
    if low:
        return (0, 1), f"{low[0]} scored {judge.dimension_score(v, low[0])}, below {judge.PASS_AT}"
    if _refusal_without_pills(e["transcript"]):
        return (0 if current else 1, 2), "a refusal with no pills"
    if _unasked_write(e["transcript"]):
        return (0 if current else 1, 3), "a write the user didn't ask for"
    return (0 if current else 1, 4), "an ordinary run" if current else "no verdict from this judge yet"


def quick_order(todo, picked=()):
    """Hard calls first: runs where the judge and the code check disagree, then a gating dimension below 4, a
    refusal with no pills, an unasked write, then the rest. Within each, spread across cases, so five picks
    aren't one case five times. Runs with no verdict from the current judge come last: their agreement can't
    be shown at the end."""
    try:
        order = {c["id"]: i for i, c in enumerate(_cases())}
    except Exception:
        order = {}
    taken, seen, keyed = Counter(e["case"]["id"] for e in picked), Counter(), []
    for i, e in enumerate(todo):
        hard, cid = _hardness(e)[0], e["case"]["id"]
        keyed.append(((hard, taken[cid] + seen[(hard, cid)], order.get(cid, len(order)), i), e))
        seen[(hard, cid)] += 1
    return [e for _, e in sorted(keyed, key=lambda x: x[0])]


def _session_summary(session, quick):
    """After the session, now the verdicts can be shown: agreement on the labels just made, and every
    disagreement with the judge's reason."""
    if not session:
        return
    store = load_store()
    graded = [(e, lb, _current(store, lb)) for e, lb in session if _current(store, lb)]
    n_agree = 0
    print(f"\nThe judge's verdicts on the {len(session)} run{'s' if len(session) != 1 else ''} you just labeled:")
    for e, lb, v in graded:
        diffs = [(what, mine) for what, mine, theirs in _comparisons(lb, v) if mine != theirs]
        n_agree += not diffs
        why = f" ({_hardness(e)[1]})" if quick else ""
        print(f"  {lb['case']} run {lb.get('run')}{why}: " + ("agrees" if not diffs else "disagrees"))
        for what, mine in diffs:
            _print_disagreement({"label": lb, "verdict": v, "what": what,
                                 "kind": "false_pass" if mine else "false_fail"}, indent="    ")
    print(f"Agreement: {n_agree} of {len(graded)} run{'s' if len(graded) != 1 else ''}"
          + (" (every rating in the label matches the judge)" if graded else ""))
    if len(graded) < len(session):
        print(f"{len(session) - len(graded)} have no verdict from this judge yet: make evals-calibrate REJUDGE=1.")
    if quick:
        print(f"{QUICK_N} labels show the method; a gate needs {GATE_LABELS} on each gating dimension, at {GATE_PCT}% "
              "agreement and no consent false pass. These count toward it: make evals-calibrate REPORT=1.")


# ── re-judging what's labeled ────────────────────────────────────────────────

def rejudge(path=None, store_path=None, workers=REJUDGE_WORKERS):
    """Grade every labeled transcript that has no verdict from the current judge, with the current judge
    (live). Saves after each verdict; a judge error is listed and stores nothing, so the next run tries again."""
    data, store = load(path), load_store(store_path)
    labeled = list(dict.fromkeys(lb.get("transcript") for lb in data["labels"] if lb.get("transcript")))
    todo = [i for i in labeled if i in store and judge.VERSION not in store[i].get("verdicts", {})]
    if not todo:
        print(f"Every labeled transcript already has a verdict from judge version {judge.VERSION}.")
        return 0
    print(f"Re-judging {len(todo)} labeled transcript{'s' if len(todo) != 1 else ''} with judge version "
          f"{judge.VERSION} (live, about ${_cost(len(todo), store):.2f})...")
    done, errors, cost = 0, [], 0.0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(judge.judge_transcript, store[i]["case"], store[i]["transcript"]): i for i in todo}
        for job in as_completed(jobs):
            i, v = jobs[job], job.result()
            v.pop("transcript", None)
            cost += v.get("cost_usd", 0)
            if "error" in v:
                errors.append((i, v["error"]))
                continue
            store[i].setdefault("verdicts", {})[judge.VERSION] = v
            save_store(store, store_path)
            done += 1
    print(f"Re-judged {done} of {len(todo)} (${cost:.2f} at Opus 5.5 list prices, not billing).")
    for i, err in errors:
        print(f"  judge error, {store[i]['case']['id']} transcript {i}: {err}")
    return done


def main():
    ap = argparse.ArgumentParser(description="Calibrate the LLM judge against your own labels")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--label", action="store_true", help="label judged runs from the pool, one at a time")
    mode.add_argument("--report", action="store_true", help="agreement with the judge, per dimension, and the gate")
    mode.add_argument("--rejudge", action="store_true",
                      help="re-judge every labeled transcript with the current judge (live, cents a transcript)")
    ap.add_argument("--quick", action="store_true", help="with --label: five hard calls, one key each")
    ap.add_argument("--disagreements", action="store_true",
                    help="with --label: only the runs where the adopted label and the judge disagree, plus an audit")
    ap.add_argument("--audit", type=int, default=AUDIT_N,
                    help=f"with --disagreements: this many runs where they agree, to audit (default {AUDIT_N})")
    ap.add_argument("--only", default="", help="with --label: only these runs, comma-separated id prefixes")
    ap.add_argument("--follow", action="store_true", help="with --label: label runs as a live eval run judges them")
    ap.add_argument("--quiet", type=int, default=QUIET_S, help="with --follow: stop after this many quiet seconds")
    args = ap.parse_args()
    ONLY.update(x.strip() for x in (args.only or "").split(",") if x.strip())
    if args.rejudge:
        if not (settings.ANTHROPIC_API_KEY or "").strip() or settings.ANTHROPIC_API_KEY == "test-key":
            sys.exit("--rejudge calls the judge live and needs ANTHROPIC_API_KEY in backend/.env")
        rejudge()
    elif args.label and args.disagreements:
        disagreements(audit=args.audit)
    elif args.label and args.quick:
        quick(follow=args.follow, quiet_s=args.quiet)  # it prints its own summary; REPORT=1 has the rest
        return
    elif args.label:
        label(follow=args.follow, quiet_s=args.quiet)
    report()


if __name__ == "__main__":
    main()
