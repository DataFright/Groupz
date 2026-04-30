# Groupz

Real-time group location sharing for caravans, road trips, and meetups. Create a group, share the 6-character code, and see everyone on a live map — no accounts, no sign-up.

---

## Features

- Create or join a group with a unique 6-character code
- Live GPS position shared across the group every 2.5 seconds
- Fullscreen interactive map (OpenStreetMap via Leaflet) with emoji markers and name tooltips
- Re-center map button that flies back to your current location
- Geolocation error banner if GPS is denied or unavailable
- Member count and Members drawer showing who is in the group
- Host controls: remove members, end the group for everyone
- Automatic host transfer when the host disconnects
- Inactive members (no ping for >10s) shown as faded on the map
- Zombie members (no ping for >60s) automatically removed from the group
- Location update rate limiting (1 update per second per member, server-side)
- Groups auto-expire after 24 hours of inactivity
- "Connection lost" notification if the socket drops unexpectedly

---

## How It Works

### Architecture

Groupz is a two-process application: a Node.js/Express/Socket.IO backend and a React/Vite frontend. All real-time state lives in server memory — there is no database.

```
Browser                     Server (port 3001)
──────                      ──────────────────
React + Leaflet             Express + Socket.IO
         ←── WebSocket ──→
              Socket.IO
```

### Group lifecycle

1. A user fills in their name and icon and clicks **Create Group**. The client connects the socket and emits `create-group`. The server generates a unique 6-character hex code, creates an in-memory group object, and replies with `group-created`.

2. Other users enter the code and click **Join Group**. The server validates the code and replies with `join-confirmed`, including the host's socket ID so the client knows whether to render host controls.

3. Each browser runs `navigator.geolocation.getCurrentPosition` on a 2500ms `setInterval`. Valid positions are emitted as `location-update` events. The server validates coordinates, applies a 1-second per-socket rate limit, updates the member's `lat`/`lng`, and broadcasts `members-update` (a serialised member array) to the entire Socket.IO room.

4. The Leaflet map renders a `Marker` + permanent `Tooltip` for every member with a known position. The user's own marker gets the `.emoji-marker--me` class; inactive members get `.emoji-marker--inactive`.

5. The server runs a cleanup loop every 60 seconds. Members not seen in 60 seconds are removed; if this empties the group the group is deleted; if it removes the host, host transfer fires. Members not seen in 10 seconds are marked inactive (still in the group, just greyed out). Groups with no activity for 24 hours are ended and all sockets are evicted.

### State management

All group state is in a single `groups` object keyed by code:

```js
groups[code] = {
  code, hostSocketId, createdAt, lastActivity,
  members: {
    [socketId]: { socketId, name, icon, lat, lng, lastSeen, lastLocationSeen, active }
  }
}
```

`lastSeen` is updated on every accepted location update and drives the inactivity cleanup.  
`lastLocationSeen` is separate and used only for the 1-second rate-limit gate (initialised to `0` so the first update after joining is never blocked).

### Socket protocol

#### Client → Server

| Event | Payload | Description |
|---|---|---|
| `create-group` | `{ name, icon }` | Create a new group |
| `join-group` | `{ code, name, icon }` | Join an existing group by code |
| `location-update` | `{ lat, lng }` | Send current GPS position |
| `leave-group` | — | Voluntarily leave the group |
| `remove-member` | `{ targetSocketId }` | Host: remove another member |
| `end-group` | — | Host: end the group for everyone |

#### Server → Client

| Event | Recipients | Payload | Description |
|---|---|---|---|
| `group-created` | creator | `{ code, socketId, status: 201 }` | Group created successfully |
| `join-confirmed` | joiner | `{ code, socketId, hostSocketId, status: 200 }` | Joined successfully |
| `join-error` | requester | `{ code, message, status }` | Validation or lookup failure |
| `members-update` | entire room | `Member[]` | Authoritative member list after any state change |
| `host-changed` | entire room | `{ newHostSocketId, status: 200 }` | Host transferred |
| `removed-from-group` | evicted socket | `{ status: 200 }` | Kicked by host or cleaned up |
| `group-ended` | entire room | `{ status: 200 }` | Group destroyed |
| `left-group` | leaving socket | `{ status: 200 }` | Voluntary leave confirmed |

#### Error codes (`join-error`)

| Code | HTTP status | Trigger |
|---|---|---|
| `INVALID_NAME` | 400 | Empty, whitespace-only, or >16 character name |
| `INVALID_ICON` | 400 | Icon not in the allowed set |
| `CODE_REQUIRED` | 400 | `join-group` sent with no code |
| `GROUP_NOT_FOUND` | 404 | Code does not match any active group |
| `SERVER_ERROR` | 500 | Could not generate a unique group code |

---

## Project Structure

```
Groupz/
├── server/
│   ├── src/
│   │   ├── app.js          # createApp() factory — all Express + Socket.IO logic
│   │   ├── helpers.js      # validateInput, generateCode, buildMemberList, ALLOWED_ICONS
│   │   └── errorCodes.js   # ErrorCode constants and makeError() factory
│   ├── tests/
│   │   ├── unit.test.js        # Pure helper function tests
│   │   ├── smoke.test.js       # Server starts, socket connects, health endpoint
│   │   ├── function.test.js    # One handler at a time, single connected client
│   │   ├── integration.test.js # Multi-client flows (join, location, host transfer, etc.)
│   │   ├── scenarios.test.js   # Four real-world membership shapes (1 user, many users, many groups)
│   │   └── cleanup.test.js     # Inactivity auto-remove and cleanup-triggered host transfer
│   ├── server.js           # Entry point (binds port, calls createApp)
│   ├── vitest.config.js
│   ├── .env.example
│   └── package.json
└── client/
    ├── src/
    │   ├── components/
    │   │   ├── Home.jsx            # Create/Join form, tab switching, validation, error handling
    │   │   ├── GroupMap.jsx        # Fullscreen map, geolocation loop, FAB controls, banners
    │   │   ├── MapController.jsx   # (inside GroupMap) react-leaflet map instance bridge
    │   │   ├── MemberList.jsx      # Slide-in drawer, HOST/You badges, remove buttons
    │   │   ├── GroupCodeOverlay.jsx # Code display + clipboard copy button
    │   │   └── IconPicker.jsx      # 20-icon emoji grid selector
    │   ├── styles/                 # CSS Modules per component
    │   ├── tests/
    │   │   ├── smoke.test.jsx
    │   │   ├── unit/
    │   │   │   ├── Home.test.jsx
    │   │   │   └── IconPicker.test.jsx
    │   │   └── integration/
    │   │       └── AppFlow.test.jsx
    │   ├── App.jsx         # View router (home ↔ map), notification banner, socket event handlers
    │   ├── socket.js       # Singleton socket.io-client instance (autoConnect: false)
    │   └── errorCodes.js   # Mirrors server error codes for client-side routing
    ├── cypress/
    │   ├── e2e/            # 14 spec files (see Tests section)
    │   └── support/
    │       ├── commands.js         # visitWithGeo, createGroupViaUI, joinGroupViaUI
    │       └── e2e.js
    ├── scripts/
    │   └── cypress-run.cjs # Launcher that clears ELECTRON_RUN_AS_NODE before Cypress starts
    ├── cypress.config.cjs  # Cypress config + Node.js tasks for socket pool management
    ├── .env.example
    └── package.json
```

---

## Local Development

Two terminals required.

**Terminal 1 — Backend**
```bash
cd server
cp .env.example .env
npm install
npm run dev
```

**Terminal 2 — Frontend**
```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The Vite dev server proxies `/socket.io` requests to `localhost:3001`, so no CORS setup is needed locally.

### Environment variables

**`server/.env`**
```
PORT=3001
CLIENT_ORIGIN=http://localhost:3000
```

**`client/.env`**
```
VITE_SOCKET_URL=
```

Leave `VITE_SOCKET_URL` empty for local dev — the Vite proxy handles it. Set it to your deployed backend URL in production.

---

## Tests

The project has three test layers.

### 1. Server — Vitest (105 tests)

Located in `server/tests/`. Run with:

```bash
cd server && npm test
```

| File | Tests | What it covers |
|---|---|---|
| `unit.test.js` | 24 | Pure helper functions: `validateInput`, `generateCode`, `buildMemberList`, `makeError`, all error codes |
| `smoke.test.js` | 5 | Server starts cleanly, health endpoint responds, socket connects and disconnects, unknown events ignored |
| `function.test.js` | 33 | Each socket event handler in isolation with a single client: `create-group`, `join-group`, `location-update` (including rate limiting), `leave-group`, `remove-member`, `end-group`, REST API |
| `integration.test.js` | 11 | Multi-client flows: full create→join→location session, host transfer, group lifecycle, simultaneous location updates, `remove-member` cascade |
| `scenarios.test.js` | 26 | Four real-world shapes: single user, multiple users in one group, multiple groups with one user each, multiple groups with multiple users each — including isolation and cross-contamination checks |
| `cleanup.test.js` | 6 | Inactivity auto-remove: member removed after `lastSeen > 60s`, `removed-from-group` delivered, remaining members notified, group deleted when empty, host transfer when idle host is removed, new host can end group |

### 2. Client — Vitest (React Testing Library)

Located in `client/src/tests/`. Run with:

```bash
cd client && npm test
```

| File | What it covers |
|---|---|
| `smoke.test.jsx` | App mounts without crashing |
| `unit/Home.test.jsx` | Home form rendering, tab switching, validation messages |
| `unit/IconPicker.test.jsx` | Icon grid renders, selection state, onChange callback |
| `integration/AppFlow.test.jsx` | Mocked socket flow: create group, join group, error handling |

### 3. End-to-end — Cypress 13 in Chrome (73 tests)

Located in `client/cypress/e2e/`. Requires both servers running. Run with:

```bash
cd client && npm run e2e       # headless (CI)
cd client && npm run cy:open   # interactive
```

| Spec | Tests | What it covers |
|---|---|---|
| `home.cy.js` | 7 | Title, subtitle, tabs, name and code inputs, icon picker display |
| `tabs-and-validation.cy.js` | 7 | Tab switching, code auto-uppercase, submit label changes, client-side validation errors |
| `validation-edge-cases.cy.js` | 3 | Whitespace-only name rejected, `maxlength` on name (16) and code (6) inputs |
| `icon-picker.cy.js` | 3 | Default icon selected, clicking changes selection, persists across tab switch |
| `create-group.cy.js` | 7 | Full create flow: map renders, CODE label, 6-char code displayed, End Group button, member count |
| `join-group.cy.js` | 5 | Valid join, non-host sees Leave not End Group, member count, map shows code, error for unknown code |
| `group-session.cy.js` | 7 | End Group dialog (open, cancel, confirm), Leave dialog (open, cancel, confirm), Members drawer |
| `group-code-copy.cy.js` | 2 | Copy button shows ✓ on click, reverts to ⎘ after 2s |
| `host-transfer.cy.js` | 2 | Non-host gains End Group button after host disconnects, member count updates |
| `member-list-multi.cy.js` | 9 | Host perspective: both members visible, You/HOST badges, remove button, removing drops count. Non-host perspective: no remove buttons, HOST badge, You badge |
| `map-markers.cy.js` | 3 | Own emoji marker appears, own name tooltip appears, second member's marker/tooltip appear when they join with a known location |
| `geo-error.cy.js` | 4 | Banner appears when geolocation denied, includes browser error message, dismissed by ✕ button, absent when geolocation succeeds |
| `recenter-button.cy.js` | 3 | 🎯 FAB is visible, clicking leaves map intact, clicking before first GPS fix resolves silently |
| `scenarios.cy.js` | 11 | Four real-world group shapes verified at the UI layer: single user (count, badges, end), multiple users (count, drawer, disconnect, end), multiple groups one user each (isolation, health endpoint), multiple groups multiple users each (isolation, health endpoint) |

#### Cypress task infrastructure

`cypress.config.cjs` exposes Node.js tasks that create and manage Socket.IO connections from outside the browser, enabling multi-user scenarios without opening multiple tabs:

| Task | What it does |
|---|---|
| `createGroupAndHold` | Creates a group, keeps the host socket open in `heldSocket` |
| `releaseGroupSocket` | Disconnects `heldSocket` |
| `joinGroupAndHold` | Joins a group (optionally with lat/lng), keeps socket in `heldJoinSocket` |
| `releaseJoinSocket` | Disconnects `heldJoinSocket` |
| `createGroupInPool` | Creates a group, stores socket by ID in `socketPool` |
| `joinGroupInPool` | Joins a group, stores socket by ID in `socketPool` |
| `releasePoolSocket` | Disconnects one named pool socket |
| `releaseAllPoolSockets` | Disconnects and clears all pool sockets |

---

## Deployment

| Service | Target |
|---|---|
| Frontend | Vercel |
| Backend | Render or Railway |

Set `VITE_SOCKET_URL` in Vercel to your backend's public URL (e.g. `https://groupz-api.onrender.com`).  
Set `CLIENT_ORIGIN` on the backend to your Vercel frontend URL (e.g. `https://groupz.vercel.app`).

The backend has no persistent storage — restarting it clears all active groups.
