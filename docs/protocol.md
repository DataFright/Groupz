# Socket Protocol

All real-time communication uses Socket.IO over WebSocket. There is no REST API for group operations — only the health and group-info endpoints are HTTP.

## Client → Server events

| Event | Payload | Description |
|---|---|---|
| `create-group` | `{ name, icon }` | Create a new group |
| `join-group` | `{ code, name, icon }` | Join an existing group by code. Also used by the reconnect flow to silently rejoin after a screen-lock disconnect. |
| `location-update` | `{ lat, lng }` | Send current GPS position |
| `leave-group` | — | Voluntarily leave the group |
| `remove-member` | `{ targetSocketId }` | Host only: remove another member |
| `end-group` | — | Host only: end the group for everyone |

## Server → Client events

| Event | Recipients | Payload | Description |
|---|---|---|---|
| `group-created` | creator | `{ code, socketId, status: 201 }` | Group created successfully |
| `join-confirmed` | joiner | `{ code, socketId, hostSocketId, status: 200 }` | Joined successfully. Also returned when rejoining after a reconnect. |
| `join-error` | requester | `{ code, message, status }` | Validation or lookup failure |
| `members-update` | entire room | `Member[]` | Authoritative member list after any state change |
| `host-changed` | entire room | `{ newHostSocketId, status: 200 }` | Host transferred |
| `removed-from-group` | evicted socket | `{ status: 200 }` | Kicked by host or cleaned up by server |
| `group-ended` | entire room | `{ status: 200 }` | Group destroyed |
| `left-group` | leaving socket | `{ status: 200 }` | Voluntary leave confirmed |

## Error codes

All errors are delivered via the `join-error` event.

| Code | HTTP status | Trigger |
|---|---|---|
| `INVALID_NAME` | 400 | Empty, whitespace-only, >16 character, or control-character name |
| `INVALID_ICON` | 400 | Icon not in the allowed set of 20 emoji |
| `CODE_REQUIRED` | 400 | `join-group` sent with no code, an empty code, or a non-string value |
| `GROUP_NOT_FOUND` | 404 | Code does not match any active group |
| `GROUP_FULL` | 400 | Group has reached the 20-member limit |
| `RATE_LIMITED` | 429 | IP has exceeded the create or join rate limit |
| `SERVER_ERROR` | 500 | Could not generate a unique group code after 10 attempts |

### Name validation rules

Names go through `validateInput()` before any group operation:

1. Must be a non-empty string after trimming whitespace
2. Must be ≤ 16 characters (after trimming)
3. Must not contain ASCII control characters (`\x00–\x1f`, `\x7f`) — this rejects embedded newlines (`\n`), carriage returns (`\r`), tabs (`\t`), null bytes, and similar characters that could be used to forge multi-line display

## REST endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ status, timestamp, uptime, activeGroups }` |
| `GET` | `/api/groups/:code` | None | Returns group existence and member count. Rate-limited to 60 requests/minute per IP. Returns 429 when exceeded. |

### `/api/groups/:code` response shapes

Found (200):
```json
{ "exists": true, "memberCount": 3, "createdAt": 1234567890123 }
```

Not found (404):
```json
{ "exists": false, "error": { "code": "GROUP_NOT_FOUND", "message": "Group not found", "status": 404 } }
```

Rate limited (429):
```json
{ "error": "Too many requests" }
```

## Member object shape

`members-update` delivers an array of serialised member objects. **Host status is not included** — clients determine who is host by comparing `socketId` to the `hostSocketId` received in `join-confirmed` (and updated via `host-changed` events).

```js
{
  socketId,   // string
  name,       // string (1–16 chars, no control characters)
  icon,       // string (emoji from the allowed set of 20)
  lat,        // number | null  — null until first location-update
  lng,        // number | null  — null until first location-update
  active,     // boolean — false if no location ping for >10s
}
```

Internal server fields (`lastSeen`, `lastLocationSeen`) are never included in this payload.

## Allowed icons

The 20 allowed emoji, in order:

🦊 🐻 🐼 🐨 🦁 🐯 🦝 🐺 🦄 🐸 🐙 🦋 🌵 🌈 ⚡ 🔥 💎 🚀 🎸 🏔️
