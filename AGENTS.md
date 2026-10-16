# Working on bopomofo

- Read `docs/architecture.md` before a refactor. Read `.agents/skills/feature/SKILL.md` before a practice feature.
- Keep behavior changes separate from refactors. Preserve API paths, response fields, prompts, scoring thresholds, storage keys, and keyboard actions unless the task requires a change.
- Use `CONTRIBUTING.md` for checks. Run one backend test process at a time. Database tests erase the tables in `TEST_DATABASE_URL`.
- Never use learner data as a test database. Never commit keys, recordings, database exports, or downloaded model weights.
- Keep routes thin. Put domain rules in backend modules and model-output checks in deterministic code.
- Keep state and effect lifetimes in the owning UI component. Extract code by responsibility. Avoid new abstraction layers without a clear need.
- Use the existing answer APIs. The HUD, coach progress, level notices, and stats depend on their side effects.
- Read `frontend/AGENTS.md` and the installed Next.js docs before a framework change.
- Explain why a non-obvious rule exists. Do not add comments that repeat the code.
- Report which checks passed, which failed, and which need hardware or a signed-in browser.
