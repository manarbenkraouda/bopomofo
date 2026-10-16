"""Coach: the checks on the model's decisions, step progress, and the plan life cycle. No network calls: the model is replaced."""

import time

import pytest

from app import coach, db, levels


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 0)  # the alphabet rule has its own test
    monkeypatch.setattr(coach.settings, "RULES_GATE", False)  # the tone rule gate has its own test
    unlock_all()  # the level rules have their own tests (test_levels.py)


def unlock_all():
    with db.conn() as c:
        for n in range(2, levels.MAX_LEVEL + 1):
            c.execute(
                "INSERT INTO level_unlocks(key, ts) VALUES (?, ?) ON CONFLICT DO NOTHING", (f"level:{n}", time.time())
            )


def answer(area, kind, expected, ok, step=None, try_n=0, item="x", help=False):
    db.add_event(
        {
            "area": area,
            "item": item,
            "ok": ok,
            "details": {"step": step} if step else {},
            "units": [
                {
                    "kind": kind,
                    "expected": expected,
                    "actual": expected if ok else "?",
                    "ok": ok,
                    "try_n": try_n,
                    "help": help,
                }
            ],
        }
    )


def fake(steps, milestones=None):
    def run(d, reason, run_id):
        known = set()
        return {
            "diagnosis": "test",
            "steps": [coach.cleaning.clean_step(s, known) for s in steps],
            "milestones": milestones,
            "findings": [],
        }

    return run


def test_clean_step_rejects_what_cannot_be_measured(tmpdb):
    assert coach.cleaning.clean_step({"type": "dance"}, set()) is None
    assert (
        coach.cleaning.clean_step({"type": "listen_tones", "tones": [5]}, set()) is None
    )  # no neutral tone in the tone quiz
    assert (
        coach.cleaning.clean_step({"type": "read_symbols", "syms": ["a", "ㄅㄆ"]}, set()) is None
    )  # single Bopomofo symbols only
    assert (
        coach.cleaning.clean_step({"type": "speak_sentences", "texts": ["我不認識這句"]}, set()) is None
    )  # unknown text, no new sentences
    s = coach.cleaning.clean_step(
        {"type": "listen_tones", "tones": ["3", 2, 9, 3], "target": 500, "finding_ids": ["t:1"]}, set(), scale=1.5
    )
    assert s["params"] == {"tones": [3, 2]} and s["target"] == 90 and s["meta"]["finding_ids"] == ["t:1"]
    s = coach.cleaning.clean_step(
        {
            "type": "speak_sentences",
            "new": {"count": 9, "focus": {"tones": [3], "pairs": ["3-3", "bad"], "syms": ["ㄓ", "x"]}},
        },
        set(),
    )
    assert s["params"]["new"] == {"count": 4, "focus": {"tones": [3], "pairs": ["3-3"], "syms": ["ㄓ"]}}


def test_focus_check_uses_surface_tones():
    assert coach.decks.focus_check("我很好", {"tones": [3], "syms": ["ㄏ"]}) == []
    assert (
        coach.decks.focus_check("我很好", {"pairs": ["2-3", "3-3"]}) == []
    )  # said 2-3, written 3-3: the tone change itself
    problems = coach.decks.focus_check("我很好", {"pairs": ["4-1"], "syms": ["ㄓ"]})
    assert any("4-1" in p for p in problems) and any("ㄓ" in p for p in problems)
    assert coach.decks.focus_check("好", {}) == ["1 syllables; write 3 to 16"]


def test_write_syllables_counts_only_deck_syllables():
    # The practice pages mix other syllables into a coach deck for variety; those answers do not count for the step.
    step = {"type": "write_syllables", "params": {"deck": ["ㄇㄚˇ", "ㄋㄧˇ"]}}
    unit = {"kind": "symbol", "expected": "ㄇ", "try_n": 0}
    assert coach.progress.hit(step, {**unit, "item": "ㄇㄚˇ"})
    assert not coach.progress.hit(step, {**unit, "item": "ㄇㄠ"})
    assert coach.progress.hit(step, unit)  # rows with no item (the 30 days before the plan) keep the old rule


def test_progress_counts_only_answers_inside_the_step_and_the_next_plan_takes_over(tmpdb):
    pid = coach.build(
        "test",
        run_pipeline=fake(
            [{"type": "listen_tones", "tones": [3], "target": 5}, {"type": "read_symbols", "syms": ["ㄅ"], "target": 5}]
        ),
    )
    st = coach.state()
    a, b = st["steps"]
    assert f"&step={a['id']}" in a["href"] and a["href"].startswith("/listening?quiz=tone&tones=3")
    for _ in range(6):
        answer("listening", "tone", "3", True)  # outside the step: does not count
    for ok in (True, True, False, True):
        answer("listening", "tone", "3", ok, step=a["id"])
    answer("listening", "tone", "2", True, step=a["id"])  # not the focus
    assert coach.progress.step_progress(coach.store.step(a["id"])) == {"progress": 3, "tried": 4, "right": 3}
    answer("listening", "tone", "3", True, step=a["id"])
    answer("listening", "tone", "3", True, step=a["id"])
    assert coach.refresh(check=False)["done_now"] == [a["id"]]
    # One step is left: the next plan is built in advance and waits.
    nxt = coach.build("next", run_pipeline=fake([{"type": "write_symbols", "syms": ["ㄆ"], "target": 5}]), as_next=True)
    assert coach.store.plan(nxt)["status"] == "next" and coach.store.plan()["id"] == pid
    for _ in range(5):
        answer("reading", "symbol", "ㄅ", True, step=b["id"])
    answer("reading", "symbol", "ㄅ", True, step=b["id"], try_n=1)  # a second try does not count for read_symbols
    r = coach.refresh(check=False)
    assert r["finished"] and coach.store.plan(pid)["status"] == "done" and coach.store.plan()["id"] == nxt
    s = coach.step_state(b["id"])
    assert s["step"]["status"] == "done" and s["next"]["title"] == "write symbols"


def test_sentence_steps_count_passes_per_sentence(tmpdb):
    one = db.add_sentence({"hanzi": "我很好"}, "t", "t")
    two = db.add_sentence({"hanzi": "你好嗎"}, "t", "t")
    coach.build(
        "test",
        run_pipeline=fake(
            [{"type": "speak_sentences", "sentence_ids": [one["id"], two["id"], 999], "reps": 2, "min_score": 80}]
        ),
    )
    step = coach.state()["steps"][0]
    assert step["target"] == 4 and step["href"].startswith(f"/speaking?source=sentence&ids={one['id']},{two['id']}")
    for text, score in (("我很好", 90), ("我很好", 70), ("我很好", 85), ("我很好", 95), ("你好嗎", 82)):
        db.add_event(
            {
                "area": "speaking",
                "item": text,
                "ok": score >= 80,
                "score": score,
                "details": {"step": step["id"]},
                "units": [],
            }
        )
    p = coach.progress.step_progress(coach.store.step(step["id"]))
    assert p["progress"] == 3 and p["tried"] == 5 and [x["passes"] for x in p["items"]] == [2, 1]


def test_rules_fallback_and_milestones(tmpdb):
    def broken(d, reason, run):
        raise RuntimeError("model down")

    pid = coach.build("test", run_pipeline=broken)
    plan = coach.store.plan(pid)
    assert plan["source"] == "rules" and "model down" in plan["error"] and coach.store.steps(pid)
    ms = {
        "keep": [],
        "new": [
            coach.cleaning.clean_milestone(
                {"title": "Tone 3", "area": "listening", "unit": "tone", "expected": [3], "min_acc": 90, "window": 20}
            )
        ],
    }
    assert ms["new"][0]["title"] == "Tone 3: 90% of the last 20"
    assert (
        coach.cleaning.clean_milestone(
            {
                "title": "Read ㄒ at 40% (30)",
                "area": "reading",
                "unit": "symbol",
                "expected": ["ㄒ"],
                "min_acc": 50,
                "window": 30,
            }
        )["title"]
        == "Read ㄒ: 50% of the last 30"
    )
    coach.build("test", run_pipeline=fake([{"type": "listen_tones", "tones": [3], "target": 5}], ms))
    m = [x for x in coach.state()["milestones"] if x["criterion"]["unit"] != "alphabet"]
    assert len(m) == 1 and m[0]["criterion"]["expected"] == ["3"] and not m[0]["reached"]
    for _ in range(20):
        answer("listening", "tone", "3", True)
    coach.refresh(check=False)
    assert next(x for x in coach.state()["milestones"] if x["criterion"]["unit"] != "alphabet")["status"] == "achieved"


def test_checkpoint_can_only_narrow_to_a_subset(tmpdb):
    coach.build("test", run_pipeline=fake([{"type": "listen_tones", "tones": [2, 3, 4], "target": 20}]))
    s = coach.store.step(coach.state()["steps"][0]["id"])
    for ok in (True, False) * 6:
        answer("listening", "tone", "3", ok, step=s["id"])
    out = coach.practice.checkpoint(
        s["id"], ask=lambda st, task, payload: {"action": "narrow", "tones": [3], "note": "x"}
    )
    assert out["params"]["tones"] == [2, 3, 4]  # one tone left would make the quiz guessable
    out = coach.practice.checkpoint(
        s["id"],
        ask=lambda st, task, payload: {
            "action": "narrow",
            "tones": [3, 4, 1],
            "deck": ["ㄇㄚˇ"],
            "note": "Tone 3: 6 of 12.",
        },
    )
    assert out["params"]["tones"] == [3, 4] and "deck" not in out["params"] and out["status"] == "open"
    out = coach.practice.checkpoint(s["id"], ask=lambda st, task, payload: {"action": "extend", "target": 2})
    assert out["target"] == 9  # at least the progress + 3
    assert coach.state()["steps"][0]["note"]["text"] == "Tone 3: 6 of 12."
    with db.conn() as c:
        c.execute("UPDATE steps SET status='done' WHERE id=?", (s["id"],))
    late = coach.practice.apply_checkpoint(
        s, coach.progress.step_progress(s), {"action": "extend", "note": "Keep going."}
    )
    assert late["status"] == "late" and coach.state()["steps"][0]["note"]["text"] == "Tone 3: 6 of 12."


def test_review_drops_and_orders(tmpdb):
    steps = [coach.cleaning.clean_step({"type": "listen_tones", "tones": [t], "target": 10}, set()) for t in (1, 2, 3)]
    out, diag = coach.pipeline.apply_review(
        steps,
        {
            "verdicts": [{"pos": 1, "action": "drop"}, {"pos": 2, "action": "change", "target": 300, "title": "New"}],
            "order": [2, 0],
            "diagnosis": "Final.",
        },
        "draft",
    )
    assert (
        [s["params"]["tones"] for s in out] == [[3], [1]]
        and out[0]["target"] == 120
        and out[0]["title"] == "New"
        and diag == "Final."
    )


def test_deck_must_cover_the_focus_and_neutral_tone_needs_context(tmpdb):
    s = coach.cleaning.clean_step(
        {"type": "speak_sounds", "unit": "tone", "tones": [5, 2], "source": "syllable"}, set()
    )
    assert s["params"]["source"] == "sentence"
    step = coach.cleaning.clean_step({"type": "listen_tones", "tones": [4, 2]}, set())
    cands = coach.decks.candidates(step, {})
    assert cands and all(c["tone"] in (2, 4) for c in cands)
    only_t2 = [c["z"] for c in cands if c["tone"] == 2][:12]
    assert coach.decks.deck_problems(step, only_t2, cands) == [
        f"tone 4 is in the focus but the deck has 0 syllables with it ({sum(c['tone'] == 4 for c in cands)} candidates have it)"
    ]
    assert coach.decks.deck_problems(step, [c["z"] for c in cands], cands) == []


def test_alphabet_comes_first_until_the_symbols_are_known(tmpdb, monkeypatch):
    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 30)
    answer("reading", "symbol", "ㄅ", True)
    answer("reading", "symbol", "ㄅ", True)  # said right twice without help: known
    answer("reading", "symbol", "ㄆ", False, help=True)
    answer("reading", "symbol", "ㄆ", True, help=True)  # right only after hearing the answer: still learning
    answer("listening", "tone", "3", True)  # the tone quiz says nothing about the symbols
    st = coach.alphabet_status()
    assert st["known"] == "ㄅ" and st["learning"] == "ㄆ" and st["gate"]
    assert st["next_group"] == [
        "ㄆ",
        "ㄇ",
        "ㄈ",
        "ㄉ",
        "ㄊ",
    ]  # the symbol being learned, then at most 4 new ones in order
    pid = coach.build(
        "test",
        run_pipeline=fake(
            [
                {"type": "listen_sounds", "syms": ["ㄓ", "ㄗ"]},
                {"type": "listen_tones", "tones": [2, 3]},
                {"type": "read_symbols", "syms": ["ㄒ"]},
            ]
        ),
    )
    steps = coach.state()["steps"]
    assert [s["type"] for s in steps] == ["read_symbols", "write_symbols", "listen_tones"]
    assert (
        steps[0]["params"]["syms"] == st["next_group"]
        and "say it back" in steps[0]["why"]
        and not any(ch.isdigit() for ch in steps[0]["why"])
    )
    assert (
        coach.cleaning.clean_milestone(
            {
                "title": "Speaking score: 95 average of the last 20",
                "area": "speaking",
                "unit": "score",
                "min_acc": 95,
                "window": 20,
            }
        )["title"]
        == "Speaking score: average 95 over the last 20"
    )  # the goal is not written twice
    assert (
        steps[0]["params"]["learn"] and steps[1]["params"]["learn"] and "learn=1" in steps[0]["href"]
    )  # new symbols: repetition first
    assert coach.state()["plan"]["diagnosis"].startswith(
        "Alphabet first: you know 1 of the 37 Bopomofo symbols, so this plan starts with them: repeat ㄆ ㄇ"
    )
    assert len(__import__("json").loads(coach.store.plan(pid)["raw"])["alphabet_rule"]["removed_steps"]) == 2
    m = [x for x in coach.state()["milestones"] if x["criterion"]["unit"] == "alphabet"]
    assert len(m) == 1 and m[0]["n"] == 1 and m[0]["title"] == "Know the alphabet: 37 of 37 symbols known"
    coach.build("again", run_pipeline=fake([{"type": "listen_tones", "tones": [2, 3]}], {"keep": [], "new": []}))
    assert (
        len([x for x in coach.state()["milestones"] if x["criterion"]["unit"] == "alphabet"]) == 1
    )  # never dropped, never doubled

    # Repetition: every right answer with the answer shown counts in a learn step, and it is not a test (ㄇ stays not known).
    sid = coach.state()["steps"][0]["id"]
    for _ in range(coach.settings.LEARN_REPS):
        db.add_event(
            {
                "area": "reading",
                "item": "ㄇ",
                "ok": False,
                "help": True,
                "details": {"step": sid, "learn": True},
                "units": [{"kind": "symbol", "expected": "ㄇ", "actual": "ㄇ", "ok": True, "try_n": 0, "help": True}],
            }
        )
    assert coach.state()["steps"][0]["progress"] == coach.settings.LEARN_REPS
    m = next(x for x in coach.alphabet_status()["symbols"] if x["sym"] == "ㄇ")
    assert (
        m["state"] == "learning"
        and m["reps"] == coach.settings.LEARN_REPS
        and m["phase"] == "recall"
        and m["answers"] == 0
    )
    # After enough repetitions the symbol gets tests from memory; the others keep repeating. Symbol milestones wait.
    sym_m = coach.cleaning.clean_milestone(
        {"title": "Name symbols", "area": "reading", "unit": "symbol", "expected": ["ㄅ"]}
    )
    tone_m = coach.cleaning.clean_milestone({"title": "Tone 2", "area": "speaking", "unit": "tone", "expected": [2]})
    coach.build(
        "recall", run_pipeline=fake([{"type": "listen_tones", "tones": [2, 3]}], {"keep": [], "new": [sym_m, tone_m]})
    )
    steps = coach.state()["steps"]
    assert [(s["title"].split(":")[0], s["params"].get("learn", False)) for s in steps[:4]] == [
        ("Say from memory", False),
        ("Hear and write from memory", False),
        ("Listen and repeat", True),
        ("Copy and write", True),
    ]
    assert steps[0]["params"]["syms"] == ["ㄇ"] and "ㄇ" not in steps[2]["params"]["syms"]
    units = {x["criterion"]["unit"] for x in coach.state()["milestones"]}
    assert "symbol" not in units and {"tone", "alphabet"} <= units

    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 1)  # enough symbols known: the model's plan is kept as it is
    coach.build("known", run_pipeline=fake([{"type": "listen_sounds", "syms": ["ㄓ", "ㄗ"]}]))
    assert [s["type"] for s in coach.state()["steps"]] == ["listen_sounds"]


def test_a_coach_job_is_shared_by_every_api_process(tmpdb, monkeypatch):
    # During a deploy the old process builds the plan while the new one answers the app: both read coach_jobs.
    from app import llm

    monkeypatch.setattr(coach.settings, "LIVE", True)
    ran = []
    monkeypatch.setattr(coach.jobs, "run", ran.append)
    db.save_settings({"onboarded_at": 1.0})
    db.set_profile(dict.fromkeys(llm.PROFILE_LABELS, "x"))
    assert coach.start("new plan") is True
    assert coach.start("again") is False and coach.start_story(1) is False
    coach.jobs.set_stage("Choosing your next steps")
    st = coach.state()  # no plan yet, but the first plan is being built: no second one starts
    assert st["generating"] and st["stage"] == "Choosing your next steps" and len(ran) == 1
    with db.conn() as c:  # the process building it died: no beat for JOB_STALE seconds
        c.execute("UPDATE coach_jobs SET beat=?", (time.time() - coach.jobs.JOB_STALE - 1,))
    st = coach.state()
    assert st["generating"] and st["stage"] == "Starting" and len(ran) == 2  # the first plan starts again


def test_the_api_waits_for_coach_work_before_it_stops(tmpdb, monkeypatch):
    import threading

    monkeypatch.setattr(coach.settings, "LIVE", True)
    gate = threading.Event()
    monkeypatch.setattr(coach.planner, "build", lambda reason, as_next=False: gate.wait(5) and 1 / 0)
    assert coach.start("new plan")
    assert db.wait_background(0.3) == 1 and coach.state()["generating"]
    gate.set()
    assert db.wait_background(5) == 0
    st = coach.state()
    assert not st["generating"] and st["error"] == "ZeroDivisionError: division by zero"
