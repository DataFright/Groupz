# Groupz

Real-time group location sharing web app for caravans, road trips, meetups, festivals and concerts. Create a group, share the 6-character code, and see everyone on a live map — no accounts, no sign-up and its all free.

**Live:** [groupz-seven.vercel.app](https://groupz-seven.vercel.app)

---

## Features

- Create or join a group with a unique 6-character code
- **Share button** (↗) next to the group code copies a ready-to-send join link to clipboard. On mobile, triggers the native share sheet so you can drop it straight into a chat or message thread. The link opens Groupz with the Join Group tab selected and the code pre-filled — recipient just enters their name and taps Join
- Live GPS position shared across the group every 2.5 seconds
- Fullscreen interactive map (OpenStreetMap via Leaflet) with emoji markers and name tooltips
- North compass indicator — map is always north-up, so you always know your orientation
- Overlapping markers spread apart radially so everyone's icon and name are always readable
- Screen Wake Lock — keeps the display on while the map is active so the phone doesn't sleep mid-trip (Chrome/Edge 84+, Safari iOS 16.4+, Firefox 126+)
- Mobile screen-lock reconnect — if the screen does lock, shows a "Reconnecting…" banner and automatically rejoins the group when you unlock, with no manual steps. Solo members get a 3-minute grace period before the group expires
- Re-center button, geolocation error banner, connection-lost notification
- Member count (top-right) and Members drawer with HOST/You badges
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
| [Testing](docs/testing.md) | Server Vitest (171), Client Vitest (89), Cypress e2e (105 tests, 17 specs), task infrastructure |
| [Deployment](docs/deployment.md) | Render + Vercel setup, Docker, environment variables, common gotchas |
| [Benchmarks](docs/benchmarks.md) | Load test results, estimated capacity by tier, scaling path |
| [Scaling](docs/scaling.md) | Infrastructure cost breakdown by tier, Socket.IO horizontal scaling, provider comparison, Redis, GCP, AWS, cost stacks |

---

## Project Structure

```
Groupz/
├── .github/workflows/      # ci.yml (lint + unit tests), e2e.yml (post-deploy Cypress)
├── docs/                   # architecture, mobile, protocol, testing, deployment, benchmarks, scaling
├── docker-compose.yml
├── server/
│   ├── src/
│   │   ├── app.js          # Express routes + Socket.IO event handlers (createApp factory)
│   │   ├── helpers.js      # validateInput, generateCode, buildMemberList, ALLOWED_ICONS
│   │   ├── errorCodes.js   # ErrorCode constants, ErrorStatus map, makeError()
│   │   └── metrics.js      # usage stats endpoint
│   ├── tests/              # unit, smoke, function, integration, scenarios, cleanup, metrics
│   ├── scripts/            # docker-smoke.js, load-test.js
│   ├── Dockerfile
│   └── server.js
└── client/
    ├── src/
    │   ├── components/     # Home, GroupMap, MemberList, GroupCodeOverlay, IconPicker
    │   ├── constants/      # icons.js
    │   ├── styles/         # CSS Modules (App, GroupMap, Home, IconPicker, MemberList, global)
    │   ├── tests/          # smoke, unit (Home, GroupCodeOverlay, IconPicker, GroupMap), integration
    │   ├── App.jsx         # view router, socket event handlers, notification banner
    │   ├── socket.js       # singleton socket.io-client instance
    │   ├── errorCodes.js   # mirrors server error codes
    │   └── main.jsx
    ├── cypress/
    │   ├── e2e/            # 17 spec files (105 tests)
    │   └── support/        # commands.js, e2e.js
    ├── scripts/
    │   └── cypress-run.cjs # VS Code-safe Cypress launcher (strips ELECTRON_RUN_AS_NODE)
    └── cypress.config.cjs  # Cypress config + cy.task() socket helpers
```
