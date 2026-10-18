# bopomofo

**Learn Taiwan Mandarin, one sound at a time.**

Read 注音. Write each stroke. Hear the difference. Say it yourself.

<p align="center">
  <img src="frontend/public/mascot/bobo.webp" alt="Bobo, the bopomofo mascot" width="200" />
</p>

bopomofo is a practice app for the 37 Bopomofo symbols and Taiwan Mandarin. It combines local speech checks, handwriting feedback, and a coach that uses your practice history to choose the next drill.

[Run locally](docs/setup/README.md) · [Learner guide](docs/user-guide.md) · [Architecture](docs/architecture.md) · [Contribute](CONTRIBUTING.md)

## Practice, with useful feedback

| Skill   | What you do                                                | What the app checks                                 |
| ------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Read    | Say a symbol or type its pinyin                            | Symbol recognition and recall                       |
| Listen  | Identify tones, symbols, and tone changes                  | Confusions and spoken tone rules                    |
| Write   | Draw symbols, syllables, and words                         | Shape, stroke order, direction, and missing strokes |
| Speak   | Record syllables and sentences                             | Initials, finals, tones, and pitch                  |
| Numbers | Hear a number and pick it, or say a number shown in digits | Teens and tens, place values, 零, and tones         |

- **A guided path:** five levels, an optional placement test, and permanent exercise unlocks.
- **A coach with evidence:** focused drills, progress checks, and explanations tied to saved statistics.
- **Personal sentences:** Taiwan Mandarin, Bopomofo, English, word meanings, and local audio.
- **Practice from memory:** helped answers and later tries stay distinct from first-try recall.
- **Keyboard and touch controls:** press and hold to record, writing with a pointer, and page shortcuts.

The [learner guide](docs/user-guide.md) lists every mode, shortcut, and learning rule.

## Run your own instance

You need Git, uv, Bun, PostgreSQL, your own Clerk application, and an OpenRouter API key. Speech weights and voice models are downloaded separately.

1. Follow the [shared setup](docs/setup/README.md): clone the repository, create the databases, and configure your accounts.
2. Install packages and speech models with your platform guide.
3. Start the API on port `8765` and the frontend on port `3210`. Open `http://localhost:3210` and finish onboarding.

| Platform             | Instructions                           | Validation                                                             |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Windows ARM64        | [Windows guide](docs/setup/windows.md) | Maintainer's reference setup on Snapdragon X2 Elite                    |
| Windows x64          | [Windows guide](docs/setup/windows.md) | Python 3.12 runtime packages resolve; hardware run still needed        |
| macOS, Apple Silicon | [macOS guide](docs/setup/macos.md)     | Runtime and export packages resolve; hardware run still needed         |
| macOS, Intel         | [macOS guide](docs/setup/macos.md)     | Runtime packages resolve; copy speech exports from a supported machine |

Package resolution is not a full platform test. The guides state these limits and include manual commands. `setup.cmd` uses the Windows ARM64 reference configuration.

Speech recognition and voice synthesis run locally on the CPU through ONNX Runtime. Sign-in uses Clerk. Sentence and coach generation use OpenRouter and can include your profile fields and practice statistics. The app is not fully offline.

## Find your way through the code

```text
backend/
  app/api/         HTTP routes
  app/coach/       Planning, validation, progress, and jobs
  app/story/       Evidence and plan explanations
  app/migrations/ PostgreSQL schema
  app/            Speech, scoring, storage, and learning rules
  tests/          Domain, API, database, and speech tests
  tools/          Model preparation and diagnostics
frontend/
  src/app/        Next.js routes
  src/components/ Practice screens and local views
  src/lib/api/    Transport, events, audio, and typed contracts
  src/lib/        Scheduling, input, audio capture, and UI state
docs/             Setup, architecture, configuration, and operations
```

The backend uses FastAPI and PostgreSQL with per-user row-level security. The frontend uses Next.js, React, and TypeScript. Model output passes fixed checks before it can become a plan or explanation.

Read [architecture](docs/architecture.md) for module ownership and behavior rules. Read [configuration](docs/configuration.md) for environment variables, limits, and model paths. Existing server operations are described in [deployment](docs/deployment.md).

## Work on the project

From `frontend/`:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

The build needs your Clerk configuration. Backend checks need a separate test database. Tests erase its learner tables. [CONTRIBUTING.md](CONTRIBUTING.md) has the exact commands and separates fast tests from tests that need speech weights or remote generation.

Refactors must preserve API responses, grading rules, prompts, keyboard actions, saved keys, and background work. The [cleanup verification record](docs/cleanup-verification.md) states what was checked and what still needs a device or signed-in browser.

## License

The source code is licensed under [AGPL-3.0-only](LICENSE). If you run a changed copy as a service for other people, you must share its source code under the same license.

The models, data, and media have their own terms. The speech model is for noncommercial use only (CC-BY-NC-4.0). The MOE symbol files need an attribution. Some voice clips must be replaced before a public release. Read [license and third-party terms](docs/licensing.md) before you redistribute the project.
