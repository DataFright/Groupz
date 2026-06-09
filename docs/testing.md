# Testing

Three test layers cover the full stack. All must pass before merging.

## 1. Server — Vitest (164 tests)

Located in `server/tests/`. Tests use the `createApp()` factory directly — each suite spins up its own server on a random port and tears it down after. No shared state between suites.

```bash
cd server && npm test
```

| File | Tests | What it covers |
|---|---|---|
| `unit.test.js` | 30 | Pure helper functions: `validateInput` (all error branches including control characters), `generateCode` (collisions, null return), `buildMemberList` (shape, null coords, no internal fields leaked), `makeError`, all error codes |
| `smoke.test.js` | 5 | Server starts cleanly, health endpoint responds, group lookup 404, socket connects/disconnects, unknown events silently ignored |
| `metrics.test.js` | 27 | Usage stats API auth (no key, wrong key, correct key), user-agent parsing, bot-likelihood scoring |
| `function.test.js` | 56 | Each socket event handler and REST endpoint in isolation with a single client. Covers: `create-group` (happy path, INVALID_NAME, INVALID_ICON, control-char names, no payload), `join-group` (happy path, GROUP_NOT_FOUND, CODE_REQUIRED, non-string code, missing code, lowercase normalisation, INVALID_NAME), `location-update` (happy path, rate limit, out-of-range, NaN, Infinity, missing field, empty payload, not-in-group), `leave-group` (happy path, not-in-group no-op), `remove-member` (host removes member, non-host blocked, self-removal blocked, already-left silent, no-targetId silent), `end-group` (host ends, non-host blocked, not-in-group no-op, socketToGroup fully cleared), `disconnect` (host disconnect → host-changed, last member → group deleted, non-group no-op, members-update after host disconnect), REST API (`/health`, `/api/groups/:code` 200/404/case-insensitive, group lookup 429 rate limit), group size limit (GROUP_FULL), IP rate limiting (create and join RATE_LIMITED) |
| `integration.test.js` | 11 | Multi-client flows: full create→join→location session, host transfer, group lifecycle (last member leaves, last member disconnects), end-group broadcast, remove-member cascade, simultaneous location updates, re-join with same socket updates name/icon |
| `scenarios.test.js` | 26 | Four real-world group shapes: single user, multiple users one group, multiple groups one user each, multiple groups multiple users each — isolation and cross-contamination checks at each layer |
| `cleanup.test.js` | 9 | Inactivity auto-remove (180s threshold), evicted member receives `removed-from-group`, remaining members receive `members-update`, solo group deleted when last member goes idle, host transfer on idle host, new host can end after transfer, hard age limit (`maxGroupAgeMs`), `socketToGroup` cleanup on age limit, all-members notified on age limit |

## 2. Client — Vitest (60 tests)

Located in `client/src/tests/`. Uses React Testing Library with a mocked `socket.io-client` singleton.

```bash
cd client && npm test
```

| File | Tests | What it covers |
|---|---|---|
| `smoke.test.jsx` | 7 | App mounts without crashing, home screen by default, no map on load, tabs present, name input, submit button, 20 icon options |
| `unit/Home.test.jsx` | 22 | Rendering, tab switching (clears errors), client-side validation (empty name, >16 chars, missing code), socket interaction (connect + emit on submit), auto-uppercase code, loading state, `GROUP_FULL`, `RATE_LIMITED`, `GROUP_NOT_FOUND`, `SERVER_ERROR` error display, socket disconnect on error, re-enables submit after error |
| `unit/IconPicker.test.jsx` | 9 | 20 icons rendered, aria-labels, type="button" to prevent form submission, onChange callback, selected CSS class, only one selected at a time, value prop change, 20-entry ICONS array, uniqueness |
| `integration/AppFlow.test.jsx` | 22 | Mocked socket flow: starts on home, registers/deregisters all listeners, `removed-from-group` and `group-ended` go home with notification and call `socket.disconnect`, `left-group` goes home, `host-changed` marks non-host, create-group navigates to map, `members-update` propagates member count to GroupMap, intentional disconnect skips reconnect, unexpected disconnect stays on map with `isReconnecting=true`, connect-after-disconnect emits `join-group` and clears reconnecting on `join-confirmed`, `reconnect_failed` goes home with notification, `join-error GROUP_NOT_FOUND` during rejoin shows "group ended" message, `join-confirmed` while not rejoining is silently ignored, `join-error` while not rejoining is silently ignored, `visibilitychange` while disconnected triggers `socket.connect` |

## 3. End-to-end — Cypress 13 in Chrome

Located in `client/cypress/e2e/`. Requires both servers running. Uses Chrome headless.

```bash
cd client && npm run e2e       # headless (CI)
cd client && npm run cy:open   # interactive
```

Run against production (used in CI after deploy):
```bash
node scripts/cypress-run.cjs
```

The wrapper script is required when running from VS Code — VS Code sets `ELECTRON_RUN_AS_NODE=1` which crashes Cypress Electron. The wrapper deletes that env var before spawning Cypress.

| Spec | Tests | What it covers |
|---|---|---|
| `home.cy.js` | 7 | Title, subtitle, tabs, name and code inputs, icon picker display |
| `tabs-and-validation.cy.js` | 7 | Tab switching, code auto-uppercase, submit label changes, client-side validation errors |
| `validation-edge-cases.cy.js` | 3 | Whitespace-only name rejected, `maxlength` on name (16) and code (6) inputs |
| `icon-picker.cy.js` | 3 | Default icon selected, clicking changes selection, persists across tab switch |
| `create-group.cy.js` | 7 | Full create flow: map renders, CODE label, 6-char code displayed, End Group button, member count |
| `join-group.cy.js` | 6 | Valid join, non-host sees Leave not End Group, member count, map shows code, error for unknown code, group full error |
| `group-session.cy.js` | 7 | End Group dialog (open, cancel, confirm), Leave dialog (open, cancel, confirm), Members drawer |
| `group-code-copy.cy.js` | 2 | Copy button shows ✓ on click, reverts to ⎘ after 2s |
| `host-transfer.cy.js` | 2 | Non-host gains End Group button after host disconnects, member count updates |
| `member-list-multi.cy.js` | 9 | Host perspective: both members visible, You/HOST badges, remove button, removing drops count. Non-host perspective: no remove buttons, HOST badge, You badge |
| `map-markers.cy.js` | 3 | Own emoji marker appears, own name tooltip appears, second member's marker/tooltip appear when they join with a known location |
| `geo-error.cy.js` | 4 | Banner appears when geolocation denied, includes browser error message, dismissed by ✕ button, absent when geolocation succeeds |
| `recenter-button.cy.js` | 3 | 🎯 FAB is visible, clicking leaves map intact, clicking before first GPS fix resolves silently |
| `scenarios.cy.js` | 11 | Four real-world group shapes at the UI layer: single user, multiple users, multiple groups one user each, multiple groups multiple users each |

## Cypress task infrastructure

`cypress.config.cjs` exposes Node.js tasks that create and manage Socket.IO connections from outside the browser, enabling multi-user scenarios without opening multiple tabs. All task socket timeouts are set to 20 seconds to handle cold Render starts in production e2e runs.

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
| `fillGroupWithMembers` | Joins N members in parallel — used to fill a group to capacity |

## Testing conventions

**Server tests** use `createApp({ corsOrigin: '*', cleanupIntervalMs: 80 })` (short interval for cleanup tests). Every `afterEach` must clear `groups`, `socketToGroup`, `ipCreateLimits`, `ipJoinLimits`, and `ipLookupLimits` to prevent state leaking between tests.

**Client unit tests** mock `../../socket.js` with `vi.mock`. The mock is module-level; wire up implementations in `beforeEach` after importing the mocked module. The `GroupMap` component is also mocked in `AppFlow.test.jsx` to avoid Leaflet DOM dependencies — the mock exposes `data-code`, `data-host`, `data-reconnecting`, and `data-member-count` attributes so tests can assert on state without rendering the full map.

**Cypress** uses `cy.task()` for server-side socket operations (creating groups, filling members) so multi-user scenarios don't need multiple browser tabs. Tasks are defined in `client/cypress.config.cjs`.
