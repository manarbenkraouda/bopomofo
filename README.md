# Zhuyin Studio

A personal app to learn Bopomofo (注音符號) and Taiwan Mandarin: reading, writing, listening, and speaking with feedback on every stroke and every tone.

- **Frontend:** Next.js 16 (frontend/), http://localhost:3210
- **Backend:** FastAPI (backend/), http://127.0.0.1:8765 (port 8000 is used by Docker on this PC)
- **Location on this PC:** C:\Users\manar\Documents\zhuyin-studio

## Start

Double-click **start.cmd**. It opens two small windows (backend and frontend) and the browser. Close those windows to stop the app.

Record one full sentence on the Speaking page first. The app learns your pitch range from it and uses it to check single-syllable tones.

## Install on a new machine

The repository does not contain the secret key, the speech model (3.6 GB), or your personal data. To install:

1. Install [git](https://git-scm.com), [uv](https://docs.astral.sh/uv/) and [bun](https://bun.sh).
2. Clone the repository:

       git clone git@github.com:manarbenkraouda/zhuyin-studio.git
       cd zhuyin-studio

3. Run **setup.cmd**. It creates the Python environment, installs the frontend packages, builds the frontend, and creates backend/.env.
4. Put your OpenRouter key in backend/.env (see Configuration).
5. Create the speech model (see Speech model), or copy the backend/models folder from another machine.
6. Run **start.cmd**.

setup.cmd uses the Windows ARM64 Python (cpython-3.12-windows-aarch64). On an x64 PC, change it to cpython-3.12-windows-x86_64.

## What is inside

| Page | What it does |
|---|---|
| Home | Progress: day streak, accuracy per area, tone accuracy, symbols to practice, system status. |
| Symbols | The 37 symbols and 5 tones. Official MOE recordings and animated stroke order. |
| Sentences | Generates short Taiwan Mandarin sentences on any topic (OpenRouter, deepseek/deepseek-v4.1-flash). Each sentence has Bopomofo beside the characters (Taiwan style), pinyin, English, word glosses, and audio (normal and slow). Quick lookup: paste any Chinese text to get Bopomofo, audio, and a translation. Sentences are saved in a library. |
| Speaking | Record yourself (or upload a recording). A local speech model checks each syllable: initial, final, and tone. It shows your pitch curve against the target tone shapes, and handles tone changes (3-3 sandhi, 一, 不). Targets: your sentences, single syllables, or any text you type. |
| Writing | Hear a sound and write the Bopomofo by hand. Stroke-level corrections: wrong symbol, stroke order, direction, missing, extra, joined strokes, shape. Modes: single symbols, syllables with tone marks, and words from your sentences. Watch the correct stroke order after each answer. |
| Listening | Quizzes: name the tone, or pick the matching Bopomofo. |

Keyboard: Space = play, Enter = check / next, R = record (Speaking), Ctrl+Z = undo stroke (Writing), 1-4 = answer (Listening).

## How it works

- **Speech model:** [Chuatury/wav2vec2-mms-1b-cmn-phonetic](https://huggingface.co/Chuatury/wav2vec2-mms-1b-cmn-phonetic), exported to ONNX and run on the CPU with ONNX Runtime. It outputs Bopomofo with tones per syllable. About 0.5 s of processing for a 2.5 s sentence on the Snapdragon X2 Elite. License: CC-BY-NC-4.0 (personal use).
- **Tones on single syllables:** the model labels many Taiwan-style low-falling tone 3 syllables as tone 4. The backend learns your pitch range from your sentence recordings and corrects these cases. Measured on 198 isolated syllables (two Taiwan TTS voices): 161 correct (81%). Most remaining errors are TTS tone-1 clips that fall in pitch. Record one sentence before single-syllable practice.
- **Bopomofo for text:** pypinyin with Taiwan (MOE) corrections for common words (星期 ㄑㄧˊ, 垃圾 ㄌㄜˋ ㄙㄜˋ, 誰 ㄕㄟˊ...), and neutral-tone dots in front (˙ㄇㄚ). Some readings can still follow mainland usage.
- **Audio:** free Microsoft Edge neural voice zh-TW-HsiaoChenNeural (edge-tts, online), cached in backend/data/tts.
- **Writing data:** stroke outlines and centerlines from the Taiwan Ministry of Education 國語注音符號手冊; stroke counts match the handbook for all 37 symbols.
- **Data:** backend/data/zhuyin.db (sentences and attempts), backend/data/speaker.json (your pitch reference). Git ignores this folder. To reset the pitch reference, delete speaker.json.

## Configuration

backend/.env:

    OPENROUTER_API_KEY=sk-or-...
    OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash

## Speech model

backend/models/ must contain wav2vec2-cmn-phonetic.onnx, wav2vec2-cmn-phonetic.onnx.data (3.6 GB), and vocab.json. vocab.json is in the repository. To create the two ONNX files (downloads about 4 GB from Hugging Face, takes some minutes):

    cd backend
    uv venv -p cpython-3.12-windows-aarch64 .venv-export
    uv pip install -p .venv-export\Scripts\python.exe -r tools\requirements-export.txt
    .venv-export\Scripts\python tools\export_model.py

You can delete .venv-export after the export.

## Tests

    cd backend && .venv\Scripts\python -m pytest -q tests      # speech, text, live OpenRouter
    cd frontend && bun test src/lib                               # stroke engine

## Limits

- The speech model is the best open model I found for syllable-level Mandarin, but it is not perfect: check uncertain results by ear.
- Tone accuracy was measured on TTS voices, not on human learners.
- The writing checker compares stroke centerlines; it does not judge hooks and flicks at stroke ends (the MOE notes for these are shown as text).
