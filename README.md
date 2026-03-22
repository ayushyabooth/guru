# Guru

**AI-powered industry intelligence platform** that transforms how professionals stay current. Guru dynamically clusters articles by semantic similarity, generates AI-powered summaries and insights, and guides deeper understanding through Socratic Q&A.

## What It Does

- **Smart Clustering** — Articles are semantically grouped into coherent storyboards that adapt to your professional context
- **Multi-Filter Views** — Switch between industries and specializations; articles re-cluster dynamically per context
- **Rich Summaries** — AI-generated "What's in it", "Why it matters", "Between the lines" breakdowns for every article
- **Socratic Q&A** — Ask questions about any article and get contextual, citation-backed answers
- **WebView Reader** — Read original articles in-app with annotation overlays, highlights, and notes
- **Weekly Recap** — Guided reflection journey with active recall questions and insight extraction
- **10 Industries, 50 Specializations** — Consumer, Technology, Finance, Healthcare, Manufacturing, Energy, Real Estate, Education, Government, Non-Profit

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
