# Testing

Three test layers cover the full stack. All must pass before merging.

## 1. Server — Vitest (113 tests)

Located in `server/tests/`. Tests use the `createApp()` factory directly — each suite spins up its own server on a random port and tears it down after. No shared state between suites.

```bash
cd server && npm test
```

| File | Tests | What it covers |
|---|---|---|
| `unit.test.js` | 24 | Pure helper functions: `validateInput`, `generateCode`, `buildMemberList`, `makeError`, all error codes |
| `smoke.test.js` | 5 | Server starts cleanly, health endpoint responds, socket connects and disconnects, unknown events ignored |
| `function.test.js` | 38 | Each socket event handler in isolation with a single client: `create-group`, `join-group` (including `GROUP_FULL` and `RATE_LIMITED`), `location-update`, `leave-group`, `remove-member`, `end-group`, REST API |
| `integration.test.js` | 11 | Multi-client flows: full create→join→location session, host transfer, group lifecycle, simultaneous location updates, `remove-member` cascade |
| `scenarios.test.js` | 26 | Four real-world membership shapes: single user, multiple users in one group, multiple groups one user each, multiple groups multiple users each — including isolation and cross-contamination checks |
| `cleanup.test.js` | 9 | Inactivity auto-remove, host transfer on idle host, hard 16-hour age limit (group-ended emitted, group deleted, `socketToGroup` cleaned up, all members notified) |

## 2. Client — Vitest (43 tests)

Located in `client/src/tests/`. Uses React Testing Library with a mocked `socket.io-client` singleton.

```bash
cd client && npm test
```

| File | What it covers |
|---|---|
| `smoke.test.jsx` | App mounts without crashing |
| `unit/Home.test.jsx` | Rendering, tab switching, validation, socket interaction, `GROUP_FULL` and `RATE_LIMITED` error display, socket disconnect on error |
| `unit/IconPicker.test.jsx` | Icon grid renders, selection state, onChange callback |
| `integration/AppFlow.test.jsx` | Mocked socket flow: create group, join group, error handling |

## 3. End-to-end — Cypress 13 in Chrome (75 tests)

Located in `client/cypress/e2e/`. Requires both servers running. Uses Chrome headless.

```bash
cd client && npm run e2e       # headless (CI)
cd client && npm run cy:open   # interactive

# Against production (validate before pushing)
cd client && CYPRESS_BACKEND_URL=https://groupz-j717.onrender.com npx cypress run --config baseUrl=https://groupz-seven.vercel.app
```

| Spec | Tests | What it covers |
|---|---|---|
| `00-warmup.cy.js` | 1 | Wakes the Render free-tier backend before any other spec runs; handles both cold-start (connection error) and warm paths; waits 30 s either way |
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

## Cypress HTML reports (mochawesome)

The reporter is configured in `cypress.config.cjs`. Every run — local or CI — generates one JSON file per spec in `cypress/results/`. In CI these are merged into a single `combined.html` and uploaded as the `cypress-report` artifact on the GitHub Actions run.

```bash
# Merge and generate manually after a local run
cd client
npx mochawesome-merge 'cypress/reports/mochawesome*.json' -o cypress/reports/report.json
npx marge cypress/reports/report.json --reportDir cypress/reports --inline
# open cypress/reports/report.html
```

`client/cypress/reports/` is gitignored — reports are CI artifacts only.

## Cypress task infrastructure

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
| `fillGroupWithMembers` | Joins N members in parallel — used to fill a group to capacity |
