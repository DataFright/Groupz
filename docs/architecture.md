# Architecture

## Overview

Groupz is a two-process application: a Node.js/Express/Socket.IO backend and a React/Vite frontend. All real-time state lives in server memory — there is no database.

```
Browser                     Server (port 3001)
──────                      ──────────────────
React + Leaflet             Express + Socket.IO
         ←── WebSocket ──→
              Socket.IO
```

## Group lifecycle

1. A user fills in their name and icon and clicks **Create Group**. The client connects the socket and emits `create-group`. The server generates a unique 6-character hex code, creates an in-memory group object, and replies with `group-created`.

2. Other users enter the code and click **Join Group**. The server validates the code and replies with `join-confirmed`, including the host's socket ID so the client knows whether to render host controls.

3. Each browser runs `navigator.geolocation.getCurrentPosition` on a 2500ms `setInterval`. Valid positions are emitted as `location-update` events. The server validates coordinates, applies a 1-second per-socket rate limit, updates the member's `lat`/`lng`, and broadcasts `members-update` (a serialised member array) to the entire Socket.IO room.

4. The Leaflet map renders a `Marker` + permanent `Tooltip` for every member with a known position. The user's own marker gets the `.emoji-marker--me` class; inactive members get `.emoji-marker--inactive`.

5. The server runs a cleanup loop every 60 seconds:
   - Members not seen in 60 seconds are removed; if this empties the group the group is deleted; if it removes the host, host transfer fires
   - Members not seen in 10 seconds are marked inactive (still in the group, just greyed out)
   - Groups older than 16 hours are ended immediately
   - Groups with no activity for 24 hours are ended and all sockets are evicted

## State shape

All group state lives in a single `groups` object keyed by code:

```js
groups[code] = {
  code,
  hostSocketId,
  createdAt,
  lastActivity,
  members: {
    [socketId]: {
      socketId, name, icon,
      lat, lng,
      lastSeen,        // drives inactivity cleanup
      lastLocationSeen, // drives per-socket location rate limit (starts at 0)
      active
    }
  }
}
```

A parallel `socketToGroup` map (`socketId → code`) allows O(1) group lookup on disconnect and location-update events.

## Server entry point

`server/server.js` calls `createApp()` from `server/src/app.js`. The factory returns `{ app, httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits }` — everything is dependency-injected so tests can create isolated instances on random ports without touching global state.

## Known limitations

**Mobile browser sleep / tab close**
When a phone locks or the browser tab is closed, the OS suspends the browser process. The WebSocket disconnects and the member is removed from the group after 60 seconds of inactivity. There is no reconnection to the same session — the user has to rejoin. This is a fundamental browser constraint; a native mobile app with a background location service would not have this problem.

**No persistence**
All group state lives in server memory. A server restart, crash, or Render cold-start clears every active group. Members are disconnected and must recreate or rejoin.

**Single-process ceiling**
All groups share one Node.js event loop. Horizontal scaling (multiple server instances) requires adding the `@socket.io/redis-adapter` so instances share room state. Without it, users connected to different instances cannot be in the same group. See [benchmarks](benchmarks.md) for capacity numbers.

**No offline support**
The app requires an active internet connection. There is no service worker, no cached state, and no graceful degradation when connectivity is lost (a "connection lost" banner is shown, but location sharing stops).

---

## Limits

| Limit | Value | Configurable |
|---|---|---|
| Max members per group | 20 | `maxGroupSize` in `createApp()` |
| Hard group age | 16 hours | `maxGroupAgeMs` in `createApp()` |
| Inactivity expiry | 24 hours | hardcoded |
| Location update rate | 1/s per socket | hardcoded |
| IP create rate | 100/hour | `RATE_LIMIT_CREATE` env var |
| IP join rate | 300/hour | `RATE_LIMIT_JOIN` env var |
