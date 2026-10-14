# PLAN.md — Capital Compass AI 2.0

## Status: P0, P1 and P2 implemented and verified

| Priority | Feature | Status | Where |
|---|---|---|---|
| P0 | Financial Digital Twin | Done | `engines/digital_twin.py`, `/twin` |
| P0 | Investment Engine | Done (re-optimisable) | `engines/portfolio_engine.py`, `/investment` |
| P0 | Loan Decision Simulator | Done | `engines/loan_engine.py`, `/loan` |
| P0 | Goal Survival | Done (4 market scenarios) | `engines/goal_engine.py`, `/goals` |
| P0 | Simulation Engine (10,000 paths) | Done (bootstrap + regime) | `engines/simulation_engine.py` |
| P0 | Crisis War Room | Done (6 scenarios) | `engines/crisis_engine.py`, `/crisis` |
| P0 | AI Committee + debate | Done | `agents/*`, `/committee` |
| P0 | Red Team + Critic + re-optimise | Done | `engines/decision_engine.py`, `agents/critic.py` |
| P1 | Portfolio Doctor | Done (CSV + manual) | `engines/portfolio_doctor.py`, `/portfolio` |
| P1 | Risk DNA (8 dimensions) | Done | `engines/risk_engine.py` |
| P1 | Counterfactual explanation | Done | `decision_engine.counterfactual`, `agents/explanation.py` |
| P1 | Trust Center + audit trail | Done | `/trust`, `/audit` |
| P2 | High-Risk Spending Analyzer | Done | `engines/spending_engine.py`, `/spending` |
| P2 | Market regime | Done | `market/loader.py` |
| P2 | Natural-language command bar | Done (rule-based, routes to real engines) | `agents/supervisor.py` |
| P3 | Market Intelligence (news) | Done (public RSS + labelled offline sample) | `market/news.py`, `/market` |

## Website upgrade (v2.1)

| Area | What changed | Where |
|---|---|---|
| Intro | Cinematic compass: emerges from darkness, needle searches then settles, one light pass, title reveal; renders on demand and stops once settled; lite mode and SVG fallback | `three/CompassScene.tsx`, `pages/Landing.tsx` |
| Command Center | Financial health (8 figures), active goals with live probabilities, portfolio health by asset class, recent AI decisions with confidence and risk level, AI activity from the stored audit trail | `pages/Dashboard.tsx`, `POST /api/dashboard` |
| Goal Survival | Current corpus and expected-return inputs; ending wealth P5/P50/P95, shortfall risk and median shortfall | `engines/goal_engine.py`, `pages/Goals.tsx` |
| Red Team | "N weaknesses found", severity, the question each attack asks, most fragile assumption | `decision_engine.red_team`, `pages/Committee.tsx` |
| Critic | APPROVED / APPROVED WITH FLAGGED RISKS / REJECTED — RE-OPTIMIZATION REQUIRED, with an iteration timeline | `agents/critic.py` |
| Committee | Verdict, weighted support, confidence, major arguments, unresolved concerns | `agents/debate.py` |
| Final decision | "Capital Compass decision" verdict, before→after goal success, resilience, debt stress and crash loss, major changes, why / why not / what could fail / Red Team findings / why the Critic approved | `agents/explanation.py`, `decision_engine.plan_health` |
| Trust Center | Committee, Red Team and Critic results, assumption sensitivity, new disclaimer | `pages/Trust.tsx` |
| Audit | Timestamp, node, status and summary per step; `?id=` deep link | `pages/Audit.tsx` |

## Product upgrade (v2.2)

| Area | What changed | Where |
|---|---|---|
| Intro | Restrained title sequence: navy darkness, radial coordinate "signal", the compass emerges from fog, needle aligns, title; the compass shrinks into the app logo on entry | `three/CompassScene.tsx`, `pages/Landing.tsx` |
| Landing story | Problem → idea → twin → futures → agents → Red Team → Critic → explainability → workflow, with live engine output on the sample profile | `pages/Landing.tsx`, `components/LandingLive.tsx` |
| Agent architecture | Living pipeline driven by SSE events, per-node outputs, critic loop by round, replay | `pages/Architecture.tsx`, `lib/ops.ts` |
| Market intelligence | RSS ingestion (stdlib), keyword categories, impact domains, offline mode banner | `market/news.py`, `api/news.py`, `pages/Market.tsx` |
| Learn / How it works | 11 concepts, 12 animated steps | `pages/Learn.tsx`, `pages/HowItWorks.tsx` |
| Red Team | Seventh attack: liquidity crisis | `engines/decision_engine.py` |
| Command center | Threshold alerts | `pages/Dashboard.tsx` |
| Demo | 21 steps | `components/DemoGuide.tsx` |
| Cleanup | legacy/v1 removed, Vite type declarations, new disclaimer everywhere | — |

## Atlas (v3.0)

- Entry: log in / create account inside the cinematic scene; guest path kept. Sessions expire after 7 days and expired/forged tokens get 401.
- Atlas greeting with the registered name; 3D Financial Atlas map (14 landmarks → real routes, state-driven, guided route); 2D map on phones and without WebGL.
- Atlas Command Center: Atlas recommends (engines/atlas.py rules), Capital Health Index, status strip, challenge → re-optimize, What-If Lab, explainers, data-source tags.
- Decision war room, original vs optimized, decision receipt; Trust Center data basis and freshness.
- Security: per-guest ownership (X-Guest-Key) for decisions, profiles and goals; owner-checked re-optimize; additive DB migration for `guest_key`.
- Five languages for all Atlas copy.

## Verified

- 54 backend tests pass (also in a fresh Python 3.10 venv with langgraph 1.2.14, pydantic 2.13, Flask 3.1), including a full graph run where the Critic rejects, the plan is re-optimised and then accepted.
- The frontend passes typecheck, lint and build.
- The 21-step flagship demo and all 17 routes were clicked through in a headless browser at 1440, 820 and 390 px: no runtime errors, no failed API calls, no horizontal overflow.
- Invalid inputs (negative amounts, out-of-range returns, text in numeric fields, unknown decision types, missing profile) return 422 with field details.
- All 12 tables were written to a real MySQL-compatible server (MariaDB 10.11).

## Next steps (if time allows)

1. Optional: let a configured language model summarise news; keep keyword rules as the fallback.
2. Step-up SIP and tax (LTCG) modelling in the simulation engine.
3. Fund-level holdings history for the Portfolio Doctor correlation model.
4. PDF export of the final decision report (currently browser print).
