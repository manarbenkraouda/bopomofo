I checked the 15 findings of the security audit again. 3 findings are real risks for the live app. I excluded 12 findings because they are overstated: they apply only to development or to this PC, they need an unrealistic attacker position, or they affect only the user's own data.

All 3 kept findings and F04 are fixed in the code after this review. The fixes are not deployed yet: the live API still runs revision `e604cc2`.

- F01: `/api/tts` needs a sign-in. Each user has an audio folder, `data/tts/<user id>`, kept under 200 MB (the clips used least recently go first). A user can make 3,000 new clips in 24 hours. TTS responses are `Cache-Control: private`.
- F02: the API refuses bodies above 1 MB (16 MB for audio uploads) before it parses them, also without sign-in. It reads the audio header before it decodes, and refuses more than 30 seconds, more than 2 channels, or a sample rate outside 8 to 96 kHz. Upload text fields have length limits.
- F03: each user can spend at most $1 and make at most 400 AI calls per local day. The count includes coach, story, sentence, and translation calls, and failed calls. At the limit, requests get 429 with the refill time, the app shows a countdown to midnight in the learner's time zone, and the coach starts no new AI work until the server confirms the refill.
- F04: "Clear audio cache" deletes only the folder of the signed-in user.
- The limits are environment variables (README, Configuration). The usage is in a new table, `usage_log`, with the same row-level security as the other tables.
- At startup, the backend deletes the files of the old shared cache. No code reads them now.

- Review date: 11 October 2026, Europe/Paris.
- Source revision: `e604cc2`, the same revision as the first audit.
- The first audit is kept without changes in [audit/SECURITY_AUDIT.original.md](audit/SECURITY_AUDIT.original.md). The evidence files in `audit/` are not changed.
- Method: I read the code of each finding. I sent read-only requests to the live API at `https://api.bopomofo.app`: health, voices, docs, schema, two CORS preflights, and two requests without a token. I did not send speech, upload, or TTS requests to the live API. I measured one audio decode on this PC.

## Production facts

These facts change the risk of some findings.

- `api.bopomofo.app` (195.201.27.191, Caddy in front of uvicorn) runs this backend. Its route list is the same as revision `e604cc2`. The speech model is loaded. The OpenRouter key is set.
- The live backend has no Clerk key. All private routes return 503. No private data is open now, but the signed-in features do not work.
- These routes are open without sign-in on the live API: `/api/tts`, `/api/tts/voices`, `/api/health`, `/docs`, `/redoc`, and `/openapi.json`.
- `https://bopomofo.app` returns Vercel `DEPLOYMENT_NOT_FOUND`. The frontend is not deployed now. When you deploy it, set `NEXT_PUBLIC_API_URL=https://api.bopomofo.app` at build time. The fallback uses port 8765 on the page host.
- The full `.app` top-level domain is on the browser HSTS preload list. Browsers use only HTTPS for `bopomofo.app` and its subdomains.

## Kept findings

| ID | Severity before the fix | Finding | Why it was a real risk | Status |
|---|---|---|---|---|
| F01 | High | Anyone can run TTS inference and fill the disk | It is live and anonymous on the server now. Each new text, rate, or voice runs the model and writes a new WAV file, with no quota and no cache limit. | Fixed in code, not deployed |
| F02 | High if sign-up is open | One small audio upload can use about 1 GB of memory | An 89 KB FLAC file (10 minutes of silence) made the decode step use 960 MB before the 30-second check. Anonymous uploads of any size also went to temporary disk before the sign-in check. | Fixed in code, not deployed |
| F03 | Medium if sign-up is open | Signed-in users can spend OpenRouter credit without a limit | Translation, sentence generation, and new coach plans had no quota. A coach plan costs about $0.05 (README). | Fixed in code, not deployed |

The limits are for each account. With open sign-up, one person can make many accounts. If only you need accounts, restrict sign-up in Clerk (restricted mode or allowlist). A credit limit on the OpenRouter key also caps the total spend of all accounts.

### F01: Anonymous TTS

Code: `tts_get` in [api/tts.py](backend/app/api/tts.py), `speak` and `_trim` in [tts.py](backend/app/tts.py), `PUBLIC` in [auth.py](backend/app/auth.py), `playAudio` in [audio.ts](frontend/src/lib/audio.ts).

- `/api/tts` is public because `<audio src>` cannot send a token.
- The cache key is text, rate, and voice. Rate has 101 values and voice has 3 values, so each text can make 303 new files. The cache has no size or age limit.
- Each new request runs the voice model with 8 CPU threads. Requests that wait for a voice lock hold a worker thread. Most API routes use the same 40-thread pool, so a flood of TTS requests also blocks the rest of the API.
- Fix:
  - Done in code: `/api/tts` needs a sign-in. The browser fetches the audio with the token and plays it from a `blob:` URL.
  - Done in code: TTS audio is `Cache-Control: private`.
  - Done in code: the cache is per user, and a user clears only their own folder (F04).
  - Done in code: each user folder stays under `TTS_CACHE_MB_PER_USER` (200 MB). Above it, the clips used least recently are deleted, down to 90%. A replay marks a clip as used.
  - Done in code: `TTS_DAILY_CLIPS` (3,000) new clips per user in 24 hours. A replay from the cache does not count.
- Check: an anonymous `/api/tts` request returns 401 on a local uvicorn server. Tests cover the per-user folder, the clear, the size limit, and the clip limit.

### F02: Audio decode before limits

Code: `BodyLimit` in [middleware.py](backend/app/middleware.py), `read_audio` in [audio.py](backend/app/audio.py), and `speech_analyze` and `symbols_check` in [api/speech.py](backend/app/api/speech.py). FastAPI 0.143 reads the form (`fastapi/routing.py` line 443) before it runs the sign-in dependency (line 499).

- `read_audio` decodes the full file and resamples it before it checks the length. Compressed formats such as FLAC and OGG decode to much larger arrays.
- Measurement on this PC with the same decode steps: an 89,326-byte FLAC file decoded to 28.8 million samples, with a 960 MB memory peak. One hour of audio needs about 6 times more. Two or three requests at the same time can stop the server.
- Anonymous uploads: Starlette writes file parts to temporary disk with no total size limit. This occurs before the sign-in check.
- Fix:
  - Done in code: `read_audio` calls `sf.info()` first. It refuses more than 30.5 seconds in the header, more than 2 channels, or a sample rate outside 8 to 96 kHz. The decoder reads at most the frames in the header.
  - Done in code: `BodyLimit` refuses a body above 1 MB, or 16 MB on the two upload routes, before parsing. It checks `Content-Length`, and reads a chunked body up to the limit.
  - Done in code: upload text fields have length limits (`text` 400 characters).
  - Optional: the same limit in Caddy, for example `request_body { max_size 16MB }`, stops large bodies before they reach uvicorn.
- Check: a test decodes a 10-minute FLAC file: it gets 400 with a memory peak under 20 MB. On a local uvicorn server, a 17 MB anonymous upload and a 2 MB chunked JSON body got 413.
- Removed from F02 as overstated: NaN samples, one extra inference for an invalid symbol, a 2 MB array for a 31-second file, and long text fields before the model check. These have no real effect.

### F03: Paid AI spend

Code: [limits.py](backend/app/limits.py), `_chat` in [llm.py](backend/app/llm.py), [0002_usage_log.sql](backend/app/migrations/0002_usage_log.sql).

- The coach builds one plan at a time for each user. There is no daily limit, and there is no limit on the number of accounts.
- Fix:
  - Done in code: every AI call goes through `llm._chat`. It checks the user's spend and call count since local midnight before the call, and records the call with its cost after it. Limits: `AI_DAILY_LIMIT_USD` ($1) and `AI_DAILY_CALLS` (400). `/api/ai/quota` returns the server time and the next refill time for the countdown.
  - To do in the OpenRouter dashboard: set a credit limit on the key. This caps the total of all accounts.
  - To do in the Clerk dashboard: if the app is only for you, restrict sign-up.
- Check: tests show 429 at the cost limit and at the call limit, and show that another user is not limited. No test calls the provider.
- Removed from F03 as overstated: `max_tokens` (each call is short and cheap, and the key limit caps the total), and 12 open database connections with `POOL_SIZE=10` (`POOL_SIZE` limits idle connections only, and 12 is far below the PostgreSQL default of 100).

## Excluded findings

| ID | First severity | Why I excluded it | Optional low-cost step |
|---|---|---|---|
| F04 | High | The TTS cache holds only audio that the server can make again. A user who clears it causes slower first plays and nothing more. Anonymous users can already cause more load through F01. | Fixed after this review: the cache is per user, and a user clears only their own folder. |
| F05 | High | `sslmode=require` has the standard PostgreSQL meaning: encrypted, certificate not checked. An attack needs a position on the network path between the API server and the database. It does not apply when the database is on the same server. The code already supports `verify-full`. | Use `sslmode=verify-full` if the live database is on another host. |
| F06 | Medium | The exposed text is exception text, for example a model path. The audit showed no secret and no data of another user. On the live API, `speech_error` is null. | Return a fixed message in `errors_as_json`. |
| F07 | Medium | Test keys are a development setting on this PC. The `azp` gap needs a valid token signed by this Clerk instance. The API reads bearer tokens only, so another site cannot make the browser send one. The README already tells you to set `CLERK_AUTHORIZED_PARTIES`. | Set `CLERK_AUTHORIZED_PARTIES=https://bopomofo.app` when you add the Clerk key to the server. |
| F08 | Medium | Each example is a signed-in user who writes bad values into their own rows. Row-level security keeps the values in that user's data. The only effect is wrong stats, or a 500 error, for that user. The body limit in F02 caps large payloads. | Limit `days` in `/api/stats` to stop the 500 error. |
| F09 | Medium | The CSV export holds only the user's own rows, and only that user can write them. Generated sentences cannot contain Latin letters or digits (`_clean` in llm.py), so they cannot hold a formula. | None. |
| F10 | Medium | A shared proxy cannot store HTTPS responses. The API has no CDN: DNS points to the server. The browser cache is private to each user. Access logs stay on your server. | The F01 fix covers it (token and `private` cache). |
| F11 | Medium | The audit measured the local frontend. The production frontend is not deployed. React escapes output, and the only raw HTML is a fixed theme script. `.app` already has HSTS preload. A full CSP that works with Clerk is too much work for this risk. | Add `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` in `next.config.ts` `headers()`. |
| F12 | Medium | `cryptography` 46.0.3 is the Windows ARM build on this PC. `requirements.txt` does not pin a version, so a Linux server gets the current release. The audit found no reachable path for the advisories. `braces` is in the ESLint development chain only. Model downloads run once at setup from fixed URLs. | Run `pip show cryptography` on the server to confirm its version. |
| F13 | Low | The live API accepts `https://evil.bopomofo.app` and LAN origins. But the API uses bearer tokens only, and CORS does not allow credentials. A foreign page cannot get the token. No backend logic uses the Host header. | Limit the origin list. |
| F14 | Low | The live schema shows only route names. The frontend JavaScript shows the same names. Every private route still needs a token. | `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`. |
| F15 | Low | A personal app does not need a security event pipeline. The useful alerts (provider spend and disk use) are part of the F01 and F03 fixes. | None. |

I also removed one note from the limits of the first audit: "Local PostgreSQL listens on all network addresses". It applies only to this PC.

## Order of work

1. Deploy the backend and the frontend together. The new backend refuses TTS requests without a token, so the old frontend cannot play audio with it. F01 stays open on the live API until you deploy.
2. Set the OpenRouter key credit limit. Choose the Clerk sign-up mode.
3. Add the Clerk key and `CLERK_AUTHORIZED_PARTIES` to the server. Deploy the frontend with `NEXT_PUBLIC_API_URL`.

## Controls that passed

The first audit tested these controls, and they passed. I did not test them again.

- All 28 protected API operations rejected requests without credentials.
- The Clerk verifier rejected malformed, expired, future, unsigned, HMAC, and wrong-signature tokens.
- Missing sign-in configuration fails closed with 503. The live API shows this now.
- The database role is not a superuser and has no BYPASSRLS. All 11 user-data tables have ENABLE and FORCE row-level security.
- Cross-user reads, writes, and deletions did not cross the data boundary. Pooled connections reset the user.
- SQL payloads stayed query parameters. Profile fields use an allowlist.
- React escaped HTML in story text, chips, and labels.
- The pattern scan found no secret in tracked files or in Git history.

## Limits of this review

- I did not test the live API with a token, uploads, or speech requests. The live API has no Clerk key, and I did not want to load the live server.
- I did not check the Clerk sign-up mode. The severity of F02 and F03 depends on it.
- I did not check the live database host or its `sslmode`.
- I sent one POST request without a token to `/api/tts/cache/clear` on the live API to confirm that it is closed. It returned 503 and changed nothing.

## Evidence and reproduction

The commands and evidence files are in the first audit: [audit/SECURITY_AUDIT.original.md](audit/SECURITY_AUDIT.original.md). The probe results are in [audit/red-team-results.json](audit/red-team-results.json).

The F02 decode measurement, from `backend`:

```powershell
.venv\Scripts\python.exe -c "import io, tracemalloc, numpy as np, soundfile as sf; b = io.BytesIO(); sf.write(b, np.zeros(48000*600, dtype=np.float32), 48000, format='FLAC'); d = b.getvalue(); print(len(d)); tracemalloc.start(); a, r = sf.read(io.BytesIO(d), dtype='float32'); n = int(len(a)*16000/r); x = np.interp(np.linspace(0, len(a)-1, n), np.arange(len(a)), a).astype(np.float32); print(tracemalloc.get_traced_memory()[1] // 10**6, 'MB')"
```
