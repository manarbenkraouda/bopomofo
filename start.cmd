@echo off
rem Zhuyin Studio: starts the backend (port 8765) and the frontend (port 3210), then opens the browser.
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (echo Run setup.cmd first. & pause & exit /b 1)
if not exist "backend\models\wav2vec2-cmn-phonetic.onnx" (echo The speech model is missing. See README.md, section "Speech model". & pause & exit /b 1)
if not exist "frontend\.next\BUILD_ID" (
  echo Building the frontend...
  pushd frontend & call bun run build & popd
)
start "Zhuyin Studio backend" /min cmd /k "cd /d %~dp0backend && .venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765"
start "Zhuyin Studio frontend" /min cmd /k "cd /d %~dp0frontend && bunx next start -p 3210"
echo Starting... the browser opens in a few seconds.
timeout /t 6 /nobreak >nul
start "" http://localhost:3210
