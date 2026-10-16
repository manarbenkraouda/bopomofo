# Contribute to bopomofo

Start with [local setup](docs/setup/README.md) and [architecture](docs/architecture.md). Keep a change focused: formatting, refactors, and new behavior should be easy to review separately.

## Before editing

- Use your own Clerk development application and a disposable test database.
- Keep secret values in the ignored environment files. The tracked examples contain no keys.
- Read `.agents/skills/feature/SKILL.md` for a new practice mode or measurement. It maps the storage, stats, coach, and UI registries that must agree.
- For a refactor, name the behavior that must stay unchanged. Include error messages, scoring rules, saved keys, model prompts, and background jobs.
- Read `frontend/AGENTS.md` and the installed Next.js docs before a framework change.

## Backend checks

From `backend/`, use `.venv/Scripts/python.exe` on Windows or `.venv/bin/python` on macOS/Linux. Install tools with `uv pip install --python .venv -r requirements-dev.txt`.

```sh
uv run --no-project --python .venv python -m ruff check .
uv run --no-project --python .venv python -m ruff format --check .
uv run --no-project --python .venv python ../.agents/skills/feature/scripts/check_registries.py
```

Run the fast suite without speech weights or remote model calls:

```sh
uv run --no-project --python .venv python -m pytest -q tests --ignore=tests/test_speech.py --ignore=tests/test_symbols.py --deselect=tests/test_llm.py::test_generate_sentences
```

Run the full suite when the speech model, audio fixtures, and OpenRouter key are available:

```sh
uv run --no-project --python .venv python -m pytest -q tests
```

The full suite includes a paid remote generation request. Speech tests use recorded audio; missing generated fixtures require `edge-tts` and network access. Install that test-only tool in the development environment when needed. A full speech run can take several minutes on the reference CPU.

Tests use `TEST_DATABASE_URL` and erase its learner tables. Never point it at your app database. Do not run two backend test processes at once. A skipped database test does not count as a verified result.

The registry check reports four existing notes: sentence targets are derived, two step types use generic progress rules, and the rules fallback does not create writing-syllable steps. Its required result is `0 missing`; the notes are not new failures.

## Frontend checks

From `frontend/`:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

`check` runs TypeScript, ESLint, Prettier, and Bun tests. `build` also needs the frontend's Clerk configuration. To format a change, use `bun run format`. For root docs, run `bunx prettier --check ../README.md ../CONTRIBUTING.md ../docs`.

Before reporting a UI change as verified, open the affected routes with a signed-in development user. Check keyboard actions and a phone-width viewport. Use a scratch database for answers and coach generation. A production build is separate from a browser check.

## Review rules

- Keep HTTP routes focused on transport. Put grading and learning decisions in domain code.
- Save graded answers through the existing event or speech API. Preserve HUD and coach notifications.
- Validate model output against allowed values and keep a fixed fallback.
- Patch the owning module in a test. Do not depend on a copied import of a mutable switch.
- Add tests for a changed contract or a real regression risk. Avoid tests that repeat the implementation.
- Explain the reason for a non-obvious rule. Use names instead of comments when a name is enough.
- Keep unrelated files and learner data out of the diff.

## Pull requests

State the problem, the resulting behavior, and the checks you ran. For a refactor, state what stayed unchanged and how you checked it. Name failed checks and missing browser or hardware tests. Never include real keys, learner records, or recordings in a report.

Contributions are accepted under the project license, [AGPL-3.0-only](LICENSE). Do not add data, media, fonts, or models without their origin and terms. Add a row for each new asset to [licensing](docs/licensing.md).
