# Guru

**An agentic reading companion that plans its own work, runs a tool-use loop over its own backend, and builds its own UI to show you the results.**

At Guru's core is an in-app agent, the **Journey Pipeline**. You state an intent ("catch me up on AI", "run my weekly recap") and the agent proposes a 3-6 step plan you approve. It then executes that plan through roughly 10 tools that wrap its own backend on a Claude tool-use loop, streamed over SSE. Instead of returning text, the model emits a versioned declarative UI-block schema that the app renders on the fly: article cards, carousels, activity rings, approval cards. The model generates the interface itself, not just text. Every write action surfaces an approval card first, so a human stays in the loop.

The rest of Guru:

- **Filter-driven semantic clustering** - the same articles re-cluster around the professional lens you're reading in (SentenceTransformer embeddings + scikit-learn).
- **Chrome reading overlay** - a Manifest V3 extension (Preact + Shadow DOM) that layers an annotation rail and Socratic Q&A onto any page without modifying it.
- **Weekly active-recall recap** - a 4-stage Learning Studio with memory wall, reflection, Socratic deep-dive, and one commitment.
- **10 industries, 50 specializations** - Consumer, Technology, Finance, Healthcare, Manufacturing, Energy, Real Estate, Education, Government, Non-Profit.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.11, FastAPI, SQLAlchemy, PostgreSQL |
| **Frontend** | React Native (Expo), Expo Router, TypeScript, React Query |
| **AI** | Anthropic Claude (summaries, Q&A, clustering narratives) |
| **Embeddings** | SentenceTransformers (all-MiniLM-L6-v2) for semantic clustering |
| **Scheduling** | APScheduler for background content processing |

## Project Structure

```
guru-mvp/
├── backend/              # FastAPI API server
│   ├── app/
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── routes/       # REST API endpoints
│   │   ├── services/     # Business logic (clustering, ingestion, Q&A)
│   │   ├── config.py     # Settings via pydantic-settings
│   │   └── main.py       # App entry point + startup
│   ├── config/           # Industry/specialization configuration
│   ├── requirements.txt
│   └── Dockerfile
├── mobile/               # React Native + Expo frontend
│   ├── app/              # Expo Router file-based routes
│   ├── components/       # Reusable UI components
│   ├── hooks/            # React Query data fetching hooks
│   └── services/         # API client layer
├── docker-compose.yml    # Local dev: PostgreSQL + Redis + FastAPI
└── .env.example          # Environment variable template
```

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY and JWT_SECRET_KEY

# Run development server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd mobile
npm install

# Start Expo dev server (web)
npx expo start --web --port 8081
```

### With Docker (includes PostgreSQL)

```bash
docker-compose up
```

### Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI features |
| `JWT_SECRET_KEY` | Yes | Secret for signing auth tokens |
| `DATABASE_URL` | No | Defaults to SQLite for local dev |
| `APP_ENV` | No | `development` or `production` |

## Deployment

### Railway (Recommended)

1. Push to GitHub
2. Connect repo to [Railway](https://railway.app)
3. Set environment variables in Railway dashboard
4. Railway auto-deploys from the `backend/Dockerfile`

### Frontend (Vercel)

```bash
cd mobile
npx expo export --platform web
npx vercel --prod
```

## API Overview

| Endpoint | Description |
|----------|-------------|
| `POST /auth/signup` | Create account |
| `GET /catchup-feed?filter=...` | Get clustered storyboards for a filter context |
| `GET /divein-feed` | Get articles for deep reading |
| `POST /articles/{id}/ask` | Ask a question about an article |
| `GET /recap/start` | Begin weekly recap journey |
| `GET /me/metrics` | Learning progress and ring data |

## License

MIT
