# Configuration

The backend reads `backend/.env` through `app/config.py`. The frontend reads `frontend/.env.local`. Copy the tracked example files first. These files belong to your machine and are ignored by Git.

## Accounts and data

| Variable                            | Process      | Purpose                                                              |
| ----------------------------------- | ------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`                      | Backend      | PostgreSQL database owned by the normal application role             |
| `TEST_DATABASE_URL`                 | Tests        | Separate, disposable database; tests erase its learner tables        |
| `CLERK_SECRET_KEY`                  | Both servers | Clerk session validation; use the same Clerk application             |
| `CLERK_JWT_KEY`                     | Backend      | Optional PEM public key for token validation                         |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Frontend     | Browser-safe key for your Clerk application                          |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | Frontend     | `/sign-in`                                                           |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     | Frontend     | `/sign-up`                                                           |
| `NEXT_PUBLIC_API_URL`               | Frontend     | API base address; local guides use `http://localhost:8765`           |
| `CLERK_AUTHORIZED_PARTIES`          | Backend      | Optional comma-separated frontend origins accepted in session tokens |
| `DEFAULT_TIMEZONE`                  | Backend      | `UTC` until the learner chooses a time zone                          |
| `MODEL_DIR`                         | Backend      | Model directory; defaults to `backend/models`                        |
| `DATA_DIR`                          | Backend      | Learner cache and recording directory; defaults to `backend/data`    |

`NEXT_PUBLIC_*` values enter the browser bundle. Rebuild a production frontend when they change. Never put a secret key in one of those variables.

For a remote database, the connection supports `sslmode=require` or `verify-full`. Local setup uses a loopback database address. Keep `ALLOW_RLS_BYPASS` unset in normal use; it is for controlled tests and tools.

## Model calls and limits

| Variable                | Default                        | Purpose                                                          |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `OPENROUTER_API_KEY`    | Empty                          | Required for remote sentence, translation, and coach model calls |
| `OPENROUTER_MODEL`      | `deepseek/deepseek-v4.1-flash` | Sentence and translation model                                   |
| `COACH_MODEL`           | `typesafe/jev-router`          | Coach model route                                                |
| `AI_DAILY_LIMIT_USD`    | `1`                            | Model spend per learner per local day                            |
| `AI_DAILY_CALLS`        | `400`                          | Model call limit per learner per local day                       |
| `TTS_DAILY_CLIPS`       | `3000`                         | New voice clips per learner in 24 hours                          |
| `TTS_CACHE_MB_PER_USER` | `200`                          | Per-learner voice cache size                                     |

The app limits usage; external model calls still require an account with credit. Model availability and prices can change. Do not put account-specific keys or credit details in documentation or tests.

## Speech runtime

| Variable          | Values                                | Purpose                                                |
| ----------------- | ------------------------------------- | ------------------------------------------------------ |
| `SPEECH_RUNTIME`  | `local`, `vps`                        | CPU tuning profile                                     |
| `ASR_MODEL_FILE`  | File path or model-directory filename | Explicit speech model selection                        |
| `ASR_NUM_THREADS` | Positive integer                      | Speech inference threads                               |
| `TTS_NUM_THREADS` | Positive integer                      | Voice synthesis threads                                |
| `DEEP_CHECK`      | `off`, `shadow`, `apply`              | Background speech review; default `shadow`             |
| `SAVE_QUIZ_CLIPS` | `1` or empty                          | Opt-in retention of reading quiz clips; off by default |

Without a profile, Linux uses `vps`; other systems use `local`. The local profile uses all CPU cores for speech and 8 voice threads. The VPS profile uses at most 4 threads for each. Both use CPU ONNX Runtime. The app prefers the FP32 speech model when present and falls back to int8 when it is absent.

Keep `DEEP_CHECK=shadow` until the evaluation gate in `backend/tools/eval_deep_check.py` has been checked. `apply` can change saved grading results.

## Data boundaries

- The database stores profiles, sentence libraries, answer evidence, plans, and learning progress per Clerk user.
- The frontend HUD uses browser storage for today's display. The database holds the full answer history.
- The local speech model receives recordings for scoring. Voice synthesis uses local model weights.
- Clerk handles sign-in. OpenRouter receives prompts for remote model calls. Prompts can include profile fields and practice stats.
- Keep recordings, model weights, cache files, and database exports out of Git.
