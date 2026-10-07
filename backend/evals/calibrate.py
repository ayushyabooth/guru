"""
Calibrate the LLM judge against your own labels.

    python -m evals.calibrate --label     # label the runs of the latest judged eval run, then see the agreement
    python -m evals.calibrate --report    # how often the judge agrees with your labels, per case, and the gate

The latest judged run is out/latest_judged.json: run.py copies out/latest.json there after a live run
with the judge, so a T1 run in between doesn't take the transcripts away before you label them.

The judge (judge.py) is report-only until it agrees with at least 20 of your labels at least 85% of
the time and you set judge_gates: true in calibration.yaml. Label each run from its transcript against
the case's expectation, in the wording the judge read (a later edit to cases.yaml doesn't change
it); the judge's verdict stays hidden until you finish, so it can't anchor you. A label keeps the judge's verdict and version from the run it labels: once the judge changes (its
prompt, schema, model or effort), labels made against the old one stop counting toward the gate.
"""
import argparse
import json
import os
from datetime import datetime

import yaml

from evals import judge

HERE = os.path.dirname(os.path.abspath(__file__))
LATEST = os.path.join(HERE, "out", "latest_judged.json")
LABELS = os.path.join(HERE, "calibration.yaml")
GATE_LABELS, GATE_PCT = 20, 85

# Kept word for word at the top of calibration.yaml, which save() rewrites.
HEADER = """\
# LLM judge calibration: your own pass/fail labels on judged live runs, and the gate.
#
#   make evals-calibrate            label the runs of the latest judged eval run: p pass, f fail, s skip, plus a note
#   make evals-calibrate REPORT=1   agreement between these labels and the judge, per case, and the gate
#
# judge_gates: false keeps the judge report-only. Only the owner sets it to true, and only after the
# report says the gate is met: at least 20 labels, at least 85% agreement with the judge. From then
# on a live run passes only if the code check and the judge both pass.
#
# Each label keeps the judge's verdict and version from the run it labels, so labels made against
# another judge version (a changed prompt, schema, model or effort) don't count toward the gate.
# calibrate.py rewrites this file each time it saves a label: comments added here are not kept.
"""
KEYS = {"p": "pass", "pass": "pass", "f": "fail", "fail": "fail", "s": "skip", "skip": "skip",
        "q": "quit", "quit": "quit"}


# ── the labels file ──────────────────────────────────────────────────────────

def load(path=LABELS):
    """{"judge_gates": bool, "labels": [...]}; no file is an empty one."""
    if not os.path.exists(path):
        return {"judge_gates": False, "labels": []}
    with open(path) as f:
        data = yaml.safe_load(f) or {}
    return {"judge_gates": data.get("judge_gates") is True, "labels": list(data.get("labels") or [])}


def save(data, path=LABELS):
    """Rewrite the file through a temp file, so a crash mid-write never costs a label already made."""
    body = yaml.safe_dump({"judge_gates": bool(data["judge_gates"]), "labels": data["labels"]},
                          sort_keys=False, allow_unicode=True, width=110)
    with open(path + ".tmp", "w") as f:
        f.write(HEADER + body)
    os.replace(path + ".tmp", path)


def judge_gates(path=LABELS):
    """True only when the owner has set judge_gates: true. An unreadable file never turns the judge on."""
    try:
        return load(path)["judge_gates"]
    except Exception:
        return False


# ── agreement and the gate ───────────────────────────────────────────────────

def agreement(labels, version=None):
    """How often the judge's verdict matched the owner's label, over the labels made against this judge."""
    version = version or judge.VERSION
    cur = [lb for lb in labels if lb.get("judge_version") == version and lb.get("label") in ("pass", "fail")]
    per_case = {}
    for lb in cur:
        a = per_case.setdefault(lb.get("case"), [0, 0])
        a[0] += lb["label"] == lb.get("judge")
        a[1] += 1
    n, agree = len(cur), sum(a for a, _ in per_case.values())
    return {"n": n, "agree": agree, "per_case": per_case, "stale": len(labels) - n,
            "disagree": [lb for lb in cur if lb["label"] != lb.get("judge")],
            "met": n >= GATE_LABELS and agree * 100 >= GATE_PCT * n}


def _pct(s):
    return f"{100 * s['agree'] / s['n']:.1f}%"


def status(path=LABELS):
    """One line for the eval report on where calibration stands."""
    data = load(path)
    s = agreement(data["labels"])
    have = f"{s['n']} label{'s' if s['n'] != 1 else ''}" + (f", {s['agree']} agree ({_pct(s)})" if s["n"] else "")
    if data["judge_gates"]:
        return have + ("; judge_gates is true" if s["met"] else
                       f"; judge_gates is true, but the gate needs {GATE_LABELS} labels at {GATE_PCT}%")
    if s["met"]:
        return have + ": the gate is met. Set judge_gates: true in evals/calibration.yaml to let the judge count"
    return have + f"; the gate needs {GATE_LABELS} at {GATE_PCT}% (label with make evals-calibrate)"


def report(path=LABELS):
    data = load(path)
    s = agreement(data["labels"])
    print(f"\nLLM judge calibration: {judge.MODEL}, judge version {judge.VERSION}")
    stale = f" ({s['stale']} more against another judge version, not counted)" if s["stale"] else ""
    if not s["n"]:
        print(f"  no labels for this judge yet{stale}. Run make evals LIVE=1, then make evals-calibrate.")
    else:
        print(f"  labels: {s['n']}{stale}")
        print(f"  agreement: {s['agree']}/{s['n']} ({_pct(s)})")
        for case, (a, n) in sorted(s["per_case"].items()):
            print(f"    {case:<8} {a}/{n}")
        if s["disagree"]:
            print("  disagreements, where the judge needs work:")
            for lb in s["disagree"]:
                print(f"    {lb['case']} run {lb.get('run')} of {lb.get('run_at')}: you said {lb['label']}, "
                      f"the judge said {lb.get('judge')}. The judge: {lb.get('judge_reason') or '-'}")
                if lb.get("note"):
                    print(f"      your note: {lb['note']}")
    if s["met"]:
        gate = (f"met: {s['n']} labels at {_pct(s)}. " + ("judge_gates is true, so the judge counts." if data["judge_gates"]
                else "To let the judge count toward live verdicts, set judge_gates: true in evals/calibration.yaml."))
    else:
        gate = (f"not met: it needs {GATE_LABELS} labels at {GATE_PCT}% agreement or better, and this judge has "
                f"{s['n']}" + (f" at {_pct(s)}" if s["n"] else ""))
        if data["judge_gates"]:
            gate += ". judge_gates is true anyway, so the judge already counts toward live verdicts"
    print(f"  gate {gate}")
    print(f"  judge_gates: {'true' if data['judge_gates'] else 'false'} (only you change it, in {os.path.relpath(path)})")


# ── labeling ─────────────────────────────────────────────────────────────────

def judged_runs(latest):
    """(case result, run number, run) for every run the judge graded, with the transcript it graded."""
    return [(r, n, x) for r in latest.get("results", []) for n, x in enumerate(r.get("runs", []), 1)
            if x.get("transcript") and x.get("judge") and "error" not in x["judge"]]


def _expectations():
    with open(os.path.join(HERE, "cases.yaml")) as f:
        return {c["id"]: c.get("expect", "") for c in yaml.safe_load(f)}


def _ask(ask):
    while True:
        try:
            raw = ask("p pass, f fail, s skip, q quit; a note can follow (f never pointed to Notes): ")
        except (EOFError, KeyboardInterrupt):
            print()
            return "quit", ""
        word, _, note = raw.strip().partition(" ")
        if word.lower() in KEYS:
            return KEYS[word.lower()], note.strip()
        print("Type p, f, s or q, then an optional note.")


def label(latest_path=LATEST, path=LABELS, ask=input):
    """Walk the judged runs with no label yet, one at a time. Saves after each label, so quitting loses nothing."""
    if not os.path.exists(latest_path):
        print(f"No {os.path.relpath(latest_path)} yet. Run make evals LIVE=1 first.")
        return 0
    with open(latest_path) as f:
        latest = json.load(f)
    data, at = load(path), latest.get("at")
    done = {(lb.get("run_at"), lb.get("case"), lb.get("run")) for lb in data["labels"]}
    todo = [(r, n, x) for r, n, x in judged_runs(latest) if (at, r["id"], n) not in done]
    if not todo:
        print(f"Nothing to label in {os.path.relpath(latest_path)} (the run at {at}): "
              "every judged run there has a label, or the run had no judge. Run make evals LIVE=1 for more.")
        return 0
    expect = _expectations()
    print(f"{len(todo)} judged run{'s' if len(todo) != 1 else ''} to label from the eval run at {at}. Read what good "
          "looks like and the transcript: p if the run meets it, f if it doesn't. The judge's verdict stays hidden.")
    count = 0
    for k, (r, n, x) in enumerate(todo, 1):
        j = x["judge"]
        # The judge's own wording when it recorded one, so the owner and the judge answer the same question.
        shown = j.get("expect") or expect.get(r["id"]) or "(no longer in cases.yaml)"
        print(f"\n[{k}/{len(todo)}] {r['id']} run {n}: {r.get('title', '')}")
        print(f"What good looks like: {shown}\n")
        print(judge.render(x["transcript"]))
        key, note = _ask(ask)
        if key == "quit":
            break
        if key == "skip":
            continue
        data["labels"].append({
            "case": r["id"], "run": n, "run_at": at, "label": key, "note": note, "expect": shown,
            "judge": "pass" if j["meets_expectation"] else "fail", "judge_reason": j.get("reason", ""),
            "judge_version": j.get("version"), "labeled_at": datetime.now().isoformat(timespec="seconds"),
        })
        save(data, path)
        count += 1
    print(f"\nLabeled {count} run{'s' if count != 1 else ''}; the labels are in {os.path.relpath(path)}.")
    return count


def main():
    ap = argparse.ArgumentParser(description="Calibrate the LLM judge against your own labels")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--label", action="store_true", help="label the runs of the latest judged eval run, one at a time")
    mode.add_argument("--report", action="store_true", help="agreement between your labels and the judge, and the gate")
    args = ap.parse_args()
    if args.label:
        label()
    report()


if __name__ == "__main__":
    main()
