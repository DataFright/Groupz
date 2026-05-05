# Benchmarks & Capacity

## Load test tool

`server/scripts/load-test.js` runs sustained location-update traffic against a live server. It creates groups and members in batches, then has every socket emit a location update every 1.1 seconds (just above the server's 1/s rate limit so every update is accepted and triggers a broadcast). Latency is measured round-trip from emit to receiving the resulting `members-update` back.

```bash
# Start a container with rate limits removed for testing
docker run -d --name groupz-load -p 3099:3001 \
  -e RATE_LIMIT_CREATE=10000 \
  -e RATE_LIMIT_JOIN=100000 \
  groupz-server

# Default run (10 groups × 5 members, 30 s)
cd server && npm run test:load

# Custom
LOAD_GROUPS=50 LOAD_MEMBERS=10 LOAD_DURATION=60 npm run test:load

# Against live Render (respect production rate limits)
LOAD_TEST_URL=https://groupz-j717.onrender.com LOAD_GROUPS=5 npm run test:load

# Tear down when done
docker stop groupz-load && docker rm groupz-load
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `LOAD_TEST_URL` | `http://127.0.0.1:3099` | Target server |
| `LOAD_GROUPS` | `10` | Number of groups to create |
| `LOAD_MEMBERS` | `5` | Members per group (max 20) |
| `LOAD_DURATION` | `30` | Test duration in seconds |

---

## Results

All tests run against a single Docker container on a local development machine (Windows 10).

| Groups | Members | Total connections | Broadcasts/s | p50 latency | p95 latency | Errors | Notes |
|---|---|---|---|---|---|---|---|
| 10 | 5 | 50 | 216 | 1 ms | 2 ms | 0 | Baseline — well within comfort zone |
| 25 | 10 | 195 | 1,598 | 2 ms | 3 ms | 0 | Comfortable |
| 2,000 | 4 | 8,000 | 20,621 | 513 ms | 1,018 ms | 0 | CPU saturated, stable — no drops |
| 3,000 | 6 | 18,000 | — | — | — | — | Exceeded single-container connection limit |

**Key observation:** The server at 2,000 × 4 processed 20,621 broadcasts per second with zero dropped connections or errors. Latency climbed to ~500ms because the event loop was fully saturated — every CPU cycle was spent serialising and sending. In production, groups are never all simultaneously active, so this scenario doesn't represent real usage.

---

## Estimated capacity — current deployment

"Simultaneously active" means every member in every group is sending location updates at that exact second — the worst-case scenario. Real road trip usage is typically 5–10% of registered groups active at any given moment.

| Render tier | Simultaneously active groups | Simultaneous users | Total connected groups |
|---|---|---|---|
| Free (current, shared CPU) | ~200–300 | ~1,000–1,500 | ~2,000–3,000 |
| Starter $7/mo (dedicated CPU) | ~400–600 | ~2,000–3,000 | ~3,000–5,000 |
| Standard $25/mo (2 GB RAM) | ~1,500–2,000 | ~7,500–10,000 | ~15,000–20,000 |

**What limits us:** CPU, not memory. Each accepted location update triggers `io.to(code).emit('members-update', ...)` which serialises the full member list and pushes it to every socket in the room — up to 20 sends per update. The Node.js event loop saturates before RAM becomes a concern.

**Real-world headroom:** For a road trip app with 2–4 hour active sessions spread across the day, the Render free tier comfortably supports thousands of groups created per day and hundreds of simultaneous users. The Starter $7/mo tier (dedicated CPU, no 15-minute spin-down cold starts) is the recommended production minimum.

---

## Scaling beyond a single instance

The current architecture is a single Node.js process with in-memory state. Horizontal scaling requires:

1. **`@socket.io/redis-adapter`** — shares Socket.IO rooms across multiple processes so a broadcast on instance A reaches sockets connected to instance B
2. **Multiple server replicas** — behind a load balancer with sticky sessions (WebSocket connections must stay on the same instance)
3. **Redis instance** — Render, Railway, and most cloud providers offer managed Redis

The `Dockerfile` and `createApp()` factory need no changes for this — it's purely an infrastructure addition.
