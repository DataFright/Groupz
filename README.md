# Groupz

Real-time group location sharing for caravans, road trips, and meetups. Create a group, share the 6-character code, and see everyone on a live map — no accounts, no sign-up.

## Features

- Create or join a group with a unique 6-character code
- Share your live GPS position with the group (updates every 2.5s)
- See all members on a fullscreen interactive map
- Host controls: remove members, end the group
- Automatic host transfer if the host disconnects
- Groups auto-expire after 24 hours of inactivity

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5 |
| Map | Leaflet 1.9, react-leaflet 4 |
| Realtime | Socket.IO client 4 |
| Backend | Node.js, Express 4, Socket.IO 4 |
| Storage | In-memory only (no database) |
| Tests | Vitest, React Testing Library |

## Project Structure

```
Groupz/
├── server/
│   ├── src/
│   │   ├── app.js          # createApp() factory — all socket logic
│   │   ├── helpers.js      # Pure utility functions (validateInput, generateCode, etc.)
│   │   └── errorCodes.js   # Typed error constants and makeError() factory
│   ├── tests/
│   │   ├── smoke.test.js
│   │   ├── unit.test.js
│   │   ├── function.test.js
│   │   └── integration.test.js
│   ├── server.js           # Entry point
│   ├── .env.example
│   └── package.json
└── client/
    ├── src/
    │   ├── components/
    │   │   ├── Home.jsx
    │   │   ├── GroupMap.jsx
    │   │   ├── MemberList.jsx
    │   │   ├── IconPicker.jsx
    │   │   └── GroupCodeOverlay.jsx
    │   ├── tests/
    │   │   ├── smoke.test.jsx
    │   │   ├── unit/
    │   │   └── integration/
    │   ├── App.jsx
    │   ├── socket.js
    │   └── errorCodes.js
    ├── .env.example
    └── package.json
```

## Local Development

You need two terminals.

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

The Vite dev server proxies `/socket.io` requests to the backend at `localhost:3001`, so no CORS config is needed locally.

## Environment Variables

**`server/.env`**
```
PORT=3001
CLIENT_ORIGIN=http://localhost:3000
```

**`client/.env`**
```
VITE_SOCKET_URL=
```
Leave `VITE_SOCKET_URL` empty for local dev — the Vite proxy handles it. Set it to your backend URL in production.

## Running Tests

```bash
# Server tests (smoke, unit, function, integration)
cd server
npm test

# Client tests (smoke, unit, integration)
cd client
npm test
```

## Deployment

| Service | Target |
|---|---|
| Frontend | Vercel |
| Backend | Render or Railway |

Set `VITE_SOCKET_URL` in Vercel to your backend's public URL, and set `CLIENT_ORIGIN` on the backend to your Vercel frontend URL.

## Socket Events

### Client → Server

| Event | Payload |
|---|---|
| `create-group` | `{ name, icon }` |
| `join-group` | `{ code, name, icon }` |
| `location-update` | `{ lat, lng }` |
| `leave-group` | `{}` |
| `remove-member` | `{ targetSocketId }` |
| `end-group` | `{}` |

### Server → Client

| Event | Recipients | Payload |
|---|---|---|
| `group-created` | creator | `{ code, socketId, status }` |
| `join-confirmed` | joiner | `{ code, socketId, hostSocketId, status }` |
| `join-error` | joiner | `{ code, message, status }` |
| `members-update` | entire room | `Member[]` |
| `host-changed` | entire room | `{ newHostSocketId, status }` |
| `removed-from-group` | kicked socket | `{ status }` |
| `group-ended` | entire room | `{ status }` |
| `left-group` | leaving socket | `{ status }` |
