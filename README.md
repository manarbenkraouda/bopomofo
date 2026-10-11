# bopomofo

A personal app to learn Bopomofo (注音符號) and Taiwan Mandarin: reading, writing, listening, and speaking with feedback on every stroke and every tone.

- **Frontend:** Next.js 16 (frontend/), http://localhost:3210
- **Domain:** https://bopomofo.app
- **Backend:** FastAPI (backend/), http://127.0.0.1:8765 (port 8000 is used by Docker on this PC)
- **Location on this PC:** C:\Users\manar\Documents\zhuyin-studio

## Start

Double-click **start.cmd**. It opens two small windows (backend and frontend) and the browser. Close those windows to stop the app.

A new account starts with a short onboarding (/onboarding, seven questions): your name, why you learn Mandarin, your Mandarin level, how much Bopomofo you know, a daily goal, your time zone, and the microphone. The answers go into your profile, and the coach writes your first plan from them. Every other page sends you to the onboarding until it is done.

Record one full sentence on the Speaking page early. The app learns your pitch range from it and uses it to check single-syllable tones.

## Install on a new machine

The repository does not contain the secret key, the speech model (3.6 GB), or your personal data. To install:

1. Install [git](https://git-scm.com), [uv](https://docs.astral.sh/uv/) and [bun](https://bun.sh).
2. Clone the repository:

       git clone git@github.com:manarbenkraouda/bopomofo.git
       cd bopomofo

3. Create the PostgreSQL role and databases (see Database).
4. Run **setup.cmd**. It creates the Python environment, installs the frontend packages, and creates backend/.env.
5. Fill in backend/.env: the OpenRouter key, DATABASE_URL, and the Clerk secret key. Run `clerk env pull --file frontend/.env.local` for the Clerk keys of the frontend (see Sign-in), then `cd frontend && bun run build`.
6. Create the speech model (see Speech model), or copy the backend/models folder from another machine.
7. Run **start.cmd**.

setup.cmd uses the Windows ARM64 Python (cpython-3.12-windows-aarch64). On an x64 PC, change it to cpython-3.12-windows-x86_64.

## What is inside

| Page | What it does |
|---|---|
| Onboarding | After sign-up, one question per screen: name, why you learn, Mandarin level, Bopomofo level, daily goal, time zone (found on the device, with a search of every zone), and the microphone. Back, a progress bar, a fixed Continue bar on a phone, and keys on a desktop (Enter, Esc, 1-6). The answers go to the profile and the settings, and the coach builds the first plan from them. Signed-in learners who have not finished it are sent back to it. |
| Home | Progress: day streak, accuracy per area, tone accuracy, symbols to practice, system status. |
| Coach | A plan written by a model from all your stats: 3 to 7 exact drills, each with the numbers that justify it ("tone 4 by ear: 78.6% on 28, often taken for tone 2"). A step ends when you reach its target, never on a date. Only answers given inside a step count for it. Every 10 answers in a step, the coach checks them and can continue, narrow the focus, extend, ease, or end the step. When a step ends, it compares the step with the 30 days before. When one step is left, the next plan is built in the background, so it is ready at once. Milestones are long goals measured on your latest answers. "How do we know?" (W) opens the plan story: a headline and cards with the evidence behind the plan. Skip a step with H (too hard), E (too easy), or N (not now); P builds a new plan now. Home shows the next step first (Enter starts it). |
| Stats | Full history, down to each tone and stroke. Today: four daily challenges from your weakest skills, ranked weak spots (press Enter to train one), period totals against the period before, and personal records. Tones: confusion tables (the tone you said, heard, or wrote instead), tone accuracy by the tone before and after, position, and tone changes. Sounds: initial and final mix-ups. Symbols: per-symbol accuracy, what you said, typed, or wrote instead, the symbols you take for others in Recognize, and stroke problems. History: answers per day, practice calendar, time of day, sessions, the last answers, and a CSV export. Every "Train" link opens a practice mode limited to that weak spot (?tones=3,2 or ?syms=ㄗ,ㄘ). |
| Reading | Random symbols without end: say each one out loud. The app hears you hands-free and moves on when you say it right. After you hear the answer (MOE recording), you still say the symbol to move on, and the card counts as not known yet. |
| Listening | Quizzes: name the tone, or pick the matching Bopomofo. After an answer, compare the tones of the same syllable. |
| Dictation | Random symbols without end: hear a symbol name, then write the symbol by hand. Stroke order counts. After Show strokes, you still write the symbol yourself, and the card counts as not known yet. |
| Speaking | A quiz: one card at a time, read it aloud and record (or upload a recording). A local speech model checks each syllable: initial, final, and tone. It shows your pitch curve against the target tone shapes, and handles tone changes (3-3 sandhi, 一, 不). The Cheat button (Space) plays the model and unlocks the slow audio and the Pinyin; the recordings after it count as helped in the stats. Cards: your sentences, single syllables, or any text you type. |
| Writing | Hear a sound and write the Bopomofo by hand on one ruled sheet, left to right, with a small space between symbols and the tone mark after each syllable. The app splits the ink into symbols and tone marks (bars under the writing show the split), lines them up with the answer, and corrects each one: wrong symbol, stroke order, direction, missing, extra, joined strokes, shape. Missing symbols show as pink ghosts. Modes: single symbols, syllables with tone marks, and words from your sentences. Watch the correct stroke order after each answer. |
| Recognize | Symbol recall with no microphone. The symbol pronunciation plays after a correct answer. A symbol is shown, and you type its pinyin with your own keyboard (b or bo for ㄅ, zh for ㄓ, v or ü for ㄩ, eh or ê for ㄝ). A wrong answer shows which symbol your pinyin stands for, and the stats save it as that symbol (ㄓ typed as z = ㄗ). Text that is the pinyin of no symbol is refused and does not count. Space shows the answer; after it, you still type the answer, or skip with →. ?learn=1 shows the answer from the start for repetition. |
| Symbols | The 37 symbols and 5 tones, with official MOE recordings and animated stroke order. Each symbol shows if you know it, are learning it (with its count of repetitions), or have not practiced it yet. P shows or hides the Pinyin hints. |
| Sentences | Generates short Taiwan Mandarin sentences on any topic (OpenRouter, deepseek/deepseek-v4.1-flash), at your level and about your own life (from your profile). Each sentence has Bopomofo beside the characters (Taiwan style), English, word glosses, and audio (normal and slow). Z switches between Bopomofo, Pinyin, and characters only. Click a character to hear it. Quick lookup: paste any Chinese text to get Bopomofo, audio, and a translation. Sentences are saved in a library. |
| Profile | Facts about you in English (name, job, city, family, hobbies, level...). Generated sentences use them. Leave a field empty to skip it. |
| Settings | AI energy, voice, theme (dark or light), daily goal, time zone, and sound effects. The daily goal and the time zone are saved with your account, so they are the same on every device. |

Keyboard: G then a letter = go to a page (G H Home, G C Coach, G T Stats, G R Reading, G L Listening, G D Dictation, G S Speaking, G W Writing, G I Recognize, G B Symbols, G E Sentences, G P Profile, G , Settings), Ctrl+K = commands, ? = all shortcuts, M = sounds on or off, Alt+Enter = full screen. In the practice modes: Space = play, Enter = check / next, R = record (Speaking), Ctrl+Z = undo stroke (Writing), 1-4 = answer (Listening). In Recognize, the letters type pinyin: Esc leaves the answer field so the app keys work, and Enter goes back to it.

## How it works

- **Speech model:** [Chuatury/wav2vec2-mms-1b-cmn-phonetic](https://huggingface.co/Chuatury/wav2vec2-mms-1b-cmn-phonetic), exported to ONNX and run on the CPU with ONNX Runtime. It outputs Bopomofo with tones per syllable. About 0.5 s of processing for a 2.5 s sentence on the Snapdragon X2 Elite. License: CC-BY-NC-4.0 (personal use).
- **Symbol names (Reading):** free transcription is weak on one short sound, so the backend asks a narrower question: which of the 37 symbol names fits the audio best (backend/app/symbols.py). Each name gets a CTC score from the speech model, without tones, and the best name wins. The browser listens hands-free and sends each utterance with 0.3 s of audio before and after it.
- **Tones on single syllables:** the model labels many Taiwan-style low-falling tone 3 syllables as tone 4. The backend learns your pitch range from your sentence recordings and corrects these cases. Measured on 198 isolated syllables (two Taiwan TTS voices): 161 correct (81%). Most remaining errors are TTS tone-1 clips that fall in pitch. Record one sentence before single-syllable practice.
- **Bopomofo for text:** pypinyin with Taiwan (MOE) corrections for common words (星期 ㄑㄧˊ, 垃圾 ㄌㄜˋ ㄙㄜˋ, 誰 ㄕㄟˊ...), and neutral-tone dots in front (˙ㄇㄚ). Some readings can still follow mainland usage.
- **Audio:** offline voices: Kokoro v1.1-zh (female, default, and male) and MediaTek Breeze2-VITS (Taiwan accent). Kokoro's downloaded model includes its Apache-2.0 license. The Breeze2 ONNX model card currently has no license metadata; verify the weight terms before commercial deployment. Choose a voice in Settings. On test sentences the speech model scored Kokoro 93-100 and Breeze2 87-100 (average 93). Breeze2 runs directly on ONNX Runtime with the app's own Zhuyin analyzer, because the sherpa-onnx text front end merged and dropped its syllables. setup.cmd downloads the voices (backend/tools/download_voices.py) into backend/models. Audio is cached per user in backend/data/tts/<user id>; "Clear audio cache" in Settings deletes only your own clips.
- **Writing data:** stroke outlines and centerlines from the Taiwan Ministry of Education 國語注音符號手冊; stroke counts match the handbook for all 37 symbols.
- **Data:** PostgreSQL (DATABASE_URL): sentences, practice history, coach plans, profile, settings, and your pitch reference, per user. backend/data keeps only the audio cache. Git ignores this folder.
- **Time zone:** each learner's settings (meta key "settings": time zone, daily goal, level, onboarding answers) set where their day starts. The day of each answer, the streak, "today" in the stats and the coach, the hours chart, and the CSV times use it. Change it in Settings. A learner without one uses DEFAULT_TIMEZONE (UTC).
- **Users:** sign-in is Clerk. The frontend sends the Clerk session token with every API request, and the backend checks it (backend/app/auth.py). Every table has a user_id column, and PostgreSQL row-level security shows each request only the rows of its user (backend/app/db.py). /api/health and /api/tts/voices are open without sign-in. /api/tts needs a sign-in too: the browser fetches each clip with the token and plays it from memory (frontend/src/lib/audio.ts).
- **Limits:** each user has a daily AI energy meter (backend/app/limits.py, table usage_log). New sentences, translations, coach plans, checkpoints, and stories use it. When it is empty, the top bar and the screen show a countdown to midnight in the learner's time zone; AI buttons stay locked until the server confirms the refill, while saved sentences and practice keep working. A new audio clip limit uses the last 24 hours. Above a limit the API answers 429. Request bodies are limited to 1 MB (16 MB for audio uploads), and a recording must be 30 s or shorter in its header before it is decoded. See Configuration for the values.
- **Practice history:** one row per answer in "events" (area, mode, item, right or wrong, time to answer, tries, help, replays), and one row per part of the answer in "units": the expected tone, initial, final, symbol, syllable, or stroke, and what you actually produced. Speaking also saves the tone before and after, the tone change, and which signal judged the tone. "days" keeps your active minutes per day.
- **Days and time zones:** each user has a time zone (set in the onboarding or in Settings). Your day starts at midnight there, and the streak, the daily goal, the stats per day and per hour, the daily challenges, and the coach all follow it. A user without a time zone gets DEFAULT_TIMEZONE.
- **Coach (backend/app/coach.py):** a pipeline of small model decisions, all logged in the "coach_calls" table with model, time, and cost. 1) Five analysts in parallel (listening tones, speaking tones, sounds, symbols, sentences) and a pace call. 2) A planner turns the findings into steps. 3) For each step: a writer makes new sentences for an exact focus (tones, tone pairs such as 3-3, symbols); the app's Bopomofo analyzer checks each sentence and sends rejected ones back with the reason. A picker chooses the exact syllables of a drill deck, and the app checks that the deck holds every focus tone. 4) A reviewer keeps, drops, or changes each step, and a milestone call sets the long goals. The backend checks every decision: unknown symbols are dropped, targets are clamped, a checkpoint can only shrink a focus to a subset, and a listening quiz keeps at least two tones. If the model fails, a plan is built by rules. A plan costs about $0.05 and takes 40-50 s; a checkpoint costs about $0.003 and takes 4-14 s. Steps open practice modes with ?step= (answers carry the step id), ?items= (a deck), and ?ids= (sentences). The first plan waits for the onboarding, so it can use your level, goal, and reasons.
- **Recognize (frontend/src/lib/pinyin.ts):** every symbol has one pinyin answer and the syllable it is named with (ㄅ b / bo, ㄧ i / yi / y), and no two symbols share a spelling. So a wrong answer always names the symbol you took it for, and each try is saved as a symbol unit with that symbol as "actual" and the typed text in "extra". The coach sees these mix-ups (symbols.recognize_mixups) and can plan recognize_symbols steps with both symbols of a pair.
- **Alphabet rule:** the 37 symbols come first. This is a rule in code, not a model decision. A symbol is known when you say it, type its pinyin (Recognize), or write it right on the first try, without help, in the last 2 answers and in 80% of the last 5. While you know fewer than 30 symbols, every plan starts with the next group of symbols to learn (the weakest symbols already seen, then at most 4 new ones), and drills that show Bopomofo wait. A new symbol starts with 10 repetitions with the answer shown; recall tests start after that.
- **Plan story (backend/app/story.py):** the model writes the headline and the "How do we know?" cards from a fixed catalog of blocks (text, numbers, charts, symbols). It never writes a number itself: it points to facts that the backend computed from the plan's saved stats, and the backend fills them in. If the model is not available, a fixed story is built from the same facts.

## Configuration

backend/.env:

    OPENROUTER_API_KEY=sk-or-...
    OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash
    COACH_MODEL=typesafe/jev-router    # optional; the coach falls back to OPENROUTER_MODEL
    DATABASE_URL=postgresql://bopomofo_app:...@127.0.0.1:5432/bopomofo
    TEST_DATABASE_URL=postgresql://bopomofo_app:...@127.0.0.1:5432/bopomofo_test
    CLERK_SECRET_KEY=sk_test_...
    CLERK_AUTHORIZED_PARTIES=https://bopomofo.app   # production: the frontend origins
    DEFAULT_TIMEZONE=UTC                            # optional; for users who have not chosen a time zone yet
    AI_DAILY_LIMIT_USD=1                            # optional; AI spend per user each local day, refilled at midnight
    AI_DAILY_CALLS=400                              # optional; AI calls per user each local day, refilled at midnight
    TTS_DAILY_CLIPS=3000                            # optional; new audio clips per user in 24 hours (replays are free)
    TTS_CACHE_MB_PER_USER=200                       # optional; audio cache per user; the clips used least recently go first

frontend/.env.local (written by `clerk env pull`):

    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
    CLERK_SECRET_KEY=sk_test_...
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
    NEXT_PUBLIC_API_URL=https://api.bopomofo.app    # optional; default: the page's host on port 8765

## Database

PostgreSQL 14 or newer. The backend applies backend/app/migrations/*.sql in order when it starts (table schema_migrations).

The app role must own the database and must not be a superuser or have BYPASSRLS: those roles skip row-level security, so every user would see all data. The backend refuses to start with such a role. As the postgres superuser:

    CREATE ROLE bopomofo_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
    CREATE DATABASE bopomofo OWNER bopomofo_app;
    CREATE DATABASE bopomofo_test OWNER bopomofo_app;

On a hosted PostgreSQL (Neon, Supabase, RDS...), create the same kind of role; the default admin role often has BYPASSRLS. Add ?sslmode=require (or verify-full) to a remote DATABASE_URL.

To move your old SQLite history (backend/data/zhuyin.db) into PostgreSQL, sign up in the app and finish the onboarding, find your user id (`clerk users list`), then:

    cd backend && .venv\Scripts\python tools\import_sqlite.py --user user_...

It copies everything in one transaction, with new row ids and every link between rows kept. The imported plans replace the first plan of the onboarding; the onboarding answers stay, and the old profile fills the facts left empty. It also copies backend/data/speaker.json (your pitch reference).

## Sign-in

Clerk app: bopomofo.app (app_3KWA4ktlOfTZ3w6bU2m7u62MJkC), linked with `clerk link`. `clerk env pull --file frontend/.env.local` writes the development keys; rename CLERK_PUBLISHABLE_KEY to NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY if the CLI did not detect Next.js. For production, run `clerk deploy`, use the production keys (`clerk env pull --instance prod`), and set CLERK_AUTHORIZED_PARTIES. frontend/src/proxy.ts sends signed-out visitors to /sign-in.

## Production

The frontend runs on Vercel (project bopomofo, team the-tech-nation), connected to this repository with frontend/ as the root directory: every push to main deploys it. The API runs on the VPS behind Caddy at https://api.bopomofo.app, with its settings in /etc/bopomofo/api.env. It has two systemd slots, bopomofo-api@8765 and bopomofo-api@8766; one serves, and /etc/caddy/bopomofo-api-upstream (imported in the api.bopomofo.app block of the Caddyfile) names its port.

New commits on main also deploy the API, without downtime. Every minute, bopomofo-deploy.timer runs `bopomofo-deploy poll`, which fetches the repository with a read-only deploy key. When backend/ or frontend/public/data/ (the syllables the coach reads) changed, it copies both into /opt/bopomofo/releases, installs backend/requirements.txt in a Python environment (reused while the file stays the same), and runs the tests on bopomofo_test, without the speech tests and the live OpenRouter test. Then it starts the new release in the idle slot while the other keeps serving, and waits until the speech model is ready and a request without a token gets 401. Caddy reloads with the new port (requests in progress finish on the old one), https://api.bopomofo.app must answer, and the old slot stops after finishing its requests (at most 60 s). If any step fails, the new slot stops and the old one keeps serving; the commit gets a failed "deploy/api" status on GitHub. A rollback runs the previous release the same way. Coach work running in the background of the old slot (sentence generation) is lost at the switch. Migrations run when the new release starts, while the old one still serves, and a rollback does not undo them, so keep them compatible with the previous code.

    sudo bopomofo-deploy status                  # running commit, previous release, last commit seen
    sudo bopomofo-deploy deploy origin/main      # deploy now (also a branch or a SHA)
    sudo bopomofo-deploy rollback                # back to the previous release
    journalctl -u bopomofo-deploy -f             # deploy log

To set this up on a new VPS, run `sudo deploy/vps/install.sh` and follow what it prints; it also points the api.bopomofo.app block of the Caddyfile at the upstream file. The speech and voice models stay in /opt/bopomofo/shared/models, outside the releases.

## Speech model

backend/models/ must contain wav2vec2-cmn-phonetic.onnx, wav2vec2-cmn-phonetic.onnx.data (3.6 GB), and vocab.json. vocab.json is in the repository. To create the two ONNX files (downloads about 4 GB from Hugging Face, takes some minutes):

    cd backend
    uv venv .venv-export --python 3.12
    uv pip install --python .venv-export/bin/python -r tools/requirements-export.txt
    .venv-export/bin/python tools/export_model.py
    .venv-export/bin/python tools/quantize_model.py

On Windows, use `.venv-export\Scripts\python.exe` in place of `.venv-export/bin/python` (the pinned CPU PyTorch wheel exists for Windows ARM64, Windows x64, and ARM64 Linux). The quantize step is optional: it writes `wav2vec2-cmn-phonetic.int8.onnx` plus its weights file. The API uses FP32 when present, for better accuracy on quiet microphones, and int8 only when FP32 is absent; `ASR_MODEL_FILE` chooses explicitly. On the ARM VPS, int8 was about 3× faster and 75% smaller, but failed the quiet-microphone threshold (10 misses vs 5 allowed), while FP32 passed. You can delete .venv-export after the export.

## Speech and voice runtime

The speech model and the voices run on ONNX Runtime on the CPU on both machines; only the tuning differs. backend/app/runtime.py holds the two profiles, and the backend prints the active one when it starts ("Speech runtime local: …").

| SPEECH_RUNTIME | Where | Speech model | Voices |
|---|---|---|---|
| local | this laptop (Windows ARM64, Snapdragon X2 Elite); start.cmd sets it | FP32 on every core | 8 threads |
| vps | the ARM production server; deploy/vps/bopomofo-api.service sets it | FP32 on at most 4 threads | at most 4 threads |

Without SPEECH_RUNTIME, Linux uses vps and every other system uses local. ASR_NUM_THREADS, TTS_NUM_THREADS, and ASR_MODEL_FILE change one value of the profile. The NPU (QNN) was not reliable for the full speech model on this laptop, so both profiles use the CPU.

## Tests

    cd backend && .venv\Scripts\python -m pytest -q tests      # speech, text, tracking, per-user data, sign-in, coach (no network), live OpenRouter
    cd frontend && bun test src/lib                               # stroke engine, pinyin answers

The database tests empty the tables of TEST_DATABASE_URL first. They never use DATABASE_URL.

## Limits

- The speech model is the best open model I found for syllable-level Mandarin, but it is not perfect: check uncertain results by ear.
- Tone accuracy was measured on TTS voices, not on human learners.
- The writing checker compares stroke centerlines; it does not judge hooks and flicks at stroke ends (the MOE notes for these are shown as text).
