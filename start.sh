#!/usr/bin/env bash
# Capital Compass AI 2.0 — one-command start (macOS / Linux).
# Builds the frontend once, then serves app + API on http://localhost:5000
set -e
cd "$(dirname "$0")"
if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/python -m pip install -q --upgrade pip
  backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then (cd frontend && npm ci); fi
if [ ! -d frontend/dist ]; then (cd frontend && npm run build); fi
cd backend && exec .venv/bin/python app.py
