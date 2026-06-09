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

1. A user fills in their name and icon and clicks **Create Group**. The client connects the socket and emits `create-group`. The server validates the name (must be 1–16 characters, no control characters) and icon (must be in the allowed set), generates a unique 6-character hex code, creates an in-memory group object, and replies with `group-created`.

2. Other users enter the code and click **Join Group**. The server validates the code and replies with `join-confirmed`, including the host's socket ID so the client knows whether to render host controls.

3. Each browser runs `navigator.geolocation.getCurrentPosition` on a 2500ms `setInterval`. Valid positions are emitted as `location-update` events. The server validates coordinates, applies a 1-second per-socket rate limit, updates the member's `lat`/`lng`, and broadcasts `members-update` (a serialised member array) to the entire Socket.IO room.

4. The Leaflet map renders a `Marker` + permanent `Tooltip` for every member with a known position. The user's own marker gets the `.emoji-marker--me` class; inactive members get `.emoji-marker--inactive`. Two map UX features assist readability:
   - **North compass** — a fixed circle with "N" in the top-left corner of the map reminds users that the map is always north-up and cannot be rotated.
   - **Overlap spread** — members within ~11 metres of each other (same `lat`/`lng` rounded to 4 decimal places) are spread radially by 26px so their icons and name tooltips never stack on top of each other. The offset is applied via CSS `transform: translate()` on the icon HTML rather than `iconAnchor` manipulation, which ensures the tooltip follows the icon exactly.

5. The server runs a cleanup loop on the interval configured by `cleanupIntervalMs` (default: 60 seconds):
   - Members not seen in **3 minutes** are removed (zombie-socket eviction). If this empties the group the group is deleted; if it removes the host, host transfer fires.
   - Members not seen in **10 seconds** are marked inactive (still in the group, just visually greyed out on the map).
   - Groups older than **16 hours** are ended immediately and all sockets evicted.
   - Groups with no activity for **24 hours** are ended.
   - Rate-limit buckets for IPs whose windows have elapsed are pruned from memory.

6. When a user's phone locks or the browser suspends, the WebSocket drops. Instead of sending the user to the home screen immediately, the client enters a **reconnecting state**: it stores the current group info in a ref, shows an amber "Reconnecting…" banner over the map, and lets Socket.IO's built-in retry loop attempt reconnection (up to 10 attempts, 1.5s–8s back-off). When reconnected, the client automatically re-emits `join-group` with the stored name/icon/code to silently rejoin under the new socket ID. See [mobile.md](mobile.md) for full details.

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
      lastSeen,         // updated on every accepted location-update; drives inactivity cleanup
      lastLocationSeen, // tracks per-socket location rate limit (starts at 0)
      active
    }
  }
}
```

A parallel `socketToGroup` map (`socketId → code`) allows O(1) group lookup on disconnect and location-update events.

`buildMemberList(group)` serialises the members object into the array sent to clients. It includes only `socketId`, `name`, `icon`, `lat`, `lng`, and `active` — internal fields like `lastSeen` and `lastLocationSeen` are never sent to the client.

## Server entry point

`server/server.js` calls `createApp()` from `server/src/app.js`. The factory returns `{ app, httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits, ipLookupLimits }` — everything is dependency-injected so tests can create isolated instances on random ports without touching global state.

Key `createApp` options:

| Option | Default | Purpose |
|---|---|---|
| `corsOrigin` | `http://localhost:3000` | CORS allowed origin |
| `cleanupIntervalMs` | `60_000` | How often the cleanup loop runs |
| `maxGroupAgeMs` | `16h` | Hard group lifetime |
| `maxGroupSize` | `20` | Max members per group |
| `ipRateLimits.createGroup` | `{max:100, windowMs:1h}` | Create rate limit |
| `ipRateLimits.joinGroup` | `{max:300, windowMs:1h}` | Join rate limit |
| `ipRateLimits.lookup` | `{max:60, windowMs:1min}` | REST group-lookup rate limit |

## Map UX features

### North compass

A fixed `div` in the top-left corner of the map (below the group code bar) displays a dark circle with the letter "N" near the top. This indicates that the map is always oriented with north at the top — Groupz does not support map rotation. The compass is positioned at `top: 68px; left: 12px` with `z-index: 1000` so it floats above the Leaflet tile layer.

### Overlap protection

When two or more members share the same GPS coordinates (within ~11m), their markers would stack and make only one person visible. `computeOverlapOffsets(members)` groups members by `lat.toFixed(4),lng.toFixed(4)` key and assigns each a radial offset:

```js
const angle = (2 * Math.PI * i) / ids.length
offsets[id] = [Math.round(26 * Math.cos(angle)), Math.round(26 * Math.sin(angle))]
```

The offset is applied as `style="transform:translate(Xpx,Ypx)"` in the icon HTML, and the Tooltip `offset` prop and `key` are both set to the same `(dx, dy)` values so the name label follows its icon exactly (forcing Tooltip remount prevents stale offsets from react-leaflet's cache).

## Input validation

`validateInput(name, icon)` in `helpers.js` enforces:

1. Name must be a non-empty string after trimming
2. Name length ≤ 16 characters
3. Name must not contain ASCII control characters (`\x00–\x1f`, `\x7f`) — rejects embedded newlines, tabs, null bytes, etc.
4. Icon must be an exact member of `ALLOWED_ICONS` (a Set of 20 emoji)

`join-group` normalises the incoming code: non-string values are treated as an empty string (returns `CODE_REQUIRED`); strings are trimmed and uppercased before lookup.

## Known limitations

**Mobile browser sleep / tab close**
When a phone locks, the OS suspends the browser process and the WebSocket disconnects. Groupz handles this gracefully: the client shows a "Reconnecting…" banner and automatically rejoins once the connection is restored. If the user is the sole member and the group is deleted during the gap, or if all 10 reconnect attempts fail, the user is sent home with a clear message. See [mobile.md](mobile.md) for the full flow and limitations.

**No persistence**
All group state lives in server memory. A server restart, crash, or Render cold-start clears every active group. Members are disconnected and must recreate or rejoin.

**Single-process ceiling**
All groups share one Node.js event loop. Horizontal scaling (multiple server instances) requires adding the `@socket.io/redis-adapter` so instances share room state. Without it, users connected to different instances cannot be in the same group. See [benchmarks](benchmarks.md) for capacity numbers.

**No offline support**
The app requires an active internet connection. When connectivity is lost the reconnecting flow activates, but location sharing stops until the connection is restored.

---

## Limits

| Limit | Value | Configurable |
|---|---|---|
| Max members per group | 20 | `maxGroupSize` in `createApp()` |
| Hard group age | 16 hours | `maxGroupAgeMs` in `createApp()` |
| Inactivity expiry (zombie eviction) | 3 minutes | hardcoded |
| Inactivity label (greyed out) | 10 seconds | hardcoded |
| No-activity expiry | 24 hours | hardcoded |
| Location update rate | 1/s per socket | hardcoded |
| IP create rate | 100/hour | `RATE_LIMIT_CREATE` env var |
| IP join rate | 300/hour | `RATE_LIMIT_JOIN` env var |
| IP group lookup rate (REST) | 60/minute | `ipRateLimits.lookup` in `createApp()` |
| Socket reconnect attempts | 10 | `reconnectionAttempts` in `socket.js` |
| Socket reconnect back-off | 1.5s–8s | `reconnectionDelay/Max` in `socket.js` |
