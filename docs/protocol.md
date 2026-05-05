# Socket Protocol

All real-time communication uses Socket.IO over WebSocket. There is no REST API for group operations — only the health and group-info endpoints are HTTP.

## Client → Server events

| Event | Payload | Description |
|---|---|---|
| `create-group` | `{ name, icon }` | Create a new group |
| `join-group` | `{ code, name, icon }` | Join an existing group by code |
| `location-update` | `{ lat, lng }` | Send current GPS position |
| `leave-group` | — | Voluntarily leave the group |
| `remove-member` | `{ targetSocketId }` | Host only: remove another member |
| `end-group` | — | Host only: end the group for everyone |

## Server → Client events

| Event | Recipients | Payload | Description |
|---|---|---|---|
| `group-created` | creator | `{ code, socketId, status: 201 }` | Group created successfully |
| `join-confirmed` | joiner | `{ code, socketId, hostSocketId, status: 200 }` | Joined successfully |
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
| `INVALID_NAME` | 400 | Empty, whitespace-only, or >16 character name |
| `INVALID_ICON` | 400 | Icon not in the allowed set |
| `CODE_REQUIRED` | 400 | `join-group` sent with no code |
| `GROUP_NOT_FOUND` | 404 | Code does not match any active group |
| `GROUP_FULL` | 400 | Group has reached the 20-member limit |
| `RATE_LIMITED` | 429 | IP has exceeded the create or join rate limit |
| `SERVER_ERROR` | 500 | Could not generate a unique group code |

## REST endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{ status, timestamp, uptime, activeGroups }` |
| `GET` | `/api/groups/:code` | Returns group existence and member count for a code |

## Member object shape

`members-update` delivers an array of serialised member objects:

```js
{
  socketId,   // string
  name,       // string (1–16 chars)
  icon,       // string (emoji from allowed set)
  lat,        // number | null
  lng,        // number | null
  active,     // boolean — false if no ping for >10s
  isHost      // boolean — added by buildMemberList()
}
```
