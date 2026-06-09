# Mobile Experience

## The screen-lock problem

On mobile browsers, locking the phone screen (or pressing the power button, or switching apps) causes the OS to suspend the browser process. When this happens:

- The WebSocket heartbeat fails
- The server's `disconnect` event fires immediately
- The member is removed from the group server-side

Without any mitigation, the user unlocks their phone and finds themselves on the home screen with a "Connection lost" message — they have to manually rejoin and re-enter the code. For a caravan or road-trip app this is a significant friction point, since passengers naturally lock their screens between glances.

---

## Wake lock: keeping the screen on

Groupz uses the **Screen Wake Lock API** to request that the device keep the display on while the map is active. This prevents the screen from sleeping in the first place, so the disconnect never happens in most real-world use cases.

### How it works

- When the user joins or creates a group and the map mounts, Groupz calls `navigator.wakeLock.request('screen')`
- The OS honours the request and keeps the display on
- When the user returns to the app after a screen lock/unlock cycle, the wake lock is automatically re-acquired (the lock is released by the browser on screen-off and re-requested when the page becomes visible again)
- When the user leaves or ends the group, the wake lock is released

### Browser support

| Browser | Wake lock support |
|---|---|
| Chrome / Edge (desktop + Android) | 84+ (2020) |
| Safari iOS | 16.4+ (2023) |
| Firefox | 126+ (2024) |

On older or unsupported browsers the wake lock silently does nothing — the app still works normally, and the reconnect flow described below remains the fallback.

**Note:** Low-power mode (iOS) and some Android power-saving settings can override the wake lock and let the screen sleep anyway. Wake lock is best-effort, not a guarantee.

---

## Reconnect flow: the fallback for when the screen does lock

Even with wake lock, some users will see a screen-off event (low battery mode, manual lock, permissions denied). Instead of dropping the user to the home screen, the app enters a **reconnecting state**.

### What the user sees

1. Screen locks → brief connection drop
2. Screen unlocks → an amber **"Reconnecting…"** banner appears at the top of the map
3. Within a second or two the socket reconnects and the app automatically rejoins the group
4. The banner disappears and the map resumes — group intact, no manual steps

If reconnection takes longer (poor signal), the banner stays visible while retries continue. The group code, name, and icon are preserved across the reconnect so the user always gets back into the same session.

### What happens server-side

When a member disconnects, the server removes them from the group. When the client reconnects and re-emits `join-group`, the server rejoins them normally.

For the case where the disconnecting member is the **last member** in the group:

- On disconnect, the server sets `group.emptyAt` to the current timestamp and keeps the group alive
- The cleanup interval (runs every 60 s) skips groups whose `emptyAt` is within the past 3 minutes
- If the member reconnects within **3 minutes**, they are rejoined as host (`isRejoin` flag). `emptyAt` is cleared
- If 3 minutes pass without a reconnect, the group is deleted on the next cleanup tick

Voluntary leaves (`leave-group` event) delete the group immediately regardless — no grace period is needed since the user explicitly chose to leave.

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

### Wake lock (`GroupMap.jsx`)

A second `visibilitychange` listener in GroupMap re-acquires the wake lock when the page becomes visible. This runs independently from App.jsx's reconnect listener — both coexist on the same event without conflict.

---

## Edge cases

| Scenario | Outcome |
|---|---|
| Screen locked briefly, group has other members | Seamless rejoin — amber banner flashes and disappears |
| Screen locked, user was the sole member | Group kept alive for 3 minutes (`emptyAt` grace period). User reconnects as host within that window |
| Sole member does not reconnect within 3 minutes | Group deleted → `GROUP_NOT_FOUND` on rejoin → home with "Your group ended while you were away" |
| All 10 reconnect attempts fail (no signal) | `reconnect_failed` event → home with "Could not reconnect. Please rejoin the group." |
| User intentionally leaves before reconnect completes | `leave-group` → `io client disconnect` reason → no reconnect attempted |
| Host removed the user while offline | Rejoin attempt gets `join-error` → home with "Could not rejoin the group." |
| User force-quits the browser | Socket closes, member removed from group — same as any other disconnect. No reconnect because the page is gone. |

---

## Limitations

**Wake lock and power-saving**
Wake lock is best-effort. iOS low-power mode and some Android battery optimisations can override it. In those cases the reconnect flow activates instead.

**Reconnect window for solo users**
If the user was the only member and they are offline for more than 3 minutes, the group is deleted. The 3-minute window covers nearly all real-world screen-lock durations (phone stayed in pocket, checked an app, etc.).

**Signal loss**
If the device has no network signal at all (e.g. out of coverage, airplane mode), all 10 reconnect attempts will fail. The app goes home after ~45 seconds of retrying (sum of 10 back-off intervals). When signal returns, the user has to rejoin manually.

**PWA does not help**
Wrapping Groupz as a Progressive Web App (home screen install + service worker) does not grant background JavaScript execution. iOS Safari and Android Chrome both suspend background tabs regardless of PWA status. The WebSocket would still drop on screen lock.

**Native app would solve this permanently**
A native mobile app built with Capacitor or React Native can access the OS background location API, which keeps the location service running even when the screen is off. This would prevent the disconnect from happening in the first place. Building a native wrapper is a significant undertaking and is not currently planned.

---

## Testing manually

### Wake lock test

1. Open Groupz on your phone in Chrome or Safari iOS 16.4+
2. Create or join a group
3. Leave your phone idle on the map screen — the screen should stay on indefinitely
4. Lock the screen manually, then unlock immediately
5. The screen should stay on again after unlocking (wake lock re-acquired)
6. Leave the group — the normal screen timeout resumes

### Reconnect flow test

**With other members:**
1. Open Groupz on your phone
2. Create or join a group with at least one other member
3. Lock the phone screen for 5–10 seconds
4. Unlock the screen
5. You should see the amber "Reconnecting…" banner for a moment, then return to the live map

**As sole member (3-minute grace period):**
1. Create a group alone
2. Lock the screen for under 3 minutes, then unlock
3. The amber banner should appear and then disappear as you rejoin as host
4. Optionally, lock the screen for over 3 minutes — you should see "Your group ended while you were away"
