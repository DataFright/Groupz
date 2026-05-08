# Deployment

## Live URLs

| Service | URL |
|---|---|
| Frontend | https://groupz-seven.vercel.app |
| Backend | https://groupz-j717.onrender.com |

---

## Environment variables

### Server (`server/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port — set automatically by Render, leave unset in dashboard |
| `CLIENT_ORIGIN` | `http://localhost:3000` | CORS allowed origin — set to your Vercel URL in production |
| `RATE_LIMIT_CREATE` | `100` | Max group creates per IP per hour |
| `RATE_LIMIT_JOIN` | `300` | Max group joins per IP per hour |

### Client (`client/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_SOCKET_URL` | `` (empty) | Backend URL — empty uses the Vite proxy in local dev; set to Render URL in production |

> `VITE_SOCKET_URL` is baked into the JS bundle at build time by Vite. It must be set in Vercel **before** the build runs.

---

## Deploying your own instance

### Step 1 — Backend on Render

1. Create a new **Web Service**, connect your GitHub repo
2. Set **Root Directory** to `server/`
3. Render detects the `Dockerfile` automatically — confirm it uses Docker runtime
4. Do **not** set `PORT` — Render injects it automatically
5. Set environment variables:
   - `CLIENT_ORIGIN` = `*` temporarily (you don't know the Vercel URL yet)
   - `RATE_LIMIT_CREATE` = `100`
   - `RATE_LIMIT_JOIN` = `300`
6. Deploy and note your Render URL (e.g. `https://your-app.onrender.com`)

### Step 2 — Frontend on Vercel

1. Create a new **Project**, connect the same GitHub repo
2. Set **Root Directory** to `client/`
3. Vercel auto-detects Vite — confirm build command `npm run build`, output `dist`
4. Set environment variable:
   - `VITE_SOCKET_URL` = your Render URL from Step 1
5. Deploy and note your Vercel URL (e.g. `https://your-app.vercel.app`)

### Step 3 — Lock down CORS

1. Go back to Render dashboard → Environment
2. Update `CLIENT_ORIGIN` from `*` to your exact Vercel URL (e.g. `https://your-app.vercel.app`)
3. Render redeploys automatically

### Step 4 — Verify

Open the Vercel URL in a browser, create a group, and confirm the map appears.

---

## Common gotcha

**`CLIENT_ORIGIN` must not have a trailing slash.**

If set to `https://your-app.vercel.app/` (with trailing slash), the server echoes that value in the `Access-Control-Allow-Origin` response header. The browser sends `Origin: https://your-app.vercel.app` (no slash) — they don't match, and the browser blocks all socket connections with a CORS error.

---

## Docker

The server ships with a production `Dockerfile` (Node 22 alpine, non-root user, built-in health check).

```bash
# Build
cd server && docker build -t groupz-server .

# Run
docker run -p 3001:3001 \
  -e CLIENT_ORIGIN=http://localhost:3000 \
  groupz-server

# Or with docker-compose from the repo root
docker-compose up --build
```

### Docker smoke test

Builds the image, starts a container on port 3099, runs 5 live checks, then tears down:

```bash
cd server && npm run test:docker
```

Checks: health endpoint, socket connects, `create-group` returns a 6-char code, `join-group` with valid code confirms, `join-group` with bad code returns `GROUP_NOT_FOUND`.

---

## CI/CD

Two GitHub Actions workflows live in `.github/workflows/`.

### CI (`ci.yml`) — runs on every push to `main`

Steps: install → lint → server tests (113) → client tests (43) → production build. Publishes a JUnit test report as a GitHub Check via `dorny/test-reporter`.

### E2E (`e2e.yml`) — runs after CI passes

1. **Wait for Render deploy** — polls the Render API (up to 10 min) until the new commit is live on the backend
2. **Install client deps** — `npm ci` (includes mochawesome)
3. **Run Cypress** — 75 specs in Chrome headless against the live production URLs
4. **Merge + generate HTML report** — mochawesome JSON files are merged and converted to `combined.html`
5. **Upload report artifact** — `cypress-report` artifact available on every run (pass or fail)
6. **Upload failure screenshots** — `cypress-screenshots` artifact uploaded only on failure
7. **Rollback on failure** — `git revert HEAD` is pushed to `main`, triggering Render + Vercel to auto-redeploy the previous working version. Pushes via `GITHUB_TOKEN` do not re-trigger Actions, so there's no infinite loop.

### Required GitHub secrets

| Secret | Where to get it |
|---|---|
| `RENDER_API_KEY` | Render dashboard → Account Settings → API Keys |
| `RENDER_SERVICE_ID` | The `srv-xxxxx` ID from your Render service URL |

### Render free-tier note

The Render free tier spins down after inactivity. The `00-warmup.cy.js` spec runs first and submits a create-group request with a generous timeout to absorb the cold start (up to ~60 s), then waits 30 s before the main suite begins.

---

## Backend has no persistent storage

Restarting the server clears all active groups. Members will be disconnected and need to create or rejoin a group. This is by design — Groupz is a session-based tool, not a persistent service.
