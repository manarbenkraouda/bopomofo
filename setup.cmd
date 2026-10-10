@echo off
rem One-time setup: Python backend environment and frontend build. Needs uv and bun.
cd /d "%~dp0"
pushd backend
if not exist ".venv\Scripts\python.exe" uv venv -p cpython-3.12-windows-aarch64 .venv
uv pip install -p .venv\Scripts\python.exe -r requirements.txt || (popd & echo Backend install failed. & pause & exit /b 1)
.venv\Scripts\python tools\download_voices.py || (popd & echo Voice download failed. & pause & exit /b 1)
if not exist ".env" copy .env.example .env >nul & echo Fill in backend\.env: OpenRouter key, DATABASE_URL, CLERK_SECRET_KEY
popd
pushd frontend
call bun install || (popd & echo Frontend install failed. & pause & exit /b 1)
if exist ".env.local" (
  call bun run build || (popd & echo Frontend build failed. & pause & exit /b 1)
) else (
  echo No frontend\.env.local yet: run "clerk env pull --file frontend/.env.local", then "bun run build" in frontend.
)
popd
echo Setup done. Start the app with start.cmd
pause
