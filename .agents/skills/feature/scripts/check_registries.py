r"""List areas, unit kinds, coach step types, analyst domains, focus params, and story blocks that are missing from a registry.

Run from backend/ with the backend venv:
    .venv\Scripts\python ..\.agents\skills\feature\scripts\check_registries.py
Exit code 1 when a required registration is missing. "note" lines are warnings: check them, they can be intended.
This checks registration only, not behavior.
"""
from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "backend"))

from app import coach, db, levels, stats, story  # noqa: E402

FE = ROOT / "frontend" / "src"
missing: list[str] = []
notes: list[str] = []


def read(rel: str) -> str:
    return (FE / rel).read_text(encoding="utf-8")


def line_of(text: str, start: str) -> str:
    """The text from 'start' to the end of its statement (up to the first ';' or the closing line)."""
    i = text.find(start)
    if i < 0:
        return ""
    j = text.find(";", i)
    return text[i: j if j > 0 else i + 2000]


def need(ok: bool, msg: str):
    if not ok:
        missing.append(msg)


def note(ok: bool, msg: str):
    if not ok:
        notes.append(msg)


charts = read("components/stats/charts.tsx")
levels_ui = read("lib/levels.tsx")
route_ex = line_of(levels_ui, "export const ROUTE_EXERCISES")
ui_exercises = {e for e in re.findall(r'"([a-z]+(?:/[a-z]+)?)"', route_ex.split("=", 1)[-1])}
api = "\n".join(p.read_text(encoding="utf-8") for p in sorted((FE / "lib/api/types").glob("*.ts")))
coach_ui = read("components/coach/stepMeta.ts")
focus = read("lib/focus.tsx")
banner = read("components/shell/StepBanner.tsx")
src_digest = inspect.getsource(coach.digest.digest)
src_hit = inspect.getsource(coach.progress.hit)
src_rules = inspect.getsource(coach.fallback.rules_plan)
src_ms = inspect.getsource(coach.cleaning.clean_milestone)

# Areas
for a in stats.AREAS:
    q = f'"{a}"'
    for name in ("AREA_COLOR", "AREA_LABEL", "AREA_ORDER"):
        need(a in line_of(charts, "export const " + name), f"area {a}: missing in {name} (components/stats/charts.tsx)")
    need(a in stats.VERB, f"area {a}: missing in stats.VERB")
    need(q in line_of(api, "area: \"reading\""), f"area {a}: missing in the PracticeEvent area union (lib/api/types/stats.ts)")
    need(f'"/{a}"' in route_ex, f"area {a}: no route in ROUTE_EXERCISES (lib/levels.tsx)")
    note(a in coach.settings.TYPES.values(), f"area {a}: no coach step type trains it (coach.settings.TYPES)")
    need(any(k == a or k.startswith(a + "/") for k in coach.settings.MEASURES), f"area {a}: missing in coach.settings.MEASURES (what the mode measures)")
    note(a in inspect.getsource(stats.challenges), f"area {a}: no daily challenge in stats.challenges()")

# Exercises: the level tree (backend/app/levels.py EXERCISES) and the UI routes (lib/levels.tsx ROUTE_EXERCISES) list the same ones.
for e in sorted(set(levels.EXERCISES) - ui_exercises):
    need(False, f"exercise {e}: in levels.EXERCISES but no route in ROUTE_EXERCISES (lib/levels.tsx)")
for e in sorted(ui_exercises - set(levels.EXERCISES)):
    need(False, f"exercise {e}: in ROUTE_EXERCISES (lib/levels.tsx) but missing in levels.EXERCISES")
for e in sorted(levels.EXERCISES):
    need(any(e in lv.get("opens", []) for lv in levels.LEVELS), f"exercise {e}: no level opens it (levels.LEVELS)")

# Unit kinds
kinds_ts = line_of(api, "kind: \"tone\"")
for k in sorted(db.UNIT_KINDS):
    need(f'"{k}"' in kinds_ts, f"unit kind {k}: missing in the Unit kind union (lib/api/types/stats.ts)")
    if k in ("stroke", "order", "syllable"):
        continue
    note(f'"{k}"' in src_digest, f"unit kind {k}: not used in coach.digest.digest() (the analysts cannot see it)")
    note(f'"{k}"' in src_ms, f"unit kind {k}: not a milestone unit (coach.cleaning.clean_milestone)")

# Coach step types
for t, area in coach.settings.TYPES.items():
    need(area in stats.AREAS, f"step type {t}: area {area} is not in stats.AREAS")
    need(f"- {t}:" in coach.prompts.PLAN, f"step type {t}: not described in the PLAN prompt")
    need(f'"{t}"' in line_of(api, "export type StepType"), f"step type {t}: missing in StepType (lib/api/types/coach.ts)")
    need(f"{t}:" in line_of(coach_ui, "export const STEP_ICON"), f"step type {t}: missing in STEP_ICON (components/coach/stepMeta.ts)")
    need(f"{t}:" in coach_ui[coach_ui.find("const STEP_KIND"):coach_ui.find("const DOMAIN")], f"step type {t}: missing in STEP_KIND (components/coach/stepMeta.ts)")
    note(t in coach.settings.DEFAULT_TARGET, f"step type {t}: no DEFAULT_TARGET (fine only when the target is derived, like speak_sentences)")
    note(f'"{t}"' in src_hit, f"step type {t}: not named in coach.progress.hit (it uses the last, generic rule)")
    note(f'"{t}"' in src_rules, f"step type {t}: never used by coach.fallback.rules_plan (the fallback cannot plan it)")
    try:
        url = coach.progress.href({"type": t, "params": {}, "id": 1})
        need(url.endswith("&step=1"), f"step type {t}: href() does not end with &step=")
    except Exception as e:  # noqa: BLE001
        missing.append(f"step type {t}: href() fails with empty params: {type(e).__name__}: {e}")

# Analyst domains
for d in coach.prompts.DOMAINS:
    need(f'"{d}":' in src_digest, f"domain {d}: no slice in coach.digest.digest()")
    need(f"{d}:" in line_of(coach_ui, "const DOMAIN"), f"domain {d}: missing in DOMAIN (components/coach/stepMeta.ts)")

# Focus params read by the practice modes
params = set(re.findall(r'q\.get\("(\w+)"\)', focus))
keys = set(re.findall(r'"(\w+)"', line_of(banner, "const FOCUS_KEYS")))
clear = line_of(focus, "for (const k of")
for p in sorted(params):
    need(p in keys, f'focus param {p}: missing in FOCUS_KEYS (StepBanner.tsx)')
    need(f'"{p}"' in clear, f'focus param {p}: not cleared in useClearHref (lib/focus.tsx)')

# Story blocks: backend CATALOG (prompt and checks) and the frontend registry (drawing) list the same types.
reg = read("components/story/registry.tsx")
fe_blocks = set(re.findall(r"^\s*(\w+):\s*\w+,\s*$", reg[reg.find("// catalog:start"):reg.find("// catalog:end")], re.M))
spec_types = read("components/story/types.ts")
for t in sorted(set(story.CATALOG) | fe_blocks):
    need(t in story.CATALOG, f"story block {t}: in the frontend registry but not in story.CATALOG (backend/app/story/)")
    need(t in fe_blocks, f"story block {t}: in story.CATALOG but not in BLOCKS (components/story/registry.tsx)")
    need(f'type: "{t}"' in spec_types, f"story block {t}: missing in BlockSpec (components/story/types.ts)")
# Areas the story can talk about: every area needs a label in story.MODE_LABEL (a missing one shows the raw name).
for a in stats.AREAS:
    note(any(k == a or k.startswith(a + "/") for k in story.MODE_LABEL), f"area {a}: no label in story.MODE_LABEL (backend/app/story/)")

for m in missing:
    print("MISSING", m)
for n in notes:
    print("note   ", n)
print(f"{len(missing)} missing, {len(notes)} notes")
sys.exit(1 if missing else 0)

