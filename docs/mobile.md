# Mobile Experience

## The screen-lock problem

On mobile browsers, locking the phone screen (or pressing the power button, or switching apps) causes the OS to suspend the browser process. When this happens:

- The WebSocket heartbeat fails
- The server's `disconnect` event fires immediately
- The member is removed from the group server-side

Without any mitigation, the user unlocks their phone and finds themselves on the home screen with a "Connection lost" message — they have to manually rejoin and re-enter the code. For a caravan or road-trip app this is a significant friction point, since passengers naturally lock their screens between glances.

## How Groupz handles it

Instead of going home on every unexpected disconnect, the app enters a **reconnecting state**.

### What the user sees

1. Screen locks → brief connection drop
2. Screen unlocks → an amber **"Reconnecting…"** banner appears at the top of the map
3. Within a second or two the socket reconnects and the app automatically rejoins the group
4. The banner disappears and the map resumes — group intact, no manual steps

If reconnection takes longer (poor signal), the banner stays visible while retries continue. The group code, name, and icon are preserved across the reconnect so the user always gets back into the same session.

### What happens server-side

The server removes the member on disconnect (standard behaviour). When the client reconnects and re-emits `join-group`, the server treats it as a normal join: the member appears in the group again under a new socket ID. Other members in the group see a brief gap in the member list and then see them return.

The server's zombie-socket cleanup threshold is 3 minutes. This is the safety net for sockets that are technically still connected but have stopped sending heartbeats — it does not affect the reconnect flow, which relies on a clean disconnect/reconnect cycle.

---

## Reconnect flow in detail

### Client side (`App.jsx` + `socket.js`)

**Socket.IO configuration** (`client/src/socket.js`):
```
reconnection: true
reconnectionAttempts: 10
reconnectionDelay: 1500 ms
reconnectionDelayMax: 8000 ms
timeout: 10000 ms
```

**On unexpected disconnect** (`onDisconnect`):
- If the user is currently on the map, store the current group info in a ref (`pendingRejoinRef`) and set `isReconnecting = true`
- If the user is on the home screen, show a generic "Connection lost" notification instead (nothing to rejoin)

**On reconnect** (`onConnect`):
- If `pendingRejoinRef` holds group info, clear it and emit `join-group` with the stored code, name, and icon
- The server responds with `join-confirmed` as if it were a new join

**On rejoin confirmed** (`onReconnectConfirmed`):
- Update `groupInfo.mySocketId` to the new socket ID
- Clear `isReconnecting` — the banner disappears

**Page Visibility API** (`onVisibilityChange`):
- When `document.visibilityState` changes to `'visible'` (screen unlock), if the socket is disconnected and a pending rejoin exists, call `socket.connect()` immediately rather than waiting for the next auto-retry tick

### Server side

No special reconnect handling is needed. The server processes the new `join-group` event normally — if the code is still valid, the member is added back. The previous socket entry was already cleaned up on disconnect.

---

## Edge cases

| Scenario | Outcome |
|---|---|
| Screen locked briefly, group has other members | Seamless rejoin — amber banner flashes and disappears |
| Screen locked, user was the sole member | Group deleted while offline → `GROUP_NOT_FOUND` on rejoin → home with "Your group ended while you were away" |
| All 10 reconnect attempts fail (no signal) | `reconnect_failed` event → home with "Could not reconnect. Please rejoin the group." |
| User intentionally leaves before reconnect completes | `leave-group` → `io client disconnect` reason → no reconnect attempted |
| Host removed the user while offline | Rejoin attempt gets `join-error` → home with "Could not rejoin the group." |
| User force-quits the browser | Socket closes, member removed from group — same as any other disconnect. No reconnect because the page is gone. |

---

## Limitations

**Reconnect window**
The reconnect window is limited by how long the group stays alive without the user. If the user was the only member, the group is deleted as soon as they disconnect — they cannot reconnect to it. If there are other members, the group persists and reconnect works.

**Signal loss**
If the device has no network signal at all (e.g. out of coverage, airplane mode), all 10 reconnect attempts will fail. The app goes home after ~45 seconds of retrying (sum of 10 back-off intervals). When signal returns, the user has to rejoin manually.

**PWA does not help**
Wrapping Groupz as a Progressive Web App (home screen install + service worker) does not grant background JavaScript execution. iOS Safari and Android Chrome both suspend background tabs regardless of PWA status. The WebSocket would still drop on screen lock.

**Native app would solve this permanently**
A native mobile app built with Capacitor or React Native can access the OS background location API, which keeps the location service running even when the screen is off. This would prevent the disconnect from happening in the first place. Building a native wrapper is a significant undertaking and is not currently planned.

---

## Testing the reconnect flow manually

1. Open Groupz on your phone browser
2. Create or join a group with at least one other member
3. Lock the phone screen for 5–10 seconds
4. Unlock the screen
5. You should see the amber "Reconnecting…" banner for a moment, then return to the live map

If you are the only member, lock the screen for 5+ seconds, then unlock. You should see "Your group ended while you were away" and be returned to the home screen.
