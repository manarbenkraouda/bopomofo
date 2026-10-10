# Stats layer

Data flow: the mode builds units → api.event → POST /api/progress/event (main.EventIn, UnitIn) → db.add_event → the
"events" and "units" tables → stats.py → /api/stats (Stats screen), /api/stats/challenges (Home and Stats),
/api/progress/summary (db.summary, Home tiles), /api/stats/export.csv. coach.digest() reads the same tables.

## Storage and API (backend/app/db.py, main.py)

- A new unit kind goes into db.UNIT_KINDS and into the Unit["kind"] union in frontend/src/lib/api.ts.
- A new area needs no schema change. Add it to the PracticeEvent["area"] union in api.ts.
- Add a table only for data that is not an answer (for example, a character list). Change a schema in db.init() with
  CREATE TABLE IF NOT EXISTS, or with ALTER TABLE after a PRAGMA table_info check (see steps.checked_n).
- Answers judged on the backend (like speech) build their units in stats.py (see speaking_units and log_speaking) and
  keep the optional step id.
- Change legacy_event or backfill only when old data for the feature exists.

## Unit fields

| Field | Rule |
|---|---|
| kind | Existing: tone, initial, final, symbol, syllable, stroke, order. A new kind for a new atomic skill (for example "char"). |
| expected | The canonical value, stable across sessions, so that item_stats groups it: tone "1"-"5", one Bopomofo symbol, Bopomofo with tone mark, one character. |
| actual | What the learner produced, never only right or wrong when the answer is known. "?" = not heard or not clear; "∅" = nothing. |
| ok | true or false; null when not judged. |
| try_n | 0 = first try. Item stats, challenges, and milestones count try_n = 0 only. |
| help | true when the answer or a hint was shown: the item counts as not known. |
| pos | The index of the part in the item. |
| ctx, prev, next, lex | The carrier (character, base syllable), the neighbours, and the dictionary value, when context can explain errors. |
| source, uncertain, extra | Which judge decided, low confidence, other details (JSON). |

item_stats leaves out the stroke and order kinds. Leave out a new kind there too when it only holds sub-part details.

## stats.py

Each of these must handle the new area or kind:

- AREAS and VERB (the verb in "you said / picked / wrote instead").
- _href(area, kind, expected, also): the practice URL that trains this item, with the focus params that the mode reads.
  Keep it the same as trainHref in Stats.tsx.
- _label(kind, expected): the display name.
- compute(): overview, daily, areas (first try, help, ms, replays, score, modes), confusion, expected, items, tone_ctx,
  strokes, hours, sessions, recent, records, challenges, weak, calendar. Add a section when the feature has its own
  structure (for example, accuracy per radical or per stroke count), and add it to the Stats type in api.ts.
- weak(): the ranked weak spots with label and href.
- records(): add records that make sense for the area.
- challenges(): a daily challenge from the weakest items of the new kind (the item, a target, and the "why" with the
  numbers and the top confusion), plus a warm-up entry for the area in "fill".
- export_csv(): check that the new fields are exported.
- db.summary(): the totals per area for the Home tiles.

## Frontend

- components/stats/charts.tsx: AREA_COLOR, AREA_LABEL, AREA_ORDER. A missing area disappears from the charts.
- components/stats/Stats.tsx: the area filter, trainHref, and the tabs (today, tones, sounds, symbols, history). Give the new
  kind a tab or a section with an accuracy grid, a confusion matrix (Matrix), what was produced instead, the trend, and
  Train links. Keep keyboard navigation (↑ ↓ or J K, and Enter to train) as on the symbols tab.
- components/home/Dashboard.tsx: AREA_OF (route → area), the tiles, the challenges.

