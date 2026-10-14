@echo off
REM Capital Compass AI 2.0 — one-command start (Windows).
REM Builds the frontend once, then serves app + API on http://localhost:5000
cd /d %~dp0
if not exist backend\.venv (
  python -m venv backend\.venv
  backend\.venv\Scripts\python -m pip install -q --upgrade pip
  backend\.venv\Scripts\python -m pip install -q -r backend\requirements.txt
)
if not exist frontend\node_modules (cd frontend && call npm ci && cd ..)
if not exist frontend\dist (cd frontend && call npm run build && cd ..)
cd backend
.venv\Scripts\python app.py
