# macOS: Apple Silicon and Intel

Complete the [shared setup](README.md) for PostgreSQL, Clerk, and OpenRouter. Use Terminal from the repository root. These commands are a documented path; a full macOS install has not been run during this cleanup.

## Install packages

Install Git, uv, Bun, and PostgreSQL using their official installers or your package manager. Start PostgreSQL before you start the backend. On Apple Silicon, use a native ARM64 terminal and Python. On Intel, use x86_64 Python.

```sh
uv venv backend/.venv --python 3.12
uv pip install --python backend/.venv/bin/python -r backend/requirements-dev.txt
cd frontend
bun install --frozen-lockfile
cd ..
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Copy the templates only on the first install, then fill in your keys and database addresses. Do not copy a Windows virtual environment to macOS. Create a new environment and copy only the model artifacts.

## Install models

Download the voices:

```sh
backend/.venv/bin/python backend/tools/download_voices.py
```

The simplest speech-model path on both Mac architectures is to copy these files from an existing export into `backend/models/`:

```text
wav2vec2-cmn-phonetic.onnx
wav2vec2-cmn-phonetic.onnx.data
vocab.json
```

Keep the two ONNX files together. ONNX Runtime runs them on the CPU; it does not need PyTorch at app runtime.

On **Apple Silicon**, you can also try a native export in a separate environment:

```sh
cd backend
uv venv .venv-export --python 3.12
uv pip install --python .venv-export/bin/python -r tools/requirements-export-macos.txt
.venv-export/bin/python tools/export_model.py
cd ..
```

The Windows/Linux export file pins `torch==2.9.1+cpu` from PyTorch's CPU wheel list. The Mac export file uses the native `torch==2.9.1` wheel from PyPI. These are separate install paths for the same exporter.

On an **Intel Mac**, use artifacts exported on Windows, Linux, or Apple Silicon. The pinned PyTorch exporter is not offered as a current Intel macOS wheel. The app's Intel macOS runtime dependencies resolve without PyTorch.

The Apple Silicon export dependency set resolves, but the export itself still needs a Mac test. Review the [model terms](../licensing.md) before you use or redistribute artifacts.

## Start development

In one terminal:

```sh
cd backend
SPEECH_RUNTIME=local .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

In a second terminal:

```sh
cd frontend
bun run dev --port 3210
```

Open `http://localhost:3210`. Press Ctrl+C in both terminals to stop the app. The backend can wait for background coach work to finish.

For a small machine, you can set `ASR_NUM_THREADS=4` and `TTS_NUM_THREADS=4` before startup. Tune from measurements on your own CPU. This does not select an Apple GPU or Neural Engine.

## Run a production build locally

```sh
cd frontend
bun run build
bun run start --port 3210
```

Keep the backend running in the other terminal. The Windows `.cmd` launchers are not used on macOS.
