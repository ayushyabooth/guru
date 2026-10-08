"""
The graded eval score (GUR-268): one number, 0-100, for how good the agent's answers are.

Quality first, safety as a gate. rubrics.yaml holds a rubric per case (weighted criteria: code checks,
judge dimensions and latency curves) and the areas with their weights, and explains each kind. From
the bottom up: a run scores the weighted share of its criteria met, zero when a gate criterion fails
or the scenario crashed; a case scores the mean of its runs; an area the mean of its cases; and the
topline is the weighted mean of the areas. The safety gate is the Issues tab's own
(app/routes/admin_issues.py): run.py prints it beside the number and never averages it in. A new
case that has no rubric yet never stops the score: it is scored on its pass or fail, with a warning.

An offline run scores its T1 cases only, says so, and is compared only with the T1 part of the
baseline. A live run is compared with the live baseline. Either way the baseline is scored again here,
from its stored runs and under these same weights, so the two numbers always share a weights version.
Judge criteria count only once the judge is calibrated (calibrate.judge_gates()). Until then the score
is code-graded, and the judge's means print beside it, report-only.
"""
import hashlib
import json
import math
import os
import re
import statistics

import yaml

from evals import judge

HERE = os.path.dirname(os.path.abspath(__file__))
RUBRICS = os.path.join(HERE, "rubrics.yaml")
KINDS = ("code", "judge", "latency")
CODE_FORMS = ("check", "absent", "count")
# A scenario's detail can quote the screen after these words (PLAN-07). Criteria read only the words
# before them, so the agent's own text can never pass or fail a code check.
QUOTE = "The user saw:"
DROP = 5  # an area this many points or more under the baseline is flagged
# A case that has no rubric yet (new cases arrive before theirs): its run's own pass or fail, and a warning.
DEFAULT_RUBRIC = [{"name": "the run passes", "kind": "code", "check": "run", "weight": 1, "gate": False}]


def whole(x):
    """A score as people read it: a whole number, halves up, the way the app's Math.round shows it too."""
    return int(math.floor(x + 0.5))


def _show(x):
    return "n/a" if x is None else str(whole(x))


def _r1(x):
    return None if x is None else round(x, 1)


def _number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# ── rubrics.yaml ─────────────────────────────────────────────────────────────

def load(path=RUBRICS):
    """The rubrics and areas, checked, with each criterion's defaults filled in (weight 1, no gate)."""
    with open(path) as f:
        data = yaml.safe_load(f) or {}
    wrong = problems(data)
    if wrong:
        raise ValueError(f"{os.path.basename(path)}: " + "; ".join(wrong))
    for rubric in data["cases"].values():
        for c in rubric:
            c.setdefault("weight", 1)
            c["gate"] = bool(c.get("gate", False))
    return data


def problems(data):
    """What's wrong with a parsed rubrics.yaml, in words. Empty when it's sound."""
    out, keys, taken, total = [], set(), {}, 0
    areas = data.get("areas") if isinstance(data, dict) else None
    if not isinstance(areas, list) or not areas:
        return ["no areas"]
    for a in areas:
        key = a.get("key") if isinstance(a, dict) else None
        if not key or key in keys:
            out.append(f"area {key!r} needs a key of its own")
            continue
        keys.add(key)
        if not a.get("label"):
            out.append(f"area {key} has no label")
        if not _number(a.get("weight")) or a["weight"] < 0:
            out.append(f"area {key}: weight must be a number, 0 or more")
        else:
            total += a["weight"]
        if not a.get("case_areas"):
            out.append(f"area {key} takes no case areas")
        for ca in a.get("case_areas") or []:
            if ca in taken:
                out.append(f"the case area {ca!r} is in both {taken[ca]} and {key}")
            taken[ca] = key
    if total != 100:
        out.append(f"the area weights add up to {total:g}, not 100")
    cases = data.get("cases")
    if not isinstance(cases, dict) or not cases:
        return out + ["no cases"]
    for cid, rubric in cases.items():
        if not isinstance(rubric, list) or not rubric:
            out.append(f"{cid} has no criteria")
            continue
        counted = False
        for c in rubric:
            name = c.get("name") if isinstance(c, dict) else None
            if not name:
                out.append(f"{cid}: a criterion has no name")
                continue
            where, kind, forms = f"{cid} {name!r}", c.get("kind"), [f for f in CODE_FORMS if f in c]
            if kind not in KINDS:
                out.append(f"{where}: kind must be one of {', '.join(KINDS)}")
                continue
            weight = c.get("weight", 1)
            if not _number(weight) or weight < 0:
                out.append(f"{where}: weight must be a number, 0 or more")
            if c.get("gate") not in (None, True, False):
                out.append(f"{where}: gate is true or false")
            elif c.get("gate") and kind != "code":
                out.append(f"{where}: only a code criterion can be a gate")
            if kind == "code":
                if len(forms) != 1:
                    out.append(f"{where}: a code criterion takes exactly one of check, absent or count")
                elif forms == ["check"] and c["check"] != "run":
                    out.append(f"{where}: check takes run, the run's own pass or fail")
                elif forms == ["absent"] and not _phrases(c["absent"]):
                    out.append(f"{where}: absent takes words, or a list of them")
                elif forms == ["count"] and not (isinstance(c["count"], str) and c["count"].strip()):
                    out.append(f"{where}: count takes the words after \"<k> of <n>\"")
            elif forms:
                out.append(f"{where}: only a code criterion takes {forms[0]}")
            counted = counted or (kind != "judge" and _number(weight) and weight > 0)
        if not counted:
            out.append(f"{cid} needs a code or latency criterion with weight, so the code-graded score has "
                       "something to grade")
    return out


def _phrases(x):
    items = x if isinstance(x, list) else [x]
    return bool(items) and all(isinstance(p, str) and p.strip() for p in items)


def _area_of(rubrics):
    """Each case area in cases.yaml, to its score area's key."""
    return {ca: a["key"] for a in rubrics["areas"] for ca in a["case_areas"]}


def mismatches(rubrics, cases):
    """Where rubrics.yaml and cases.yaml contradict each other: a rubric for no case, a latency criterion on
    a case with no budget, a judge criterion on a case the judge never grades. A case with no rubric yet, or
    whose area no score area takes, is not one of these: it is scored anyway, with a warning (score_results)."""
    out, ids = [], {c["id"] for c in cases}
    for case in cases:
        for c in rubrics["cases"].get(case["id"]) or []:
            if c["kind"] == "latency" and "p95_ms" not in case:
                out.append(f"{case['id']} {c['name']!r}: a latency criterion needs p95_ms in cases.yaml")
            if c["kind"] == "judge" and not case.get("judge"):
                out.append(f"{case['id']} {c['name']!r}: the judge never grades this case")
    out += [f"{cid} has a rubric but isn't in cases.yaml" for cid in rubrics["cases"] if cid not in ids]
    return out


def version(rubrics, judge_counts=False):
    """The weights version printed beside the score: rubrics.yaml's content, score.py itself and, once judge
    criteria count, the judge's version, since its verdicts are then part of the number."""
    h = hashlib.sha256(json.dumps({"areas": rubrics["areas"], "cases": rubrics["cases"]}, sort_keys=True).encode())
    with open(os.path.abspath(__file__), "rb") as f:
        h.update(f.read())
    if judge_counts:
        h.update(f"judge {judge.VERSION}".encode())
    return h.hexdigest()[:12]


# ── one criterion, one run ───────────────────────────────────────────────────

def own_words(detail):
    """The scenario's own words in a run's detail, before any quote of what the user saw."""
    return ("" if detail is None else str(detail)).split(QUOTE, 1)[0]


def code_value(c, run):
    """A code criterion, 0 to 1. The run's own pass is the code check's verdict, before any judge gate."""
    if "check" in c:
        return 1.0 if run.get("code_ok", run.get("ok")) else 0.0
    if run.get("code_ok"):
        # The code check passed and the judge failed the run (judge_gates), so the detail now holds the
        # judge's reason. A passing detail names no failure: every sub-check was met.
        return 1.0
    words = own_words(run.get("detail"))
    if "absent" in c:
        phrases = c["absent"] if isinstance(c["absent"], list) else [c["absent"]]
        return sum(1 for p in phrases if p not in words) / len(phrases)
    m = re.search(rf"(\d+) of (\d+) {re.escape(c['count'])}", words)
    if m is None:
        return 1.0
    failed, n = int(m.group(1)), int(m.group(2))
    return max(0.0, (n - failed) / n) if n else 0.0  # nothing to check at all is a failure, not a pass


def latency_value(ms, budget):
    """Full marks at or under the budget, falling in a straight line to zero at twice it."""
    if ms is None:
        return 0.0
    return min(1.0, max(0.0, (2 * budget - ms) / budget))


def judge_score(verdict, dimension):
    """One dimension's 1-5 in a judge verdict, or None: no verdict, an error, or not applicable (null)."""
    if not isinstance(verdict, dict) or "error" in verdict:
        return None
    d = verdict.get(dimension)
    s = d.get("score") if isinstance(d, dict) else d
    return s if _number(s) and 1 <= s <= 5 else None


def run_score(rubric, run, case, judge_counts=False):
    """One run, 0 to 1: the weighted share of its criteria met. Zero when a gate criterion isn't fully met
    or the scenario crashed. A judge criterion counts only with judge_counts, and drops out when its
    dimension has no score."""
    if run.get("ok") is None:  # a crashed scenario is never a pass, nor part of one
        return 0.0
    total = got = 0.0
    for c in rubric:
        if c["kind"] == "judge":
            s = judge_score(run.get("judge"), c["name"]) if judge_counts else None
            v = None if s is None else (s - 1) / 4
        elif c["kind"] == "latency":  # no budget in cases.yaml, nothing to grade against (mismatches names it)
            v = latency_value(run.get("metric"), case["p95_ms"]) if case.get("p95_ms") else None
        else:
            v = code_value(c, run)
        if v is None:
            continue
        if c["gate"] and v < 1:
            return 0.0
        total += c["weight"]
        got += c["weight"] * v
    return got / total if total else 0.0


# ── a run of cases ───────────────────────────────────────────────────────────

def score_results(results, cases, rubrics, judge_counts=False):
    """Case, area and topline scores, 0-100 and unrounded, for a list of case results (run.py's, or the
    baseline's). New cases arrive before their rubrics, and one never stops the score: a case with no
    rubric is scored on its run's own pass or fail (DEFAULT_RUBRIC), and a case whose area no score area
    takes is scored but not weighed. Each comes back as a warning that names it."""
    by_id, area_of = {c["id"]: c for c in cases}, _area_of(rubrics)
    per_case, per_area, n_runs, warnings = {}, {a["key"]: [] for a in rubrics["areas"]}, 0, []
    for r in results:
        case, rubric = by_id.get(r["id"]) or {}, rubrics["cases"].get(r["id"])
        if rubric is None:
            rubric = DEFAULT_RUBRIC
            warnings.append(f"{r['id']} has no rubric in rubrics.yaml yet: scored on its pass or fail alone.")
        key = area_of.get(case.get("area"))
        if key is None:
            warnings.append(f"{r['id']}: its area {case.get('area')!r} is in no score area in rubrics.yaml, "
                            "so it is scored but not weighed.")
        runs = r.get("runs") or []
        n_runs += len(runs)
        s = 100 * statistics.mean(run_score(rubric, x, case, judge_counts) for x in runs) if runs else 0.0
        per_case[r["id"]] = s
        if key is not None:
            per_area[key].append(s)
    areas = [{"key": a["key"], "label": a["label"], "weight": a["weight"],
              "score": statistics.mean(per_area[a["key"]]) if per_area[a["key"]] else None}
             for a in rubrics["areas"]]
    counted = [(a["weight"], a["score"]) for a in areas if a["weight"] > 0 and a["score"] is not None]
    w = sum(weight for weight, _ in counted)
    return {"topline": sum(weight * s for weight, s in counted) / w if w else None, "areas": areas,
            "cases": per_case, "n_cases": len(per_case), "n_runs": n_runs, "warnings": warnings}


def judge_means(results):
    """Each judge dimension's mean over the judged runs, in the judge's own order, skipping errors and nulls.
    None when no run was judged."""
    verdicts = [x["judge"] for r in results for x in r.get("runs") or []
                if isinstance(x.get("judge"), dict) and "error" not in x["judge"]]
    if not verdicts:
        return None
    out = {}
    for k in judge.RUBRICS:
        s = [v for v in (judge_score(j, k) for j in verdicts) if v is not None]
        out[k] = round(statistics.mean(s), 1) if s else None
    return out


def score_run(results, cases, live, judge_counts=False, baseline=None, rubrics=None):
    """The score of one eval run, rounded to one decimal, as run.py prints, stores and uploads it.

    live: a live run scores everything it ran; an offline one only ever holds T1 cases.
    judge_counts: judge criteria count (calibrate.judge_gates() on a judged run). Otherwise they wait.
    baseline: the baseline's case results (baseline.json), scored again here under these weights."""
    rubrics = rubrics or load()
    cur = score_results(results, cases, rubrics, judge_counts)
    base = _against(results, baseline, cases, rubrics, live, judge_counts) if baseline else None
    return {
        "topline": _r1(cur["topline"]), "offline": not live, "version": version(rubrics, judge_counts),
        "judge_counts": bool(judge_counts), "n_cases": cur["n_cases"], "n_runs": cur["n_runs"],
        "areas": [dict(a, score=_r1(a["score"]), baseline=(base or {}).get("areas", {}).get(a["key"]))
                  for a in cur["areas"]],
        "cases": {cid: _r1(s) for cid, s in cur["cases"].items()},
        "baseline": base, "judge_means": judge_means(results), "warnings": cur["warnings"],
    }


def _against(results, baseline, cases, rubrics, live, judge_counts):
    """The baseline under the same weights: its results for the cases this run ran (offline, its T1 part
    only), scored again. None when it holds none of them."""
    ids = {r["id"] for r in results}
    base = [b for b in baseline if b.get("id") in ids and (live or b.get("tier") == "T1")]
    if not base:
        return None
    if judge_counts:
        # Judge verdicts are part of the number now; another judge's verdicts are another set of weights.
        other = {x["judge"].get("version") for b in base for x in b.get("runs") or [] if isinstance(x.get("judge"), dict)}
        if other - {judge.VERSION}:
            return {"topline": None, "areas": {}, "missing": [],
                    "why": "another version of the judge graded it, so it isn't under these weights"}
    scored = score_results(base, cases, rubrics, judge_counts)
    have, by_id, area_of = {b["id"] for b in base}, {c["id"]: c for c in cases}, _area_of(rubrics)
    weighted = {a["key"] for a in rubrics["areas"] if a["weight"] > 0}
    missing = [r["id"] for r in results
               if r["id"] not in have and area_of.get(by_id.get(r["id"], {}).get("area")) in weighted]
    return {"topline": _r1(scored["topline"]), "areas": {a["key"]: _r1(a["score"]) for a in scored["areas"]},
            "missing": missing}


# ── the printout and the upload ──────────────────────────────────────────────

def gate_text(gate):
    """What blocks the ship gate, in the Issues tab's own words: "INJ-04 stays red, INJ-01 1 of 5; regressions: STEP-07"."""
    return "; ".join(r["text"] if r["kind"] == "safety" else f"{r['kind']}: {r['text']}"
                     for r in (gate or {}).get("reasons", []) if not r.get("ok"))


def drops(sc):
    """The areas that fell DROP points or more since the baseline: (label, was, now), in whole points."""
    out = []
    for a in sc["areas"]:
        if a["weight"] > 0 and a["score"] is not None and a.get("baseline") is not None \
                and whole(a["score"]) - whole(a["baseline"]) <= -DROP:
            out.append((a["label"], whole(a["baseline"]), whole(a["score"])))
    return out


def lines(sc, gate=None):
    """The block run.py prints first, before the case table: the score beside the safety gate, the areas,
    the counts and the weights version, a line for each case scored without its rubric, any area down DROP
    or more since the baseline, and the judge's means while they are report-only."""
    top, b = sc["topline"], sc.get("baseline") or {}
    head = f"Guru eval score {_show(top)}/100" if top is not None else "Guru eval score n/a (no weighted case ran)"
    notes = ["offline, T1 only"] if sc["offline"] else []
    if b.get("topline") is not None and top is not None:
        notes.append(f"baseline {whole(b['topline'])}, {whole(top) - whole(b['topline']):+d}")
    elif b.get("why"):
        notes.append(f"baseline not compared: {b['why']}")
    if notes:
        head += f" ({'; '.join(notes)})"
    if gate:
        why = gate_text(gate)
        head += f"   safety gate: {gate['state'].upper()}" + (f"  {why}" if why else "")
    out = [head, "  " + " · ".join(f"{a['label']} {_show(a['score'])}" for a in sc["areas"] if a["weight"] > 0)]
    n, k = sc["n_cases"], sc["n_runs"]
    counts = f"  {n} case{'s' if n != 1 else ''}, {k} run{'s' if k != 1 else ''}, weights {sc['version']}."
    for a in sc["areas"]:
        if a["weight"] == 0 and a["score"] is not None:
            counts += f" {a['label'][0].upper() + a['label'][1:]} {_show(a['score'])}, no weight."
    if b.get("missing"):
        counts += f" The baseline has no run of {', '.join(b['missing'])}."
    out.append(counts)
    out += [f"  warning: {w}" for w in sc.get("warnings") or []]
    fell = drops(sc)
    if fell:
        out.append(f"  down {DROP} or more since the baseline: "
                   + ", ".join(f"{label} {was} to {now} ({now - was:+d})" for label, was, now in fell))
    jm = sc.get("judge_means")
    if jm:
        means = " · ".join(f"{k} {v:.1f}" for k, v in jm.items() if v is not None)
        out.append(f"  judge, {'counted in the score' if sc['judge_counts'] else 'report-only until calibrated'}: "
                   + (means or "no dimension scored"))
    return out


def upload(sc):
    """The score as POST /admin/eval-runs takes it (admin_issues.ScoreIn): the topline, the baseline's topline
    under the same weights, the weights version and each area. None when there is no score to send."""
    if not sc or "error" in sc or sc.get("topline") is None:
        return None
    return {"topline": sc["topline"], "baseline": (sc.get("baseline") or {}).get("topline"),
            "weights_version": sc["version"],
            "areas": [{k: a[k] for k in ("key", "label", "weight", "score", "baseline")} for a in sc["areas"]]}
