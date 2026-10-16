# Windows: ARM64 and x64

Complete the [shared setup](README.md) for PostgreSQL, Clerk, and OpenRouter. Run these commands in PowerShell from the repository root unless a step says otherwise.

## Reference setup

The maintainer uses Windows ARM64 on a Snapdragon X2 Elite, native ARM64 Python 3.12, PostgreSQL, Bun, and CPU ONNX Runtime. QNN/NPU execution is not part of this setup. The x64 path uses the same app with x64 Python and wheels.

## Install packages

Create the backend environment. Choose **one** command:

```powershell
# Windows ARM64
uv venv --python cpython-3.12-windows-aarch64 backend/.venv
```

```powershell
# Windows x64
uv venv --python cpython-3.12-windows-x86_64 backend/.venv
```

Then install the packages and copy the environment templates:

```powershell
uv pip install --python backend/.venv/Scripts/python.exe -r backend/requirements-dev.txt
Set-Location frontend
bun install --frozen-lockfile
Set-Location ..
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Copy the templates only on the first install. Fill in the keys and database addresses before you start the app.

## Install models

Download the voices:

```powershell
backend/.venv/Scripts/python.exe backend/tools/download_voices.py
```

For speech recognition, either copy the model artifacts from an existing installation or export them in a separate environment:

```powershell
Set-Location backend
uv venv .venv-export --python .venv/Scripts/python.exe
uv pip install --python .venv-export/Scripts/python.exe -r tools/requirements-export.txt
.venv-export/Scripts/python.exe tools/export_model.py
Set-Location ..
```

The export uses CPU PyTorch. Its requirements file adds the CPU torch wheel list and leaves other packages on PyPI, so uv can find native ARM64 dependencies. It does not need a CUDA GPU or an NPU. Keep these files together in `backend/models/`:

```text
wav2vec2-cmn-phonetic.onnx
wav2vec2-cmn-phonetic.onnx.data
vocab.json
```

The optional `tools/quantize_model.py` step creates int8 weights. The app prefers FP32 when present. Do not replace FP32 as part of a code cleanup: that can change recognition results. Review the [model terms](../licensing.md) before you use or redistribute artifacts.

## Start development

Open two PowerShell windows. In the first:

```powershell
Set-Location backend
$env:SPEECH_RUNTIME = "local"
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

In the second:

```powershell
Set-Location frontend
bun run dev --port 3210
```

Open `http://localhost:3210`. Press Ctrl+C in each window to stop its process. Uvicorn can wait for background coach work to finish.

## Use the batch launcher

On the ARM64 reference setup, `setup.cmd` creates the runtime environment, downloads voices, and installs the frontend. It creates `backend/.env` if absent. It builds the frontend only when `frontend/.env.local` exists. It does not export the speech model.

After manual setup on either Windows architecture, build the frontend once:

```powershell
Set-Location frontend
bun run build
Set-Location ..
```

Then run `start.cmd`. It starts the backend on 8765 and the production frontend on 3210. Close the two process windows to stop them. Rebuild the frontend after changes before you use this launcher again.

On x64, use the manual installation above rather than `setup.cmd`, which selects ARM64 Python. `start.cmd` can use the x64 environment created by the manual steps.
