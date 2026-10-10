---
name: feature
description: Add or change a feature of Zhuyin Studio (this repo's Mandarin and Bopomofo practice app) end to end, so its answers are tracked in detail, shown in the stats, and used by the coach to build plans. Use for a new practice mode, quiz, content type, or skill area, or a change to what an existing mode asks. Not for a bug fix or a style change that does not change what is practiced.
---

# Feature

A feature is done only when every answer it produces is measured in detail, shown in the stats, and usable by the coach.
The coach can only see what coach.digest() sends and can only plan the step types it knows, so a feature without
stats and a coach step type never appears in the learner's plans. The learner wants extremely granular stats: when an
answer can be wrong in a specific way, record that way, so that plans can target it.

## 1. Design the measurement first

Before UI code, write this down in the plan:

- **Area**: an existing one (stats.AREAS: reading, listening, dictation, writing, speaking) or a new one (max 16 characters)
  for a new skill. A new variant of an existing skill keeps the area and adds a mode.
- **Event** (one per answer): item (the prompt), ok, first_try, score, ms, tries, help, replays.
- **Units** (one per part that can be right or wrong): kind, expected, actual (what the learner really produced), ok, try_n,
  help, pos, and the context that can explain errors (ctx, prev, next, lex, extra). The full rules are in the stats reference.
- **Confusions and contexts** worth tracking: which expected → actual pairs, which conditions (position, neighbour, length).
- **Focus**: the URL parameters that open a drill on exact items. Stats "Train" links and coach steps use them.
- **Coach**: the analyst domain, the step type or types and their params, the target unit, the milestone unit.
- **Prerequisites**: what the learner must know first (the alphabet for anything that shows Bopomofo). The coach enforces
  prerequisites with code, not with the model.

## 2. Go through every layer

Skip a layer only with a reason that you put in the final report.

| Layer | Read |
|---|---|
| Storage, API, stats engine, Stats screen, Home, challenges, records | [references/stats-layer.md](references/stats-layer.md) |
| Coach evidence, step types, validation, progress, content generation, milestones, the plan story (facts and blocks), coach UI | [references/coach-layer.md](references/coach-layer.md) |
| Route, page, hotkeys, phone layout, focus params, gamification, data files | [references/ui-layer.md](references/ui-layer.md) |
| README ("What is inside", "How it works") and tests | below |

After the change, run the registry check from backend/:

    .venv\Scripts\python ..\.agents\skills\feature\scripts\check_registries.py

It lists areas, unit kinds, coach step types, analyst domains, and focus parameters that are missing from a registry.
It checks registration only, not behavior.

## Rules that are easy to miss

- Save answers only through api.event or api.speech (frontend/src/lib/api.ts). They update the HUD and the combo, add the
  coach step id (details.step), and fire "zs:answered" for the step banner. A new backend endpoint that saves answers must
  also store the step id and call coach.refresh(), as progress_event does.
- db.add_event silently drops units whose kind is not in db.UNIT_KINDS.
- Old rows (events.legacy = 1) have no "actual" and no context. New logic must work when detailed data is missing.
- The model only chooses among values that the backend can measure. Check every model output in code (drop unknown values,
  clamp numbers, require subsets), and keep a rules fallback.
- Text that the learner reads comes from prompts that forbid JSON field names and ask for numbers.
- Pages that use useSearchParams are wrapped in Suspense. Before you use a Next.js API, read frontend/AGENTS.md and the
  guide in frontend/node_modules/next/dist/docs/.
- Keyboard first on desktop, Duolingo-style on phone, and the gamification stays (see the UI reference).

## Verify

- Backend tests in backend/tests, using the pattern of test_tracking.py and test_coach.py: a temporary database, coach.LIVE =
  False, and a fake model with no network. Test at least these: the units saved for an answer, the stats rows for the new
  kind, clean_step for each new step type, and step_progress counting only the new type's answers inside the step.
- Run a live check on a copy of the database, never on backend/data/zhuyin.db. Copy it with sqlite3 backup to %TEMP%\<name>,
  run the backend with DATA_DIR set to that folder on port 8766, and run
  NEXT_PUBLIC_API_URL=http://localhost:8766 bunx next dev -p 3211. Answer some questions in the new mode. Run one real coach
  build (coach.build) and check that the new domain appears in the findings and the new step type can appear in the plan.
  Check that a step of that type counts answers and that a checkpoint runs after 10 answers.
- Frontend: bunx tsc --noEmit -p ., bun run lint, bun run build. In the browser, check the desktop layout and a 390 px layout.
- Production runs on ports 8765 (backend) and 3210 (bunx next start -p 3210 after a build). To deploy, stop the process
  that owns the port (Get-NetTCPConnection -LocalPort N -State Listen) and start it again.

## Done

Report the result per layer (done, or skipped and why), the tests and their results, and one real coach plan that used
the new stats (or why that was not possible).

