# CLAUDE.md — Capital Compass AI 2.0

Instructions for any AI coding assistant working in this repo. `README.md` explains the product and how to run it; `PLAN.md` holds status and next steps.

## Stack (as built)

- **Backend:** Python 3.10+, Flask, Pydantic v2 (validation), LangGraph, NumPy/pandas, SQLAlchemy 2 + PyMySQL (MySQL 8; SQLite fallback), bcrypt.
- **Frontend:** React 18, Vite, TypeScript (strict), Recharts, Zustand, React Router, three.js + @react-three/fiber (landing compass and Atlas map). Plain CSS with design tokens in `src/styles/global.css`.
- **Streaming:** Server-Sent Events from `graph/runner.py`.
- **No external API keys.** Market data is local CSV, RAG is local BM25, and the LLM is optional (`LLM_PROVIDER=none` by default).

## Commands

```bash
cd backend && python app.py                 # API on :5000 (serves frontend/dist if built)
cd backend && pytest -q && ruff check .     # must pass before any commit
cd frontend && npm run dev                  # UI on :5173, proxies /api
cd frontend && npm ci && npm run typecheck && npm run lint && npm run build
```

## Rules that must not break

1. **Engines own the numbers, agents own the words.** `backend/engines/` is pure, deterministic and tested. Agents only read engine outputs. If an agent needs a number, add it to an engine.
2. **Monte Carlo is never a constant return.** Use block bootstrap of real history, regime scaling and a seeded RNG, vectorised over 10,000 paths in under 1.5 s (there is a test for this).
3. **`FinancialState` (`graph/state.py`) is the single shared state.** Every node is wrapped by `@node(...)` in `graph/nodes.py`, which appends to `audit_trail` and emits SSE events.
4. **The Critic loop terminates.** `MAX_RETRIES = 2`; after that the best plan is accepted with its weaknesses flagged.
5. **Zero required keys.** Never add a dependency on a paid or keyed service without a local fallback.
6. **Safety scope.** Show the scenario-based disclaimer on every result. Loans are simulation only, with no applications. Betting analysis covers consequences only: no platforms, strategies or predictions.
7. **Never fake live state.** Agent animations follow real SSE events; news is real RSS or a sample labelled as such; alerts are threshold checks on real data.
8. **3D has a job.** The landing compass (`three/CompassScene.tsx`), the Financial Atlas map (`three/AtlasScene.tsx`) and the Goal Survival Theatre (`three/goal/`) are the product's 3D; they fall back to `CompassFallback`, `components/AtlasMap2D.tsx` and the Goals page's analytical data. Theatre geometry and labels only draw values from the `/api/goals/survival` theatre response (`three/goal/model.ts` documents each derived value). Any canvas must sit inside `<WebGLOnly>` or an error boundary so a machine without WebGL never sees a crash.
9. **Ownership is server-side.** Load stored resources only through the owner check (`api/common.py: owns`, `api/decisions.py: _row`). Guests are scoped by the `X-Guest-Key` header. Never return a resource because the caller knows its ID.
10. **Atlas never invents.** Guidance, the Capital Health Index and map state come from `engines/atlas.py` and real API responses. Atlas copy lives in `src/lib/i18n.*.ts` and is rendered with `t(key, params)`; numbers arrive as params, never inside translations.

## Conventions

- Money is shown via `lib/format.ts` (`inr`, `inrShort`) on the frontend and `utils/inr.py` on the backend: ₹5,00,000 / ₹25 L / ₹1.2 Cr.
- Colour meanings: brass = brand and primary action, green = survives, red = breaks, amber = strained, blue = median/neutral.
- Every page handles loading, error (with retry), empty and success states. No dead buttons.
- API handlers validate input (`api/common.py`: `validate`, `num`, `profile_from`) and return 422 with field details.
- Adding an engine: write a docstring with the formulas, add a test in `backend/tests/`, and expose it through `api/modules.py`.
- Before→after figures on the Final Decision screen come from `decision_engine.plan_health()`; Command Center goal and portfolio figures come from `POST /api/dashboard`. Don't compute them in the UI.
- The landing intro must stop rendering once the needle settles (`frameloop="demand"`); don't add continuous animation loops.
- Prettier style for the frontend: `--single-quote --no-semi --print-width 220`.
- News: `market/news.py` uses only the stdlib; `NEWS_FEEDS` (comma-separated URLs) and `NEWS_LIVE=0` configure it. Offline mode must say so on screen.
- Live operation labels for nodes live in `frontend/src/lib/ops.ts`; add one when you add a graph node.
