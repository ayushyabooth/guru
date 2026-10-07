# Guru

**An agentic reading companion that plans its own work, runs a tool-use loop over its own backend, and builds its own UI to show you the results.**

At Guru's core is an in-app agent, the **Journey Pipeline**. You state an intent ("catch me up on AI", "run my recap") and the agent proposes a 3-5 step plan. You start it, and the agent runs one step per turn on a Claude tool-use loop, streamed over SSE, through 18 tools that wrap Guru's own API. Instead of returning text, the model answers in a typed UI-block schema that the app renders on the fly: article cards, carousels, activity rings, recap steps. The model generates the interface itself, not just text. When the agent reaches for a write that puts words in your name, a note or your commitment, the server shows an approval card and waits for your yes. A save or a skip you ask for runs at once.

The rest of Guru:

- **Filter-driven semantic clustering** - the same articles re-cluster around the professional lens you're reading in (MiniLM embeddings + scikit-learn).
- **Chrome reading overlay** - a Manifest V3 extension (Preact in a closed Shadow DOM) that adds an annotation rail and Socratic Q&A to articles Guru has ingested, on their original sites. The overlay's styles never touch the page, and highlights wrap the selected text in `<mark>` tags.
- **Active-recall recap** - a 4-stage Learning Studio with memory wall, reflection, Socratic deep-dive, and one commitment.
- **11 industries, 61 specializations** - AI, Consumer, Technology, Finance, Healthcare, Manufacturing, Energy, Real Estate, Education, Government, Non-Profit.
- **Agent observability** - every agent turn writes a trace. Admins see takeaways, flagged turns and a per-turn diagnosis in the app, and `make traces` pulls the same readout into a terminal.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.11, FastAPI, SQLAlchemy, PostgreSQL (Neon) |
| **Frontend** | React Native (Expo SDK 54), Expo Router, TypeScript, React Query, exported to the web |
| **AI** | Anthropic Claude: Sonnet 5 runs the agent; Sonnet 4.5 runs the Socratic chat and the recap synthesis; Haiku runs ingestion, summaries and quick Q&A |
| **Embeddings** | all-MiniLM-L6-v2 through fastembed (ONNX), sentence-transformers as a fallback |
| **Scheduling** | APScheduler for background ingestion |
| **Hosting** | Railway (backend), Neon (Postgres), Vercel (web) |

## Project Structure

```
guru-mvp/
├── backend/              # FastAPI API server
│   ├── app/
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── routes/       # REST API endpoints, including the agent (agent.py)
│   │   ├── services/     # Clustering, ingestion, Q&A, tracing, access
│   │   ├── config.py     # Settings via pydantic-settings
│   │   └── main.py       # App entry point + startup
│   ├── config/           # Industry/specialization configuration
│   ├── scripts/          # traces.py (agent traces) and one-off maintenance scripts
│   ├── tests/            # pytest; the agent contract tests run offline
│   ├── requirements.txt
│   └── Dockerfile
├── mobile/               # React Native + Expo app, exported to the web
│   ├── app/              # Expo Router file-based routes
│   ├── components/       # UI components, including the agent's block renderer
│   ├── hooks/            # React Query data fetching hooks
│   └── services/         # API client layer
├── extension/            # Chrome reading overlay (Manifest V3)
├── docs/                 # Agent design doc, known gaps
├── CLAUDE.md             # How to work in this repo with Claude Code
├── Makefile              # Tests and trace readouts
├── docker-compose.yml    # Local dev: PostgreSQL + FastAPI (and a Redis the code doesn't use yet)
└── .env.example          # Root template; the backend itself reads backend/.env
```

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 20.19.4+ (Expo SDK 54 / React Native 0.81)
- An [Anthropic API key](https://console.anthropic.com/)

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env - set ANTHROPIC_API_KEY and JWT_SECRET_KEY

# Run development server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Startup creates missing tables and columns, deletes content older than 30 days, and starts background ingestion. Ingestion calls the Anthropic API, paid web search included, so the first start on an empty database costs money. There is no switch to turn it off yet.

### Frontend

```bash
cd mobile
npm ci

# Start Expo dev server (web)
npx expo start --web --port 8081
```

The app calls the API at `EXPO_PUBLIC_API_URL` and falls back to `http://localhost:8000/api/v1`.

### Tests

```bash
make test-agent              # agent contract, admin access and trace diagnosis: offline, a few seconds
make test                    # the full backend suite; it has known failures and writes test users to the local database
cd mobile && npx tsc --noEmit # fails today on one old e2e test file, see docs/known-gaps.md
```

### With Docker (includes PostgreSQL)

```bash
docker-compose up
```

### Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure it. The template doesn't list the last six variables below yet; add them by hand if you need them.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI features |
| `JWT_SECRET_KEY` | Yes | Secret for signing auth tokens |
| `DATABASE_URL` | No | Defaults to SQLite for local dev |
| `APP_ENV` | No | `development` or `production` |
| `AGENT_MODEL` | No | The agent's model, `claude-sonnet-5` by default |
| `ADMIN_EMAILS` | No | Comma-separated admin accounts. Admin screens and endpoints check it on the server |
| `ADMIN_API_KEY` | No | Read-only key for `make traces`, at least 32 characters |
| `BETA_EMAILS` | No | Comma-separated beta testers |
| `SYNTHETIC_EMAIL_DOMAINS` | No | Email domains whose traffic is labeled synthetic in traces, `example.com` by default |
| `TRACE_FULL_TEXT` | No | `true` by default: while pre-beta, agent traces keep full text for every user. `false` turns privacy mode on |

## Deployment

### Backend (Railway)

The Railway service is set up, in its dashboard, to build `backend/Dockerfile` on every push to `main` and to switch traffic once `/health` answers. Nothing in the repo pins that, so check the settings if you fork. Every restart runs the startup steps above, so check what they will do before you push.

### Web (Vercel)

The Vercel project isn't connected to git. Deploy from the CLI; `vercel.json` runs the Expo web export. The CLI uploads the local folder, uncommitted files included, so start from a clean `git status`.

```bash
cd mobile
npx vercel deploy --build-env EXPO_PUBLIC_API_URL=<your backend>/api/v1   # preview
npx vercel deploy --prod                                                  # production
```

A production build reads `EXPO_PUBLIC_API_URL` from the Vercel project, or else from the committed `mobile/.env.production`. Point it at your own backend before you deploy a copy.

## API Overview

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/auth/signup` | Create account |
| `POST /api/v1/agent/turn` | One agent turn, streamed over SSE |
| `GET /api/v1/catchup-feed?filter=...` | Clustered storyboards for a filter context |
| `GET /api/v1/divein-feed` | Articles for deep reading |
| `POST /api/v1/articles/{id}/ask` | Ask a question about an article |
| `POST /api/v1/recap/start` | Begin a recap |
| `GET /api/v1/me/metrics` | Learning progress and ring data |
| `GET /api/v1/admin/agent/summary` | Agent takeaways and flagged turns (admins only) |

A running backend serves interactive API docs at `/docs`.

## Working with Claude Code

`CLAUDE.md` is the brief: the agent contract, what never to touch, and what done means. Design rules for the app are in `mobile/CLAUDE.md`, and known gaps in `docs/known-gaps.md`.

## License

MIT. See [LICENSE](LICENSE).
