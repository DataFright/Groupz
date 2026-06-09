# Groupz

Real-time group location sharing for caravans, road trips, and meetups. Create a group, share the 6-character code, and see everyone on a live map — no accounts, no sign-up.

**Live:** [groupz-seven.vercel.app](https://groupz-seven.vercel.app)

---

## Features

- Create or join a group with a unique 6-character code
- Live GPS position shared across the group every 2.5 seconds
- Fullscreen interactive map (OpenStreetMap via Leaflet) with emoji markers and name tooltips
- North compass indicator — map is always north-up, so you always know your orientation
- Overlapping markers spread apart radially so everyone's icon and name are always readable
- Mobile screen-lock reconnect — locking your phone shows a "Reconnecting…" banner and automatically rejoins the group when you unlock, with no manual steps
- Re-center button, geolocation error banner, connection-lost notification
- Member count and Members drawer with HOST/You badges
- Host controls: remove members, end the group for everyone
- Automatic host transfer on disconnect
- Inactive members faded after 10s, removed after 3 minutes of inactivity
- Max 20 members per group, 16-hour hard group lifetime
- IP rate limiting (100 creates / 300 joins per hour, 60 group lookups per minute — configurable)
- Server health endpoint (`/health`)

---

## Quick Start

Two terminals required.

```bash
# Terminal 1 — backend
cd server && cp .env.example .env && npm install && npm run dev

# Terminal 2 — frontend
cd client && cp .env.example .env && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Leave `VITE_SOCKET_URL` empty in `client/.env` — the Vite dev server proxies socket requests to `localhost:3001` automatically.

---

## Docs

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | System design, group lifecycle, map features, state shape, server limits |
| [Mobile](docs/mobile.md) | Screen-lock reconnect, mobile behaviour, limitations |
| [Protocol](docs/protocol.md) | Socket events, error codes, REST endpoints, member object shape |
| [Testing](docs/testing.md) | Server Vitest (164), Client Vitest (60), Cypress e2e, task infrastructure |
| [Deployment](docs/deployment.md) | Render + Vercel setup, Docker, environment variables, common gotchas |
| [Benchmarks](docs/benchmarks.md) | Load test results, estimated capacity by tier, scaling path |

---

## Project Structure

```
Groupz/
├── docs/                   # Architecture, mobile, protocol, testing, deployment, benchmarks
├── docker-compose.yml
├── server/
│   ├── src/                # app.js, helpers.js, errorCodes.js, metrics.js
│   ├── tests/              # unit, smoke, function, integration, scenarios, cleanup, metrics
│   ├── scripts/            # docker-smoke.js, load-test.js
│   ├── Dockerfile
│   └── server.js
└── client/
    ├── src/
    │   ├── components/     # Home, GroupMap, MemberList, GroupCodeOverlay, IconPicker
    │   ├── constants/      # icons.js
    │   ├── tests/          # smoke, unit, integration
    │   └── App.jsx
    └── cypress/
        └── e2e/            # 15 spec files
```
