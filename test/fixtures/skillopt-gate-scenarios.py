"""Gate scenarios for the vendored SkillOpt-Sleep engine (run by test/skillopt-sleep-gate.test.js).

Ported from upstream microsoft/SkillOpt tests/test_sleep_engine.py::TestVerifierDiscipline
(MIT). Each scenario runs the real ``consolidate`` with a scripted backend and prints the
measured numbers as one JSON line, so the Node test can assert the baseline score, the
candidate score and gate_action separately -- not only whether the edit was adopted.

  usage: python -I test/fixtures/skillopt-gate-scenarios.py <vendor dir>
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, sys.argv[1])

from skillopt_sleep.backend import MockBackend  # noqa: E402
from skillopt_sleep.consolidate import consolidate  # noqa: E402
from skillopt_sleep.replay import aggregate_scores, replay_batch  # noqa: E402
from skillopt_sleep.types import EditRecord, TaskRecord  # noqa: E402

HACK = "Always emit placeholder URLs"
GOOD = "Always think step-by-step"
PARTIAL = "Always respond with a definitive answer"


def _ctx(skill, memory):
    return (skill or "") + "\n" + (memory or "")


class RewardHacking(MockBackend):
    """Train 0 -> 1, held-out 1 -> 0: the edit games the train task and breaks the real one."""

    def attempt(self, task, skill, memory, sample_id=0):
        if HACK in _ctx(skill, memory):
            return str(task.reference) if "rule:train" in task.tags else "placeholder URL"
        return "I am missing input" if "rule:train" in task.tags else str(task.reference)

    def reflect(self, failures, successes, skill, memory, **kwargs):
        return [EditRecord("skill", "add", HACK, rationale="shortcut")] if failures else []


class Beneficial(MockBackend):
    """Train 0 -> 1 and held-out 0 -> 1: a real improvement."""

    def attempt(self, task, skill, memory, sample_id=0):
        if GOOD in _ctx(skill, memory):
            return str(task.reference)
        return "I am missing input" if "rule:train" in task.tags else "baseline fails too"

    def reflect(self, failures, successes, skill, memory, **kwargs):
        return [EditRecord("skill", "add", GOOD, rationale="beneficial")] if failures else []


class FractionalDegradation(MockBackend):
    """Train 0 -> 1 but held-out 1.0 -> 0.5 (one of two val tasks breaks)."""

    def attempt(self, task, skill, memory, sample_id=0):
        if PARTIAL in _ctx(skill, memory):
            if "rule:train" in task.tags:
                return str(task.reference)
            return str(task.reference) if task.id == "v1" else "misleading answer"
        return "I am missing input" if "rule:train" in task.tags else str(task.reference)

    def reflect(self, failures, successes, skill, memory, **kwargs):
        return [EditRecord("skill", "add", PARTIAL, rationale="confidence")] if failures else []


def task(tid, split, reference, tag):
    return TaskRecord(id=tid, project="/p", intent=split, reference=reference,
                      reference_kind="exact", tags=[tag], split=split)


def run(name, backend, tasks, edit_text):
    train = [t for t in tasks if t.split == "train"]
    val = [t for t in tasks if t.split == "val"]
    # Measure the candidate directly on both splits: the gate must see the held-out drop.
    train_base, _ = aggregate_scores(replay_batch(backend, train, "", ""))
    train_cand, _ = aggregate_scores(replay_batch(backend, train, edit_text, ""))
    val_cand, _ = aggregate_scores(replay_batch(backend, val, edit_text, ""))
    res = consolidate(backend, tasks, "", "", edit_budget=4, gate_metric="hard", night=1)
    trials = [t for t in res.gate_trials if t.get("target") != "final"]
    final = next((t for t in res.gate_trials if t.get("target") == "final"), {})
    print(json.dumps({
        "scenario": name,
        "accepted": res.accepted,
        "gate_action": res.gate_action,
        "baseline_score": res.baseline_score,
        "candidate_score": res.candidate_score,
        "holdout_baseline": res.holdout_baseline,
        "holdout_candidate": res.holdout_candidate,
        "train_baseline": train_base,
        "train_candidate": train_cand,
        "holdout_candidate_measured": val_cand,
        "trial_scores": [[t.get("baseline_score"), t.get("candidate_score"), t.get("accepted")] for t in trials],
        "final_trial": [final.get("baseline_score"), final.get("candidate_score"), final.get("accepted")],
        "applied": [e.content for e in res.applied_edits],
        "rejected": [e.content for e in res.rejected_edits],
        "holdout_detail": len(res.holdout_detail),
    }, ensure_ascii=False))


run("reward_hacking", RewardHacking(),
    [task("t1", "train", "XYZABC", "rule:train"), task("v1", "val", "PQRSTU", "rule:real")], HACK)
run("beneficial", Beneficial(),
    [task("t2", "train", "ABCDEF", "rule:train"), task("v2", "val", "UVWXYZ", "rule:real")], GOOD)
run("fractional_degradation", FractionalDegradation(),
    [task("t3", "train", "ABC", "rule:train"), task("v1", "val", "DEF", "rule:real"), task("v2", "val", "GHI", "rule:real")], PARTIAL)
