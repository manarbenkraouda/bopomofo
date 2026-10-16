# Run bopomofo locally

Choose your platform guide, then complete the shared configuration steps.

| Platform             | Guide                 | Evidence                                                                                        |
| -------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| Windows ARM64        | [Windows](windows.md) | Maintainer's reference setup: Snapdragon X2 Elite, Python 3.12 ARM64, PostgreSQL, Bun, CPU ONNX |
| Windows x64          | [Windows](windows.md) | Runtime wheels resolve for Python 3.12; full hardware setup is not tested here                  |
| macOS, Apple Silicon | [macOS](macos.md)     | Runtime wheels resolve for Python 3.12; full hardware setup is not tested here                  |
| macOS, Intel         | [macOS](macos.md)     | Runtime wheels resolve for Python 3.12; export the speech model on another supported machine    |

The Windows batch scripts are for the ARM64 reference setup. The manual commands below do not require changes to those scripts.

## What you need

- Git, [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/), and PostgreSQL 14 or newer.
- Python 3.12 for your CPU architecture. uv can install it.
- Your own [Clerk](https://clerk.com/) application for sign-in and an [OpenRouter](https://openrouter.ai/) API key for sentence and coach generation.
- Several GB for speech weights, voices, and packages. Model export also downloads the original weights and needs extra disk space and memory.
- A browser with microphone access. `localhost` works for local microphone use. A phone connecting over plain LAN HTTP can require HTTPS.

The app is not fully offline. Speech recognition and voice synthesis run locally, but sign-in uses Clerk, and generation sends prompts to OpenRouter. Prompts can include learner profile fields and practice statistics.

## 1. Clone

```sh
git clone https://github.com/manarbenkraouda/bopomofo.git
cd bopomofo
```

If the repository is still private, your GitHub account needs access.

## 2. Create two databases

Open `psql` as a PostgreSQL administrator. Choose a password and replace `CHANGE_ME`:

```sql
CREATE ROLE bopomofo_app LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE bopomofo OWNER bopomofo_app;
CREATE DATABASE bopomofo_test OWNER bopomofo_app;
```

The application role owns both databases. It must not be a superuser or have `BYPASSRLS`. The backend checks this. Startup applies `backend/app/migrations/*.sql` in order.

`bopomofo_test` is disposable. Tests erase its learner tables. Never use the same database for `DATABASE_URL` and `TEST_DATABASE_URL`. Run only one backend test process at a time.

## 3. Configure your accounts

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`. Platform guides include the copy commands.

In the Clerk dashboard, create a development application with the sign-in methods you want. Use keys from that same application in both processes:

| File                  | Required values                                                               |
| --------------------- | ----------------------------------------------------------------------------- |
| `backend/.env`        | `DATABASE_URL`, `TEST_DATABASE_URL`, `CLERK_SECRET_KEY`, `OPENROUTER_API_KEY` |
| `frontend/.env.local` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`                       |

Example database addresses, with your password substituted:

```dotenv
DATABASE_URL=postgresql://bopomofo_app:CHANGE_ME@127.0.0.1:5432/bopomofo
TEST_DATABASE_URL=postgresql://bopomofo_app:CHANGE_ME@127.0.0.1:5432/bopomofo_test
```

URL-encode reserved characters in a password. Use the example frontend API address, `http://localhost:8765`, for these guides. Keep the frontend origin consistent: open `http://localhost:3210`.

The frontend's `CLERK_SECRET_KEY` is a server key. Never add a `NEXT_PUBLIC_` prefix to it. The publishable key is the only Clerk key intended for browser code.

For optional limits and runtime controls, see [configuration](../configuration.md).

## 4. Install and start

Follow [Windows](windows.md) or [macOS](macos.md). Install the voice models and provide the speech model before you test recording.

Open `http://localhost:3210`, sign up in your own Clerk application, and finish onboarding. Say one full sentence early so the app can learn your pitch range.

The API starts on `http://127.0.0.1:8765`. Its `/api/health` response shows speech-model readiness. Most API paths require a sign-in token. A `401` from those paths is expected when you open them without a token.

## Troubleshooting

| Problem                          | Check                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| No compatible wheel              | Check that Python 3.12 and its architecture match your machine. Do not reuse a virtual environment copied from another platform.           |
| Database refuses startup         | Check that PostgreSQL is running and the role owns the database without superuser or `BYPASSRLS`.                                          |
| Sign-in loops or API returns 401 | Check that both processes use keys from the same Clerk application and that your frontend origin is allowed.                               |
| Speech check stays unavailable   | Check both ONNX files, `vocab.json`, model-path overrides, and backend logs. Loading runs in the background.                               |
| Slow or noisy microphone         | Test a full sentence first. Check microphone permissions and the selected device. Hardware tests are separate from synthetic speech tests. |
| No new sentences or coach plan   | Check the OpenRouter key, account credit, and the app's daily quota.                                                                       |
| A port is already in use         | Select another port. Set `NEXT_PUBLIC_API_URL` to the actual backend address and restart the frontend.                                     |
| Frontend has old code            | Development mode updates on edits. For `start.cmd` or `next start`, rebuild after frontend changes.                                        |

## Official setup references

- [uv Python installations](https://docs.astral.sh/uv/guides/install-python/)
- [Bun installation](https://bun.sh/docs/installation)
- [Clerk Next.js quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart)
- [PostgreSQL downloads](https://www.postgresql.org/download/)
- [PyTorch installation](https://pytorch.org/get-started/locally/)

The platform matrix records what was checked for this cleanup. Dependency resolution is not proof of microphone, inference, or browser behavior on another machine.
