r"""Measure the deep check (app/deep_check_core.py) before it may correct answers (DEEP_CHECK=apply).

fixtures: the 99 practice syllables x 2 Taiwan voices, said right. Each clip is checked three ways:
- right: against its own syllable. A part the live check missed and the deep check fixes is a good fix.
- near: against a syllable with a close initial (b for p, n for l...). The clip is a real miss: a fix here is a wrong fix.
- far: against a syllable with another initial and final. A fix here is a clearly wrong fix.
It also checks two sentences with the 3-3 tone rule. Needs the speech model.

db: for one user, the stored verdicts on syllable cards that later got a typed Pinyin check. The typed check is the truth:
precision and recall per pair (kind, expected, heard).

Rule before apply mode: precision 0.9 or more on 30 or more typed checks, and no far fix. Check local and VPS separately.

Run: .venv\Scripts\python tools\eval_deep_check.py fixtures [--limit N]
     .venv\Scripts\python tools\eval_deep_check.py db --user USER_ID
"""

import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FRONT = ROOT.parent / "frontend"
VOICES = {"female": FRONT / "public/audio/syllables", "male": ROOT / "tests/fixtures/male"}
NEAR = {
    "ㄅ": "ㄆ",
    "ㄆ": "ㄅ",
    "ㄉ": "ㄊ",
    "ㄊ": "ㄉ",
    "ㄍ": "ㄎ",
    "ㄎ": "ㄍ",
    "ㄗ": "ㄘ",
    "ㄘ": "ㄙ",
    "ㄙ": "ㄗ",
    "ㄓ": "ㄔ",
    "ㄔ": "ㄕ",
    "ㄕ": "ㄓ",
    "ㄐ": "ㄑ",
    "ㄑ": "ㄒ",
    "ㄒ": "ㄐ",
    "ㄋ": "ㄌ",
    "ㄌ": "ㄋ",
    "ㄇ": "ㄅ",
}


def load(p: Path) -> np.ndarray:
    a, sr = sf.read(p, dtype="float32")
    a = a.mean(1) if a.ndim > 1 else a
    n = int(len(a) * 16000 / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)


def deep(res: dict):
    from app import deep_check, deep_check_core
    from app.asr import recognizer

    lp, has_ref = res.pop("_lp", None), res.pop("_has_ref", False)
    if not deep_check.wanted({**res, "_lp": lp}):
        return None
    job = deep_check.make_job(None, 0, res, lp, has_ref, [])["check"]
    job["vocab"] = recognizer.vocab
    return deep_check_core.check(job)


def fixtures(limit: int | None) -> None:
    from app import pitch, scoring
    from app.asr import recognizer
    from app.zhuyin import analyze_text

    recognizer._load()
    assert recognizer.ready, recognizer.error
    items = [
        it
        for it in json.loads((FRONT / "public/data/syllables.json").read_text(encoding="utf-8"))
        if "˙" not in it["zhuyin"]
    ]
    items = items[:limit] if limit else items
    parts_of = {}
    for it in items:
        e = analyze_text(it["char"])[0]
        parts_of[it["char"]] = (e.get("initial") or "", e.get("final") or "")
    by_initial = defaultdict(list)
    for it in items:
        by_initial[parts_of[it["char"]][0]].append(it)
    out = {k: Counter() for k in ("right", "near", "far")}
    fixes = {k: Counter() for k in ("right", "near", "far")}
    secs = []
    rng = np.random.default_rng(1)
    for voice, d in VOICES.items():
        clips = {it["id"]: load(d / f"{it['id']}.mp3") for it in items}
        ref = float(np.median(np.concatenate([f[f > 0] for f in (pitch.track(a) for a in clips.values())])))
        for it in items:
            ini, fin = parts_of[it["char"]]
            near = next((x for x in by_initial.get(NEAR.get(ini, ""), []) if parts_of[x["char"]][1] == fin), None)
            fars = [
                x for x in items if parts_of[x["char"]][0] not in (ini, NEAR.get(ini)) and parts_of[x["char"]][1] != fin
            ]
            far = fars[int(rng.integers(len(fars)))] if fars else None
            for kind, target in (("right", it), ("near", near), ("far", far)):
                if target is None:
                    continue
                res = scoring.analyze(clips[it["id"]], target["char"], ref)
                t0 = time.perf_counter()
                v = deep(res)
                if v is None:
                    out[kind]["not checked"] += 1
                    continue
                secs.append(time.perf_counter() - t0)
                out[kind][v["verdict"] or v["status"]] += 1
                for p in v["parts"]:
                    if p["verdict"] == "fixed":
                        fixes[kind][(p["kind"], str(p["expected"]), str(p.get("heard")))] += 1
                if kind != "right" and v["verdict"] == "false_miss":
                    print(f"  WRONG FIX {kind} {voice}: clip {it['char']} as {target['char']}", v["parts"])
    for kind in out:
        print(kind, dict(out[kind]), "fixed parts:", sum(fixes[kind].values()), fixes[kind].most_common(6))
    from tests.test_speech import clip

    for text in ("你好，我很好。", "我想喝一杯咖啡。"):
        res = scoring.analyze(clip(text), text)
        v = deep(res)
        print("sentence", text, "score", res["score"], "->", v and (v["verdict"], v["score_after"], v["parts"]))
    if secs:
        print(
            f"check time: median {np.median(secs) * 1000:.0f} ms, max {max(secs) * 1000:.0f} ms over {len(secs)} checks"
        )


def from_db(user: str) -> None:
    from app import db

    with db.as_user(user), db.conn() as c:
        rows = [
            dict(r)
            for r in c.execute(
                "SELECT d.event_id, d.parts, d.verdict FROM deep_checks d JOIN events e ON e.id=d.event_id"
                " WHERE d.status='done' AND e.mode='syllable'"
            )
        ]
        typed = defaultdict(dict)
        for r in c.execute("SELECT event_id, kind, ok FROM units WHERE source='typed' AND kind IN ('initial','final')"):
            typed[r["event_id"]][r["kind"]] = bool(r["ok"])
    stat = defaultdict(Counter)
    n = 0
    for r in rows:
        labels = typed.get(r["event_id"])
        if not labels:
            continue
        parts = r["parts"] if not isinstance(r["parts"], str) else json.loads(r["parts"])
        for p in parts or []:
            if p.get("kind") not in labels or p.get("verdict") not in ("fixed", "real"):
                continue
            said_right = labels[p["kind"]]
            fixed = p["verdict"] == "fixed"
            key = (p["kind"], p["expected"], p.get("heard"))
            stat[key]["tp" if fixed and said_right else "fp" if fixed else "fn" if said_right else "tn"] += 1
            n += 1
    tot = sum(stat.values(), Counter())

    def line(name, s):
        prec = s["tp"] / (s["tp"] + s["fp"]) if s["tp"] + s["fp"] else None
        rec = s["tp"] / (s["tp"] + s["fn"]) if s["tp"] + s["fn"] else None
        f = lambda x: "-" if x is None else f"{x:.2f}"  # noqa: E731
        print(f"{name:<28} n={sum(s.values()):>3}  precision={f(prec)}  recall={f(rec)}  {dict(s)}")

    print(f"{len(rows)} checked syllable answers, {n} parts with a typed check")
    for k, s in sorted(stat.items(), key=lambda kv: -sum(kv[1].values())):
        line(" ".join(map(str, k)), s)
    line("ALL", tot)
    ok = n >= 30 and tot["tp"] + tot["fp"] and tot["tp"] / (tot["tp"] + tot["fp"]) >= 0.9
    print(
        "Ready for DEEP_CHECK=apply:" if ok else "Not ready for DEEP_CHECK=apply:",
        "needs precision >= 0.9 on 30 or more typed checks, and no far fix in the fixtures mode.",
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["fixtures", "db"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--user")
    a = ap.parse_args()
    if a.what == "fixtures":
        fixtures(a.limit)
    else:
        if not a.user:
            ap.error("db needs --user")
        from app import db

        db.init()
        from_db(a.user)
