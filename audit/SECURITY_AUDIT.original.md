The local security audit is complete. This version is not ready for public production use.

- Audit date: 11 October 2026, Europe/Paris.
- Source revision: `e604cc2c293d4b6272eb60f8661f9beb2b6df5a2`.
- Scope: Next.js frontend, FastAPI backend, PostgreSQL, Clerk token checks, audio processing, AI calls, files, setup tools, dependencies, and local launch settings.
- Review: 31 API operations, 15 frontend pages, all 11 user-data tables, and the public documentation routes.
- Results: 15 grouped findings: 5 high, 7 medium, and 3 low. One high finding applies when the remote database uses the documented `sslmode=require` setting.
- Tests: 66 API, storage, configuration, and live HTTP checks. There were 38 passes and 28 risk signals. Several signals refer to the same finding. These counts are not a security score.
- Regression tests: 27 auth, tracking, coach, and story tests passed in a new schema in the local test database.
- Frontend checks: three static React rendering checks escaped the tested HTML payload. Dependency pattern probes are recorded separately.
- No critical flaw or cross-user database access was demonstrated.
- Deliverables are audit files only. No application fix, dependency upgrade, commit, push, or deployment was made.

Tests used a new schema in `bopomofo_test`. The application database was checked read-only. Test users used temporary RSA keys and the installed Clerk verifier. Audit AI calls used stubs. File deletion tests used a temporary cache. All audit schemas were removed. One short, normal public TTS request was made to the running backend; it returned real audio and may have added that audio to its normal cache.

The first broad regression run included the existing live OpenRouter test and was stopped. That run could have contacted the provider; this audit does not prove that it made no paid request. The final regression run excluded live provider and speech benchmark tests and blocked AI calls. The stopped run's schema was removed.

This report uses the current [OWASP Top 10:2025](https://top10.owasp.org/2025/) and [OWASP API Security Top 10:2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/) as review maps. It is a local source and runtime audit, not a certification or a test of the public deployment.

The entry points and trust boundaries are listed below. The exact routes and source lines are in [entry-points.json](C:/Users/manar/Documents/zhuyin-studio/audit/entry-points.json).

| Entry point | Inputs and effects | Checks made |
|---|---|---|
| `/sign-in`, `/sign-up` | Clerk form, session creation, redirects | Current test-key setting; public page headers; protected-page redirects |
| Other frontend pages | URL filters, sentence IDs, plan IDs, typed text, browser preferences | Proxy bypass header probes; source review of URL use and rendering |
| `GET /api/health` | Optional bearer token; model state and pitch reference | Anonymous access, no-user data isolation, error disclosure |
| `GET /api/tts`, `/api/tts/voices` | Text, rate, voice; CPU inference, disk writes, WAV response | Real anonymous synthesis; request admission; text limits; voice allowlist; cache headers |
| `/docs`, `/redoc`, `/openapi.json` | API schema and interactive documentation | Anonymous HTTP access |
| Text analysis and translation | JSON text; local language analysis or paid AI call | Token checks, length limit, paid-call admission |
| Profile, onboarding, settings, `/api/me` | Personal facts, time zone, goals; database writes; first coach plan | Field allowlist, invalid time zones, SQL payloads, user isolation |
| Sentence generation and library | Topic, count, level, voice, IDs; AI calls; storage; background TTS | Count limits, ID access, cross-user deletion, output validation, source review |
| Speech analysis and symbol check | Multipart audio and form fields; native decoding, resampling, inference, history | Pre-auth parsing, duration check order, text bounds, invalid symbols, non-finite samples |
| Progress attempt, event, day | Scores, dates, units, nested JSON; storage; coach refresh | Bounds, oversized metadata, invalid dates, CSV payload |
| Summary, stats, challenges, CSV export | Window and area filters; reads and export | User isolation, SQL payload, excessive window, formula escaping |
| Coach, alphabet, plans, steps, stories | IDs, reason text; background threads, AI calls, storage | Cross-user IDs and writes; output block allowlist; concurrency and call-budget review |
| PostgreSQL and connection pool | User context, query parameters, database URL | Live role and FORCE RLS checks; pooled and concurrent identity isolation; active connection count; TLS settings |
| Local files and setup tools | Model downloads, archive extraction, model export, SQLite import | Path construction, fixed download destinations, archive filter, query identifiers, revision and hash controls |
| Repository and dependencies | Tracked files, Git history, Python environment, Bun lockfile | Secret pattern scan, pip-audit, bun audit, Bandit, dependency reachability review |

The findings are ordered by release priority. Severity describes this app's risk, not a copied dependency score.

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| F01 | High | Anonymous users can trigger TTS inference and unlimited cache growth | Real anonymous request returned HTTP 200 and 46,636 bytes of WAV. All 16 stubbed admission requests returned 200. No cache size or age limit exists. |
| F02 | High | Upload parsing and audio allocation occur before required limits | An anonymous 3 MB file was fully parsed before the 401 response. A 31-second WAV was resampled to 496,000 samples before rejection. |
| F03 | High | Paid AI work and backend concurrency have no hard budgets | All 16 translation requests reached the provider stub. AI requests omit `max_tokens`. Twelve real database connections were active despite `POOL_SIZE=10`. |
| F04 | High | Any signed-in user can delete the shared TTS cache | User B called cache clear and deleted the temporary file created for user A. |
| F05 | High, conditional | Remote PostgreSQL TLS can omit certificate verification | With `sslmode=require`, the real connection builder selected `CERT_NONE` and disabled hostname checks. README recommends this mode. Local PostgreSQL is on loopback; no remote interception was tested. |
| F06 | Medium | Internal errors reach clients, including anonymous health checks | A synthetic private marker appeared in a 500 response. A model error marker appeared in anonymous `/api/health`. |
| F07 | Medium | Production authentication settings are not enforced | Local Clerk keys are test keys. Authorized parties are empty. A correctly signed test token with attacker `azp` was accepted; an explicit allowlist rejected it. This was not a forged-signature bypass. |
| F08 | Medium | Event, date, window, and model-output validation is incomplete | A 1.1 MB details field, unknown area, negative score and tries were accepted. `9999-99-99` and a negative day goal were accepted. A large stats window produced 500. A 10,000-character AI sentence passed the cleaner. |
| F09 | Medium | CSV exports preserve spreadsheet formulas | The event API accepted a formula string. CSV parsing showed the same string in the exported item cell. No spreadsheet formula was executed. |
| F10 | Medium | Personal audio text can enter URLs and shared caches | The frontend places sentence text in a GET query. TTS responses use `public, max-age=31536000`. A proxy could retain personal audio for a year. No private sentence was recovered from another user's database. |
| F11 | Medium | Browser security headers are absent | Local sign-in responses lacked CSP, frame protection, `nosniff`, Referrer-Policy, and Permissions-Policy. The source sets none. A public proxy could supply them; it was not tested. |
| F12 | Medium | Dependency and model provisioning controls need work | Installed `cryptography` 46.0.3 has seven unique advisory records. Python requirements have no locked versions. Model downloads lack immutable revisions and hash checks. `braces` has one advisory in the lint dependency chain. |
| F13 | Low | Production origin and host policy is too broad | CORS allowed an arbitrary app subdomain and a LAN origin. An attacker Host value was accepted. Bearer tokens are still needed for private routes. |
| F14 | Low | Documentation and the full API schema are public | Anonymous `/docs`, `/redoc`, and `/openapi.json` returned 200. This helps reconnaissance but does not bypass route authentication. |
| F15 | Low | Application security events and alerts are missing | Source review found access logs and tracebacks, but no structured auth-failure, quota, privileged-cache-action, or abuse event handling. External monitoring was not assessed. |

F01 applies to [main.py:202](C:/Users/manar/Documents/zhuyin-studio/backend/app/main.py:202) and [tts.py:138](C:/Users/manar/Documents/zhuyin-studio/backend/app/tts.py:138).

- Require authentication for synthesis. Fetch authenticated audio as a Blob, or use short-lived, scoped audio URLs for the player.
- If some speech must be public, restrict it to a fixed public lesson catalog and add an IP quota.
- Add a bounded job queue, a total disk quota, and cache expiry. Engine locks serialize inference; they do not limit waiting requests or disk growth.
- Release check: anonymous arbitrary synthesis fails; excess requests return 429; queue and cache limits hold.

F02 applies to [main.py:223](C:/Users/manar/Documents/zhuyin-studio/backend/app/main.py:223), the two upload handlers, and [symbols.py](C:/Users/manar/Documents/zhuyin-studio/backend/app/symbols.py).

- Check authentication in middleware before multipart parsing. Apply a streaming request-byte cap at the server or proxy.
- Bound file bytes, frames, channels, sample rate, decoded duration, and resampled size before reading the complete file or allocating arrays.
- Validate speech target length and symbol membership before inference. The invalid-symbol probe reached the inference stub once before rejection.
- Reject NaN and infinity. The real decoder accepted 8,000 NaN samples.
- Release check: unauthorized uploads do not reach the parser; oversized inputs return 413; malformed audio returns 400 without inference or large allocation.

F03 applies to [llm.py:35](C:/Users/manar/Documents/zhuyin-studio/backend/app/llm.py:35), AI routes, coach background work, and [db.py:155](C:/Users/manar/Documents/zhuyin-studio/backend/app/db.py:155).

- Add shared per-user and per-IP quotas, per-user daily spend caps, and a server-wide spend cap.
- Set explicit output-token limits for sentence, translation, coach, and story calls. Bound retries and work per plan.
- Cap active AI, ASR, and TTS jobs across workers. A per-user coach lock only blocks overlapping work for that user in one process.
- Use a bounded database pool with acquisition timeouts. The current queue limits retained idle connections; it opens new ones when empty.
- Release check: repeat calls hit 429 or the budget stop; active connections stay within the configured maximum; multi-worker limits are tested.

F04 applies to [main.py:218](C:/Users/manar/Documents/zhuyin-studio/backend/app/main.py:218) and [tts.py:179](C:/Users/manar/Documents/zhuyin-studio/backend/app/tts.py:179).

- Make global cache purge an administrator operation, or limit the user action to that user's cache namespace.
- Clear browser cache versions per user without deleting the server's shared cache.
- Release check: user B cannot remove user A's audio; administrator actions are recorded.

F05 applies to [db.py:129](C:/Users/manar/Documents/zhuyin-studio/backend/app/db.py:129) and [README.md:104](C:/Users/manar/Documents/zhuyin-studio/README.md:104).

- Require authenticated TLS for remote databases. Use hostname and CA verification; reject insecure remote modes in production.
- Keep plaintext loopback connections a development-only choice.
- Release check: a wrong hostname or untrusted certificate fails. Use the real production connection settings in this test.

F06 applies to the error middleware, public health response, TTS errors, provider errors, and coach state.

- Return a fixed message and a request ID for unexpected failures. Keep detailed exceptions in access-controlled logs.
- Do not expose raw model-load errors through public health checks. Keep public health limited to availability.
- Avoid logging full personal sentences in failed TTS jobs.
- Release check: synthetic path, database, and provider markers never appear in public or user error responses.

F07 applies to [auth.py:19](C:/Users/manar/Documents/zhuyin-studio/backend/app/auth.py:19), [config.py:22](C:/Users/manar/Documents/zhuyin-studio/backend/app/config.py:22), and deployment instructions.

- Use production Clerk keys and an exact `CLERK_AUTHORIZED_PARTIES` allowlist for production.
- Add a production startup check that rejects test keys, missing origins, RLS bypass, and an invalid API base URL.
- Configure the deployed HTTPS API URL. The current fallback uses the page hostname on port 8765; the backend local launcher binds only to loopback.
- Release check: wrong or missing `azp` fails, invalid tokens remain rejected, and a real production-instance token works through the deployed frontend.

F08 applies to API input models, [stats.py:181](C:/Users/manar/Documents/zhuyin-studio/backend/app/stats.py:181), and [llm.py:67](C:/Users/manar/Documents/zhuyin-studio/backend/app/llm.py:67).

- Use enums for areas, modes, levels, unit kinds, and skip reasons. Add finite score bounds and nonnegative counts.
- Parse real dates and use a bounded stats window. Limit nested metadata bytes, keys, depth, and string sizes.
- Keep offline practice tracking possible, but treat reported scores as user input. They must not grant privileges or other-user rewards.
- Validate provider response type, list length, sentence length, and word/gloss size before saving or queuing audio.
- Release check: the recorded invalid inputs return 400, 413, or 422 and do not change state. A bad model reply has bounded handling.

F09 applies to [stats.py:489](C:/Users/manar/Documents/zhuyin-studio/backend/app/stats.py:489).

- Neutralize formula-leading cells at the CSV export boundary. Cover `=`, `+`, `-`, `@`, tabs, and carriage returns.
- CSV quoting alone does not make a formula safe. See the [OWASP CSV Injection guidance](https://owasp.org/www-community/attacks/CSV_Injection).
- Release check: opening the test export as a spreadsheet leaves attacker-controlled cells as text.

F10 applies to [api.ts:265](C:/Users/manar/Documents/zhuyin-studio/frontend/src/lib/api.ts:265) and the TTS response.

- Use POST for private synthesis text and a user-scoped audio reference for playback.
- Set private or no-store caching for personal content. Review access-log query retention and disk-cache lifetime.
- Keep a separate public-cache policy for fixed lesson recordings.
- Release check: personal facts do not appear in audio URLs, public cache keys, or shared caches.

F11 applies to [next.config.ts](C:/Users/manar/Documents/zhuyin-studio/frontend/next.config.ts), proxy handling, and the production reverse proxy.

- Add a CSP compatible with Clerk and the app, including `frame-ancestors`. Use a nonce or a fixed hash for the constant theme script.
- Add `X-Content-Type-Options: nosniff`, a restrictive Referrer-Policy, and a Permissions-Policy that allows the microphone only where required.
- Add HSTS on the actual HTTPS deployment. Its effect cannot be checked over the local HTTP server.
- Mark private API data no-store. Check headers on error responses as well as successful pages.
- Release check: headers are present on the deployed app; sign-in and recording still work; cross-origin framing is blocked.

F12 applies to [backend requirements](C:/Users/manar/Documents/zhuyin-studio/backend/requirements.txt), the Bun lockfile, and model tools.

- `pip-audit` returned 13 advisory records for `cryptography` 46.0.3, which reduce to seven unique records. They cover uncommon EC, certificate-validation, buffer, PKCS7, and bundled OpenSSL issues. Their vulnerable functions were not shown to be reachable through this app's routes; this is not evidence of seven working app exploits.
- Use a patched production build, currently `cryptography` 50.0.2, on a supported platform. Do not freeze production at 46.0.3 to retain a Windows ARM wheel. The maintainer says ARM Windows wheels were dropped in 46.0.4. See the [maintainer changelog](https://cryptography.io/en/latest/changelog/).
- `bun audit` returned [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) for `braces` 3.0.3. It is reached through ESLint, fast-glob, and micromatch. No production request path to that dependency was found. No patched version was listed at audit time. Local nested-pattern probes did not reliably reproduce a failure; retain the advisory and limit untrusted build inputs.
- Lock Python runtime and provisioning dependencies. Add vulnerability scans and dependency review to CI.
- Pin model downloads to immutable revisions and check expected hashes. Keep archive extraction's `filter="data"` safeguard.
- Release check: scan the exact production image and lockfiles; patch or document each remaining advisory with a reviewed reachability result.

F13 applies to the CORS middleware and host handling.

- Use an exact production origin list and a separate local-development list. Add an allowed-host policy.
- Keep bearer-only authentication on mutation routes unless cookie auth has a full CSRF control.
- Release check: app subdomains outside the list, LAN origins, and unknown hosts fail as intended. CORS rejection alone is not API authorization.

F14 and F15 apply to app construction and operational monitoring.

- Disable or restrict interactive API documentation in production unless public documentation is an explicit product requirement.
- Record auth failures, rate-limit events, job refusals, budget stops, and administrator actions with request IDs. Redact tokens and personal content.
- Add alerts for unusual request rates, queue growth, cache growth, provider spend, and database connection use.
- Release check: controlled abuse produces a useful event and alert without exposing secrets.

The following controls passed the tested attacks.

- All 28 protected API operations rejected requests without credentials. The three public API operations were accounted for separately.
- The actual installed verifier rejected malformed, truncated, expired, future, unsigned, HMAC, and wrong-signature test tokens.
- Missing authentication configuration failed closed with 503 on protected routes.
- The current database role is neither superuser nor BYPASSRLS. All 11 user-data tables have both ENABLE and FORCE RLS.
- Cross-user profile, sentence, step, story, export, deletion, skip, and rewrite tests did not cross the data boundary. Some write routes return 200 for a no-op on an invisible object; owner state was checked directly.
- Pooled connections reset identity. Ten concurrent user requests retained separate profile data.
- Tested SQL payloads remained query parameters. Reviewed SQL string construction uses fixed clauses, fixed table names, or generated placeholders.
- Profile keys have an allowlist. Unknown fields such as `user_id` were dropped.
- Text analysis and TTS reject text above 400 characters. Generation count is bounded from 1 to 12. Time zones are checked against real zones.
- Voice IDs use a fixed lookup; cache paths use a digest, not an input path. No request-level file path, arbitrary outbound URL, shell call, pickle load, or code-evaluation entry point was found.
- The model story catalog rejects unknown block types. The three static React checks escaped HTML in story text, chips, and CTA labels. The only raw HTML sink found is the constant theme script.
- Cookie-only profile mutation returned 401. A cross-origin page cannot silently attach a bearer token through a normal form.
- The classic `x-middleware-subrequest` bypass header did not open the five tested protected frontend pages.
- Tracked-file and available local Git-history pattern scans found no matching Clerk secret, OpenRouter key, GitHub token, or private-key material. This was a pattern scan of 373 tracked files and five commits, not a proof that no secret exists anywhere.
- Two concurrent cache writes succeeded in the controlled local filesystem probe. Multi-process cache races remain untested.

OWASP coverage is shown below. A pass means the named attack was blocked; it does not certify every case in the category.

| OWASP Top 10:2025 | Review result |
|---|---|
| A01 Broken Access Control | RLS and object isolation passed; F04 exposes a global operation to ordinary users. |
| A02 Security Misconfiguration | F07, F11, F13, F14; production proxy and HTTPS settings remain untested. |
| A03 Software Supply Chain Failures | F12; dependency scans, setup/download source, model revision and hash controls reviewed. |
| A04 Cryptographic Failures | F05 and F10; token signatures verified; tracked secret patterns absent. |
| A05 Injection | SQL and static HTML checks passed; F09 affects spreadsheet export. Prompt fields are untrusted; no model tools or arbitrary code execution path was found. |
| A06 Insecure Design | F01, F02, F03; CPU, disk, paid-service, and connection budgets lack hard controls. |
| A07 Authentication Failures | Invalid token checks passed; F07 is a token-origin and production-settings gap. |
| A08 Software or Data Integrity Failures | F08 and F12; submitted metrics and some AI output need tighter validation; model downloads lack integrity pinning. |
| A09 Security Logging and Alerting Failures | F15; F06 and F10 also affect what logs and responses may expose. |
| A10 Mishandling of Exceptional Conditions | F02, F06, F08; allocation before rejection, accepted NaN audio, raw exception output, and date overflow were checked. |

| OWASP API Security Top 10:2023 | Review result |
|---|---|
| API1 Broken Object Level Authorization | Tested cross-user object access and mutations were blocked by RLS. |
| API2 Broken Authentication | JWT negative cases passed; F07 remains. |
| API3 Broken Object Property Level Authorization | Profile allowlist passed; F08 covers accepted unexpected values and metadata. |
| API4 Unrestricted Resource Consumption | F01, F02, F03; admission and bounded-allocation probes performed. |
| API5 Broken Function Level Authorization | F04; global cache purge has no administrator check. |
| API6 Unrestricted Access to Sensitive Business Flows | F03; paid generation and translation can be repeated without a spend limit. |
| API7 Server Side Request Forgery | No user-selected server-side URL was found. AI and download destinations are fixed. CTC/model operations read local paths. |
| API8 Security Misconfiguration | F05, F07, F11, F13, F14. |
| API9 Improper Inventory Management | All current routes inventoried; F14 and the legacy attempt route need an explicit production policy. |
| API10 Unsafe Consumption of APIs | F08 and F12; output shape/size, model data, and external errors were reviewed. |

The test limits and remaining release checks are as follows.

- No attack was sent to `bopomofo.app`, Clerk production, a remote database, or a real user account.
- There was no full-volume denial-of-service run. Stubs proved admission and ordering; they did not measure service capacity or maximum cost.
- Browser XSS execution, clickjacking, account switching, OAuth redirect abuse, MFA, account recovery, and token revocation were not tested with real accounts. Static rendering does not replace browser tests.
- Actual HTTPS, reverse-proxy rules, WAF, network firewall, backup restore, database encryption at rest, secret rotation, and external monitoring were not assessed.
- Local PostgreSQL listens on all network addresses. This alone does not prove LAN access: Windows Firewall and `pg_hba.conf` were not assessed. Keep the production database private.
- Account deletion, personal-data retention, AI-provider data retention, and log retention need an explicit policy and a tested deletion path. No account-deletion webhook or API was found in this repo.
- Speech benchmark and live AI regression tests were excluded from the final run. The provisioning/export Python environment was reviewed in source, not dependency-audited as a deployed runtime.
- Installed-package scans do not replace a scan of the exact production build. No Semgrep, ZAP, or external penetration-test claim is made.

Before release, fix F01-F04, enforce the secure choice for F05, and close the medium findings. Then run the recorded probes again against the hardened app. Add real browser and production-environment acceptance for sign-in, private audio, upload limits, headers, multi-worker quotas, deletion, and alerts. A successful process exit from the audit script means the checks completed; `FINDING` entries must still be reviewed and resolved.

Reproduction commands, from `C:\Users\manar\Documents\zhuyin-studio`:

```powershell
backend\.venv\Scripts\python.exe audit\red_team.py
bun run audit\frontend_probes.tsx
node audit\dependency_probe.cjs
uv tool run pip-audit --path backend\.venv\Lib\site-packages --format json --output audit\python-dependencies.json --progress-spinner off
uv tool run bandit -r backend\app backend\tools -f json -o audit\bandit.json -q
```

From `frontend`, run `bun audit --json` for the frontend lockfile scan. The API harness requires a separate local `TEST_DATABASE_URL`, refuses the configured application database, creates a random schema, and removes it when it finishes. It needs the existing local frontend and backend for the live HTTP checks. Test keys generated by the harness are never sent to the live server. A forced process stop can interrupt cleanup; check the test database for a leftover audit schema before another run.

Evidence files:

- [API and storage probe results](C:/Users/manar/Documents/zhuyin-studio/audit/red-team-results.json).
- [Existing test results](C:/Users/manar/Documents/zhuyin-studio/audit/existing-tests.txt).
- [Static frontend probes](C:/Users/manar/Documents/zhuyin-studio/audit/frontend-probes.json) and [Node dependency probe](C:/Users/manar/Documents/zhuyin-studio/audit/node-dependency-probes.json).
- [Environment and RLS checks](C:/Users/manar/Documents/zhuyin-studio/audit/environment-summary.json).
- [Python advisory summary](C:/Users/manar/Documents/zhuyin-studio/audit/dependency-summary.json), [raw Python scan](C:/Users/manar/Documents/zhuyin-studio/audit/python-dependencies.json), and [frontend scan](C:/Users/manar/Documents/zhuyin-studio/audit/frontend-dependencies.json).
- [Bandit results](C:/Users/manar/Documents/zhuyin-studio/audit/bandit.json). Its 23 warnings were reviewed. SHA-1 names cache files and does not authenticate users; practice randomization is not a security primitive; fixed download URLs and reviewed query construction are not proven injection findings. Unpinned model downloads remain a valid supply-chain finding.
- [Secret pattern scan](C:/Users/manar/Documents/zhuyin-studio/audit/secret-scan.json).
- [Repeatable API harness](C:/Users/manar/Documents/zhuyin-studio/audit/red_team.py), [frontend harness](C:/Users/manar/Documents/zhuyin-studio/audit/frontend_probes.tsx), and [dependency harness](C:/Users/manar/Documents/zhuyin-studio/audit/dependency_probe.cjs).
