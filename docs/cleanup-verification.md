# Cleanup verification

This record covers the behavior-preserving cleanup on `codex/clean-architecture`, based on `e86402f`. Checks ran on the Windows ARM64 reference machine on 16 October 2026.

## Scope

- Add shared editor rules, Python lint and format tools, frontend formatting, and repository CI.
- Move HTTP routes out of the application entry point.
- Split coach planning and story generation by responsibility, with explicit package interfaces.
- Define the backend alphabet once and retain the existing scoring and learning rules.
- Split frontend screen views and API contracts while keeping state and effect lifetimes in the owning screens.
- Add focused API tests for authentication, saved-answer notifications, quotas, errors, and audio caching.
- Add architecture, contribution, configuration, deployment, and platform setup guides.
- Correct the exporter package source for uv without changing the pinned torch version or exporter code.

The cleanup does not change prompts, scoring thresholds, schema migrations, model artifacts, API paths, response fields, browser storage keys, or keyboard actions.

## Evidence

| Check                                     | Result                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Full backend suite                        | 106 passed, including speech and remote sentence generation; 623.20 seconds                                                |
| Backend fast suite                        | 95 passed, 1 remote-generation test deselected; speech test files excluded                                                 |
| Ruff lint and formatting                  | Passed; 86 Python files formatted                                                                                          |
| Cross-layer registry check                | 0 missing registrations, 4 existing notes                                                                                  |
| API comparison with `e86402f`             | OpenAPI schemas equal across 37 paths; protected paths retain unauthenticated 401 responses                                |
| Frontend declaration comparison           | 167 original runtime declarations match after moving; imports, exports, comments, whitespace, and trailing commas excluded |
| Frontend tests                            | 50 passed, 0 failed; 537 assertions across 7 files                                                                         |
| TypeScript, ESLint, Prettier              | Passed                                                                                                                     |
| Frontend production build                 | Passed; all 23 static outputs generated                                                                                    |
| Next development diagnostics              | No compilation, configuration, or session errors                                                                           |
| Browser                                   | Sign-in renders at desktop and phone widths; React tree is available; no page errors reported                              |
| Windows x64 / Apple Silicon / Intel macOS | Python 3.12 runtime dependency sets resolve to binary packages                                                             |
| Windows ARM64 and x64 export              | Exporter dependency sets resolve after correcting the torch package source                                                 |
| Apple Silicon export                      | Separate exporter dependency set resolves                                                                                  |

A fresh frontend type check also passed in a scratch directory without environment files or prior Next.js output. The Intel macOS exporter check confirmed that the pinned torch wheel is unavailable there.

The declaration and API comparisons are one-time comparisons against the recorded baseline. The contributor guide and CI contain the ongoing checks.

## Limits and existing warnings

- The browser had no signed-in development session. Practice routes, keyboard flows, and real microphone behavior were not retested in this cleanup.
- Windows x64 and macOS were checked by package resolution. No fresh installation, inference run, or device test was done on those systems.
- macOS model export is documented but was not executed on a Mac. Intel users need exported artifacts from a supported machine.
- FastAPI's test client reports an existing Starlette/httpx deprecation warning. Clerk reports an existing `createRouteMatcher` deprecation. Migrating those interfaces is separate behavior work.
- The GitHub workflow was added but has not run on a hosted runner. Frontend production builds need Clerk configuration; CI checks source and types without private account keys.
- No deployment, push, or merge was done. License selection, asset attribution, and a full private-data review of files and Git history remain release work. See [licensing](licensing.md).
