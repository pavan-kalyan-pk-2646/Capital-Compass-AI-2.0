# Capital Compass AI 2.0

**AI Financial Decision Intelligence & Financial Digital Twin**

> *We don't predict the market. We simulate the futures your financial decisions can create.*

Capital Compass 1.0 answered *"Where should I invest?"*. Version 2.0 answers *"What could happen if I make this financial decision?"*. It builds a Financial Digital Twin of the user, routes each decision (invest, borrow, reach a goal, survive a crisis, cut high-risk spending) through a LangGraph pipeline, simulates 10,000 futures from real NIFTY 50 history, lets five AI agents debate the result, has a Red Team try to break it, and lets a Critic accept it or force a re-optimisation. Every decision ends with an explanation ("Why this? Why not that?"), a Trust Center and a stored audit trail.

**It needs no API keys.** Market data, simulations, agents, compliance retrieval and explanations all run locally.

## What's in the app

The product follows one path: **log in → "Hello, *name*" → Atlas → the Financial Atlas map → the Command Center → a decision → its war room, receipt and audit trail.**

- **Entry:** the cinematic compass title sequence, with **Log in** and **Create account** drawn inside the scene (inline validation; the server re-validates and hashes passwords with bcrypt). Guests can still continue without an account, and the flagship demo is one click away.
- **Atlas greeting:** after sign-in, "HELLO, *your registered name*", then Atlas introduces itself while the compass and the map's coordinate grid respond to each line. Skippable; shown again on every fresh sign-in.
- **The Financial Atlas (`/atlas`):** a procedural 3D map whose 14 landmarks are the parts of the app (Atlas Citadel = Command Center, Twin Harbor, Risk Ridge, Goal Valley, Market Horizon, Investment District, Loan Crossing, Crisis Frontier, Portfolio Clinic, Committee Chamber, Red Team Fortress, Critic Gate, Trust Observatory, Audit Archive). Each opens its real page. A landmark is lit only when your data is behind it (twin, goals, holdings, a completed decision), and Atlas draws the route to the next step it recommends. Orbit, zoom and pan are bounded; hovered landmarks rise and explain themselves. Phones get a 2D map with a bottom sheet; devices without WebGL get the same 2D map.
- **Atlas Command Center:** *Atlas recommends* (the first threshold rule that fires, with the numbers behind it), the **Capital Health Index** (five pillars from existing engine outputs, each explained), the financial status strip, the latest decision with **Challenge this decision → Re-optimize**, the **What-If Lab** (instant arithmetic preview while you drag, a real 10,000-path run on demand), then alerts, goals, portfolio, AI activity, recent decisions, cash flow and market regime. Every important number carries a source tag: user input, calculated, historical data, model assumption or simulated.
- **Goal Survival Theatre (`/goals`):** an input control room (goal, years, current wealth, SIP, return; twin values read-only), then **Simulate** runs the real `/api/goals/survival` request and the stages follow it. The result is a 3D theatre with seven camera views (Overview, Monte Carlo, Goal terrain, Scenarios, Goal core, Risk, Decision): a Monte Carlo universe of sampled paths (click one to inspect it) with P5–P95 lines and the goal plane, a percentile mountain, a goal terrain built from the density of all 10,000 paths, scenario towers (normal, bear, crash, job loss, inflation shock, rate shock, crash + job loss), the survival core with the Risk DNA resilience ring, the goal distance engine, a constellation of the states the simulation reports, a decision timeline, a risk topology whose peaks are measured survival drops, and before → after at the required SIP. Every value comes from the response; the existing charts stay below as *Analytical data*. Phones draw fewer paths and only the current view's station; devices without WebGL get the analytical data.
- **Decision war room:** each stage of a decision (twin → simulation → committee → Red Team → Critic → re-optimization → final) with what it actually produced, live over SSE; original vs optimized plan; the **decision receipt**.
- **Finance explainers:** "What is this?" on FOIR, CAGR, SIP, drawdown, volatility, liquidity, diversification, Monte Carlo, emergency coverage and debt burden.
- **Five languages:** English, Telugu, Hindi, Tamil and Malayalam for all Atlas copy; the choice persists.
- **Agent architecture:** the LangGraph pipeline as a living system. Nodes light up only while the backend executes them (SSE), show their real output, and the Critic → re-optimise loop is drawn round by round. Stored runs can be replayed.
- **Market intelligence:** headlines from public RSS feeds (RBI, Economic Times, Mint, Moneycontrol, BBC Business), categorised with deterministic keyword rules, with "why this matters" and the decision domains each story can touch. With no internet it says so and shows a clearly labelled illustrative sample. Configure with `NEWS_FEEDS` / `NEWS_LIVE=0`.
- **Learn** (11 concepts) and **How it works** (12 steps), both tied to the real engines and nodes.

**What this system is:** a multi-agent decision orchestration system combining specialized financial reasoning engines, simulations, structured agent deliberation, adversarial testing and optional AI language capabilities. Agents are deterministic reasoning components over engine outputs; no number is generated by a language model.

---

## Quick start

Requirements: Python 3.10+ and Node.js 18+. MySQL 8 is optional (a local SQLite file is used when it isn't configured).

```bash
# macOS / Linux
./start.sh          # installs, builds the UI once, serves everything on http://localhost:5000

# Windows
start.bat
```

### Development mode (two terminals)

```bash
# 1. backend — http://localhost:5000
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py

# 2. frontend — http://localhost:5173 (proxies /api to :5000)
cd frontend
npm ci                             # installs exactly what package-lock.json pins
npm run dev
```

Open http://localhost:5173 (dev) or http://localhost:5000 (after `npm run build`).

### MySQL setup

1. Start MySQL 8, either your own install or `docker compose up -d mysql` (uses `docker-compose.yml`).
2. Create the database and user (skip this if you used docker compose):
   ```sql
   CREATE DATABASE capital_compass CHARACTER SET utf8mb4;
   CREATE USER 'compass'@'localhost' IDENTIFIED BY 'compass';
   GRANT ALL ON capital_compass.* TO 'compass'@'localhost';
   ```
3. Copy `.env.example` to `.env` and set:
   ```
   DATABASE_URL=mysql+pymysql://compass:compass@localhost:3306/capital_compass
   ```
4. Run `python app.py`. The tables are created automatically on start. `backend/db/schema.sql` has the same DDL if you prefer to provision by hand.

`GET /api/health` reports which database is in use.

---

## The flagship demo

On the landing page, click **Run the flagship demo** (or **Flagship demo** in the top bar). A guide walks through 21 steps, and every step calls the real engines on the sample profile:

| # | Step | What happens |
|---|---|---|
| 1 | Create the Financial Digital Twin | Age 28, ₹80,000/month, ₹6 L savings, ₹25 L home goal in 5 years, 15% max loss |
| 2 | Generate Risk DNA | Eight dimensions computed from the twin |
| 3 | Generate the portfolio | Allocation and monthly investment, capped by the loss limit |
| 4 | Run 10,000 simulations | Block-bootstrapped NIFTY 50 + debt history, regime-scaled |
| 5 | Goal probability | Normal / bear / crash / crash + job loss |
| 6 | Add a ₹5 lakh personal loan | 14%, 60 months, 1% fee |
| 7 | EMI | ₹11,634/month, total interest ₹1.98 L |
| 8 | Debt stress | FOIR 10% → 25%; normal, −30% income and job-loss stress tests |
| 9 | Goal impact | Goal success falls from 83% to 4% as the EMI squeezes the investment |
| 10 | NIFTY −30% crisis | Crisis War Room |
| 11 | Portfolio impact | Loss vs the 15% limit, goal before/after, recovery, liquidity |
| 12 | AI Committee | The full LangGraph pipeline streams live: Bull, Bear, Risk, Goal, Compliance |
| 13 | Debate | Rebuttals and a weighted vote; Compliance can veto |
| 14 | Red Team | Seven attacks |
| 15 | Critic | "REJECTED — RE-OPTIMIZATION REQUIRED": crash loss 15.4% > 15%; goal 4% < 50% |
| 16 | Re-optimise | 36 candidate plans searched (allocation × investment × loan amount × tenure) |
| 17 | Simulate again | The loop on the Agent Architecture page: round 2 approved |
| 18 | Old vs new | Goal success 4% → 51%, resilience 70 → 86, debt stress Moderate → Low |
| 19 | Counterfactual | Why this plan; why not the riskier or safer one; assumption sensitivity |
| 20 | Trust Center | Data sources, ~300,000 simulated paths, agents, committee, Red Team, Critic, compliance, confidence |
| 21 | Audit trail | Every stored node with timestamp, status, summary and duration |

You can also type questions into the command bar, for example "Can I take a ₹5 lakh personal loan?", "What if I lose my job for six months?" or "Why did you reject my plan?". Each one runs the full pipeline.

---

## Architecture

```mermaid
flowchart TD
  UI[React UI + command bar] -->|REST + SSE| API[Flask API]
  API --> PP[profile_parser] --> FT[financial_twin] --> SUP[supervisor]
  SUP --> RD[risk_dna] & GA[goal_agent] & MA[market_agent]
  RD & GA & MA --> DR{decision_router}
  DR --> INV[investment] & LOAN[loan] & SP[spending] & CR[crisis]
  INV & LOAN & SP & CR --> PD[portfolio_doctor] --> SIM[simulation_engine] --> CE[crisis_engine]
  CE --> FC[financial_committee<br/>Bull · Bear · Risk · Goal · Compliance] --> DB8[debate] --> RT[red_team] --> CRIT{critic}
  CRIT -- REJECT, retries < 2 --> RO[re_optimize] --> SIM
  CRIT -- ACCEPT --> CF[counterfactual] --> EX[explanation] --> TC[trust_center]
  TC --> MYSQL[(MySQL: decisions, agent_logs, audit_trail …)]
```

**Rule: engines own the numbers, agents own the words.** Every figure comes from a deterministic, unit-tested function in `backend/engines/`. Agents (`backend/agents/`) read those numbers and produce opinions, debate, critiques and explanations, so no number is ever invented by a language model.

### Monte Carlo (backend/engines/simulation_engine.py)
- **10,000 paths**, monthly steps, fully vectorised NumPy, about 100 ms per run.
- **Never a constant return.** Each path stitches random 6-month blocks of real NIFTY 50 total returns (2000–2023, 287 months). Debt returns come from the same months, so crisis periods stay intact.
- **Regime:** trailing 12-month volatility is ranked against history (calm, normal or volatile) and scales the deviations.
- Gold uses fat-tailed (Student-t) draws around a documented assumption. Inflation is drawn per path.
- The full cash flow runs every month: salary, expenses, EMIs and investments. During job loss, spending drops to essentials, and if cash runs out investments are sold (forced liquidation is tracked).
- Outputs: P5/P25/P50/P75/P95 bands, goal success, ending wealth, drawdown, recovery time and liquidity risk. A fixed seed gives reproducible results.

### Red Team and Critic (backend/engines/decision_engine.py)
- Seven attacks: crash, inflation, income-stop, goal-change, low-return, liquidity crisis (an emergency bill during a crash, covered from cash and debt or not) and loan/interest shock. Each is graded held, strained or broken; crash, income-stop and rate shock are critical.
- The Critic rejects when a critical test breaks, when base-case goal success for a high-priority goal is below 50%, or when robustness is below 55. Retries are capped at 2; after that the best plan found is accepted and its weaknesses are flagged.
- The re-optimiser searches allocation × investment × loan amount × tenure × spending cut. It filters on hard limits analytically, ranks survivors with simulations, and the result goes back through the whole pipeline.

---

## Folder structure

```
capital-compass-2.0/
├── backend/
│   ├── app.py                  Flask app (API + serves built UI)
│   ├── config.py               env settings (no keys required)
│   ├── api/                    profile/twin, modules (investment, loan, goals, what-if, crisis,
│   │                           spending, portfolio), decisions (run/stream/audit), auth, meta
│   ├── engines/                digital_twin, risk_engine, portfolio_engine, loan_engine,
│   │                           goal_engine, simulation_engine, crisis_engine, portfolio_doctor,
│   │                           spending_engine, decision_engine, plan, finance_math
│   ├── agents/                 supervisor (NL router), risk/goal/market/loan/portfolio agents,
│   │                           bull, bear, compliance (RAG), debate, red_team, critic,
│   │                           explanation, llm (optional)
│   ├── graph/                  state.py (FinancialState), nodes.py, build.py, runner.py (SSE)
│   ├── market/                 loader.py + data/ (NIFTY 50, debt returns), news.py (RSS + offline sample)
│   ├── rag/                    BM25 retriever + knowledge/ (23 compliance rules)
│   ├── models/                 SQLAlchemy models — 12 MySQL tables
│   ├── db/                     session.py, schema.sql
│   ├── demo/                   judge_profile.json, sample_portfolio.csv
│   └── tests/                  54 tests (engines, router, graph, API)
├── frontend/
│   └── src/
│       ├── pages/              Landing, Dashboard, Twin, Investment, Loan, Goals, Portfolio,
│       │                       Spending, Crisis, Multiverse, Committee, Architecture, Audit,
│       │                       Trust, Market, Learn, HowItWorks
│       ├── three/              CompassScene (the only 3D element) + SVG fallback
│       ├── components/ charts/ services/ stores/ hooks/ lib/ styles/
├── start.sh / start.bat
└── docker-compose.yml          MySQL 8
```

## API

| Area | Endpoints |
|---|---|
| Profile | `POST/GET/PUT /api/profile` |
| Digital Twin | `POST /api/twin/create`, `GET /api/twin`, `POST /api/twin/simulate` |
| Investment | `POST /api/investment/analyze`, `POST /api/investment/optimize` |
| Loan | `POST /api/loan/analyze`, `/simulate`, `/stress-test` |
| Goals | `POST /api/goals`, `POST /api/goals/survival` (optional `current_corpus`, `expected_return_pct`; `theatre: true` adds sampled paths, path density, the stress scenarios, the optimized run and Risk DNA; `paths` 40–300) |
| Command Center | `POST /api/dashboard` (goals with probabilities, portfolio health, plan, Atlas brief) |
| Atlas | `POST /api/atlas/brief` (Capital Health Index, recommended next action, progress) |
| What-If Lab | `POST /api/whatif/lab` (`changes`, `simulate`) |
| Portfolio | `POST /api/portfolio/analyze`, `/doctor`, `/rebalance` |
| Crisis | `POST /api/crisis/simulate` |
| Multiverse | `POST /api/simulation/what-if` |
| Spending | `POST /api/spending/analyze` |
| Decision | `POST /api/decision/run`, `GET /api/decision/{id}`, `GET /api/decision/{id}/audit`, `GET /api/decision/{id}/stream` (SSE, ticketed URL), `POST /api/decision/{id}/break`, `POST /api/decision/{id}/reoptimize`, `GET /api/decisions` |
| Command | `POST /api/command` (natural language → engine) |
| Auth | `POST /api/auth/register` (name, email, password), `/login`, `GET /api/auth/me` |
| Market intelligence | `GET /api/news?category=&refresh=1` (public RSS; labelled offline sample when feeds are unreachable) |
| Meta | `GET /api/health`, `/api/market`, `/api/knowledge`, `/api/demo/judge-profile`, `/api/demo/sample-portfolio` |

## Tests

```bash
cd backend && pytest -q          # 72 tests: EMI/FV maths, twin, Risk DNA, Monte Carlo (10k < 1.5 s,
                                 # seeded, crash/job-loss), loan, goals, crisis, doctor, spending,
                                 # router, full graph reject→re-optimise→accept, API, validation, auth,
                                 # sessions, resource ownership, Atlas index/rules, What-If Lab
ruff check .
cd ../frontend && npm run typecheck && npm run lint && npm run build
```

## Safety and scope

- **Your data is yours.** Every stored decision, audit trail, stream and profile is checked server-side against its owner: the signed-in user, or for guests a random per-browser key (`X-Guest-Key`). Knowing an ID is never enough. An expired or forged sign-in is rejected (401), never silently downgraded to guest access.
- **No invented numbers.** Atlas's guidance and the Capital Health Index come from `engines/atlas.py`, which only combines numbers other engines computed; no language model writes a number.

- **Capital Compass provides scenario-based financial decision support. Simulated outcomes are not guaranteed predictions and should not be interpreted as regulated personalized financial advice.** This is shown on every result screen.
- The loan module simulates affordability only and never submits or pre-fills applications.
- The high-risk spending module covers financial consequences only. It never names platforms or strategies and never predicts outcomes, and it always ends with a safer budget plan.

## Limitations

- Market history ends in December 2023. Nothing in the app is live market data.
- Text produced by the engines and agents (Red Team findings, re-optimisation notes, agent reasoning) is in English; the interface around it is translated.
- In the Goal Survival Theatre the 3D draws a sample of the 10,000 paths (240 on desktop, 120 on phones); the probabilities, percentiles and terrain use all 10,000. Risk DNA dimension names come from the backend in English.
- Gold, inflation and the holdings correlation model are documented assumptions.
- Taxes, expense ratios and exit loads are not modelled, and equity is simulated as the NIFTY 50 index.
- The optional language model (`LLM_PROVIDER=ollama|openai`) can only rephrase the summary paragraph, and any number it drops makes the system fall back to the template text.
