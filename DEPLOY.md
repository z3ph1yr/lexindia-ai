# Deploying LexIndia AI

The app is a **single Node process** that serves both the built UI and the REST API,
backed by a SQLite knowledge base built from committed offline caches. No secrets are
required to run it; the LLM key is optional.

## What gets deployed

| Piece | How it's produced |
| --- | --- |
| `web/dist` (static UI) | `npm --prefix web run build` |
| `data/legal.db` (knowledge base) | `node server/src/ingest/pipeline.js --skip-network` — offline: uses the committed India Code cache, IPC snapshot, official bare-act PDF and verification caches |
| API | Express, same process, port `PORT` (default 8787) |

If `data/legal.db` is missing at startup, the server **builds it automatically** before
listening — a fresh machine can never serve an empty corpus.

## Option A — Render (recommended, free tier)

1. Push the repository to GitHub (see "Secrets" below for what must NOT be pushed).
2. In Render: **New → Blueprint** → pick the repo. `render.yaml` defines everything
   (build, start, health check `/api/health`, 1 GB persistent disk at `/var/data`).
3. Set `DB_PATH=/var/data/legal.db` (already set in the blueprint).
4. (Optional) In the dashboard → Environment, add `LLM_API_KEY` / `LLM_MODEL` to enable
   LLM synthesis. Leave unset for the zero-cost deterministic demo.
5. Deploy. First boot runs the ingest (offline, ~30 s). `/api/health` turns the instance live.

## Option B — Docker (any host)

```bash
docker build -t lexindia-ai .
docker run -p 8787:8787 -v lexindia-data:/app/data lexindia-ai
```

## Option C — any Node host (Fly, Railway, VPS)

```bash
npm run setup           # install, ingest (offline caches), build UI
PORT=8080 node server/src/index.js
```

## Environment variables

See `.env.example` for the full annotated list. Summary:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (default 8787) | server port |
| `DB_PATH` | no (default `<repo>/data/legal.db`) | put on a persistent disk in production |
| `CORS_ORIGIN` | no | only if UI and API are on different origins |
| `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | no | optional grounded LLM synthesis |
| `EMBED_MODEL` | no | optional semantic vector channel |

## Secrets

- **Never commit `.env`, API keys, or any credential.** `.gitignore` excludes `.env`.
- Keys live only in the hosting dashboard's environment settings.
- The demo runs fully without any key (extractive mode, zero API cost).

## Post-deploy verification (2 minutes)

```bash
curl https://YOUR-URL/api/health          # {"status":"ok","corpus":{"provisions":933,...}}
curl "https://YOUR-URL/api/search?section=378"
curl -X POST https://YOUR-URL/api/query -H 'content-type: application/json' \
  -d '{"question":"What constitutes theft under Indian law?"}'
open https://YOUR-URL/                    # Ask → click the first example
```

Also confirm: India Code source links open (`indiacode.gov.in`), rate-limit headers
appear (`x-ratelimit-*`), and the Compare / Sources tabs load.
