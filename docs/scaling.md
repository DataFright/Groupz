# Scaling Reference

Personal notes — not committed to the repo. Current as of June 2026.

---

## Contents

1. [Where the bottleneck is](#1-where-the-bottleneck-is)
2. [Load test results](#2-load-test-results)
3. [Render — web service tiers](#3-render--web-service-tiers)
4. [Render Redis](#4-render-redis)
5. [Vercel — frontend tiers](#5-vercel--frontend-tiers)
6. [Socket.IO scaling](#6-socketio-scaling)
7. [Google Cloud](#7-google-cloud)
8. [AWS](#8-aws)
9. [Provider comparison](#9-provider-comparison)
10. [Domain names](#10-domain-names)
11. [Cost stacks at every level](#11-cost-stacks-at-every-level)
12. [Decision flowchart](#12-decision-flowchart)
13. [Code space reference](#13-code-space-reference)

---

## 1. Where the bottleneck is

**Vercel (frontend) is never the bottleneck.** It serves a pre-built static bundle from a
global CDN. Once the browser loads the JS bundle, Vercel is done — it has no further
involvement in the session. Free tier handles millions of page loads per day.

**Render (backend) is the bottleneck.** Every Socket.IO connection, every location update
fan-out, all in-memory group state lives here. Scaling Groupz means scaling Render.

**The limiting resource is CPU, not RAM.** Each accepted location update triggers
`io.to(code).emit('members-update', ...)` which serialises the full member list and pushes
it to every socket in the room (up to 20 sends per update). A group of 10 users each
pinging once per second = 100 broadcasts per second from that group alone. The Node.js
event loop saturates long before memory does.

```
What runs where:

  User's phone                Vercel (CDN)              Render (server)
  ┌────────────┐              ┌──────────┐              ┌─────────────────┐
  │ Browser    │──page load──►│ static   │              │ Socket.IO       │
  │ (React app)│◄─────bundle─-│ bundle   │              │ Express         │
  │            │              └──────────┘              │ in-memory state │
  │            │◄──────────── WebSocket ───────────────►│                 │
  └────────────┘                                        └─────────────────┘
                              (Vercel done here)          (all the work)
```

---

## 2. Load test results

Tested against a single Docker container on a local Windows 10 machine.
All members emit a location update every 1.1 s (just above the 1/s server rate limit so
every update is accepted and triggers a broadcast). Latency = round-trip from emit to
receiving the resulting `members-update` back.

| Groups | Members/group | Total sockets | Broadcasts/s | p50 latency | p95 latency | Errors |
|--------|--------------|---------------|--------------|-------------|-------------|--------|
| 10     | 5            | 50            | 216          | 1 ms        | 2 ms        | 0      |
| 25     | 10           | 250           | ~1,600       | 2 ms        | 3 ms        | 0      |
| 2,000  | 4            | 8,000         | 20,621       | 513 ms      | 1,018 ms    | 0      |
| 3,000  | 6            | 18,000        | —            | —           | —           | container limit hit |

```
Broadcasts/s vs. total connections
25,000 |                                         *
       |
20,000 |                                    *
       |
15,000 |
       |
10,000 |
       |
 5,000 |                   *
       |
     0 |   *    *
       +----+----+----+----+----+----+----+----+--->
           50  250  500 1k  2k  4k  6k  8k  10k
                        Total sockets
```

```
p95 latency vs. total connections (single instance)
1,200 ms |                                         *
         |
1,000 ms |                                    *
         |
  800 ms |
         |
  600 ms |
         |
  400 ms |
         |
  200 ms |
         |
    5 ms |   *    *    *    *
         +----+----+----+----+----+----+----+----+--->
             50  250  500 1k  2k  4k  6k  8k  10k
                          Total sockets
(flat until ~4k–5k connections, then climbs sharply — event loop is saturated)
```

---

## 3. Render — web service tiers

No code changes needed to move between these tiers. Just change the plan in the dashboard.

| Tier    | Cost    | CPU                 | RAM    | Cold starts        | Practical ceiling         |
|---------|---------|---------------------|--------|--------------------|--------------------------|
| Free    | $0      | Shared, throttled   | 512 MB | 15 min spin-down   | ~200–300 active groups    |
| Starter | $7/mo   | 0.5 vCPU dedicated  | 512 MB | None               | ~400–600 active groups    |
| Standard| $25/mo  | 1 vCPU dedicated    | 2 GB   | None               | ~1,500–2,000 active groups|
| Pro     | $85/mo  | 2 vCPU dedicated    | 4 GB   | None               | ~4,000–5,000 active groups|

"Simultaneously active" = every member in every group sending location updates right now.
Real road trip usage is ~5–10% of connected groups active at any moment, so registered
user capacity is ~10–20× the numbers above.

```
Active group ceiling vs. monthly cost (Render, single instance)

5,000 |                                             Pro ●
      |
4,000 |
      |
3,000 |
      |
2,000 |                              Standard ●
      |
1,000 |
      |
  600 |               Starter ●
      |
  300 | Free ●
      +-----+-----+-----+-----+-----+-----+-----+-----+--->
        $0   $7   $15   $25   $40   $55   $70   $85  $100
                          Monthly cost
```

**Best value move: Free → Starter ($7/mo).** Eliminates the 15-minute cold-start
spin-down. That's the biggest UX pain point — groups shouldn't die mid-trip because no
one joined for 15 minutes. This upgrade needs no code changes and costs less than a coffee.

**When to go Standard ($25):** You notice latency climbing under normal usage, or you
consistently have 300+ groups simultaneously active.

**When to go Pro ($85):** You've tried Standard and it's not enough. Genuinely 1,000+
simultaneous active groups. At this point the Redis adapter conversation also makes sense.

### Render bandwidth

All paid tiers include 100 GB/mo bandwidth free, then $0.10/GB. For a WebSocket app,
location updates are tiny (~100 bytes per message). Even 10,000 connected users pinging
every second for a month is roughly 10,000 × 100B × 86,400s × 30 = ~2.6 TB. Bandwidth
costs only matter at serious scale and are secondary to CPU.

### Render health checks and auto-restart

Render pings your `/health` endpoint every 30 seconds on paid tiers. If it fails
3 consecutive times, Render restarts the service automatically. This is already wired up
in the app and is free.

---

## 4. Render Redis

Redis is required when you run **more than one server instance**. Without it, Socket.IO
rooms are per-process — a broadcast on instance A does not reach clients on instance B.

The code change is ~15 lines adding `@socket.io/redis-adapter` to `app.js`. The
`createApp()` factory and Dockerfile need no other changes.

| Tier     | Cost    | Memory  | Persistence          | When to use |
|----------|---------|---------|----------------------|-------------|
| Free     | $0      | 25 MB   | None (evicts on full)| Testing only — data lost on restart |
| Starter  | $10/mo  | 100 MB  | AOF (on-disk)        | 2–3 server instances |
| Standard | $25/mo  | 1 GB    | AOF + RDB snapshots  | 4–8 instances, serious traffic |
| Pro      | $50/mo  | 4 GB    | Full persistence     | Large-scale multi-instance |

For Socket.IO adapter use, Redis memory usage is very low — it's just pub/sub channels,
not storing group state. Starter Redis ($10) comfortably handles dozens of server
instances. The Standard tier ($25) is unlikely to be needed until you have 10+ instances.

**When Redis is NOT needed:** Any single-instance setup. On Free, Starter, Standard, or
Pro tiers with one server — skip Redis entirely.

```
Multi-instance topology with Render Redis:

  ┌─────────────────────────────────────────────────────┐
  │                  Render Load Balancer                │
  │              (sticky sessions, built in)             │
  └───────────────────────┬─────────────────────────────┘
              ┌───────────┴───────────┐
       ┌──────▼──────┐         ┌──────▼──────┐
       │ Server A    │         │ Server B    │
       │ Node.js     │         │ Node.js     │
       │ socket.io   │         │ socket.io   │
       └──────┬──────┘         └──────┬──────┘
              └───────────┬───────────┘
                   ┌──────▼──────┐
                   │ Render Redis │  ($10–25/mo)
                   │  pub/sub     │
                   └─────────────┘
```

### Multi-instance cost on Render

| Config              | Monthly cost | Active group ceiling |
|---------------------|-------------|----------------------|
| 2× Standard + Redis | ~$60/mo     | ~4,000–6,000         |
| 3× Standard + Redis | ~$85/mo     | ~6,000–9,000         |
| 2× Pro + Redis      | ~$180/mo    | ~10,000–12,000       |

---

## 5. Vercel — frontend tiers

Vercel is almost certainly never a constraint for Groupz. It serves a static bundle.

| Tier       | Cost            | Bandwidth  | Function timeout | Custom domains | When needed |
|------------|-----------------|------------|------------------|----------------|-------------|
| Hobby      | $0              | 100 GB/mo  | 10 s             | Yes (free)     | Always sufficient for Groupz |
| Pro        | $20/mo per seat | 1 TB/mo    | 300 s            | Yes            | If adding slow API routes or need team access |
| Enterprise | Custom          | Unlimited  | Custom           | Yes            | Not relevant |

**Groupz will likely never need Vercel Pro.** The app has no Vercel serverless functions —
it's a pure static Vite build. Bandwidth: even at 1 million page loads/mo, the bundle
is ~200 KB → 200 GB — still within free tier.

**When you'd upgrade to Pro:**
- Adding Vercel serverless API routes that need >10s runtime
- Needing team collaboration (multiple developers on the Vercel project)
- Password-protecting preview deployments

**Custom domains on Hobby:** Vercel lets you add custom domains for free on the Hobby
tier. Buy the domain elsewhere, add a CNAME record pointing to Vercel, and they
auto-provision an SSL cert. No charge from Vercel.

---

## 6. Socket.IO scaling

Socket.IO itself is free and open source (MIT). There is no "Socket.IO Cloud" — it's
always self-hosted. The only scaling costs are the infrastructure you run it on.

### The Redis adapter

`@socket.io/redis-adapter` is what allows multiple server instances to share rooms.
Each server connects to a shared Redis instance and uses Redis pub/sub to relay broadcasts.

```
Without adapter (wrong):               With adapter (correct):

  Client A ──► Instance 1              Client A ──► Instance 1 ──► Redis ──► Instance 2
  Client B ──► Instance 2                                                         │
                                        Client B ──◄─────────────────────────────┘
  A broadcasts → B never sees it       A broadcasts → Redis relays → B sees it
```

**When it's needed:** The moment you have 2+ server instances. Single instance = no Redis
adapter needed, ever.

**Cost:** Only the Redis instance. The npm package itself is free.

### Socket.IO Admin UI

Free self-hosted dashboard showing live connections, rooms, and traffic. Run as a
separate Express route or a standalone process. Useful for debugging at scale but not
required. No cost beyond the compute to run it.

### Scaling Socket.IO beyond Redis

For extreme scale (50k+ concurrent connections), the Redis pub/sub model can itself
become a bottleneck. Options at that point:

- **`@socket.io/redis-streams-adapter`**: Uses Redis Streams instead of pub/sub —
  more durable, better for very high message rates
- **`@socket.io/cluster-adapter`**: For Node.js cluster mode (multiple processes on
  one machine, sharing memory via IPC) — no Redis needed but limited to one machine
- **Horizontal with sticky sessions**: Always required for WebSockets regardless of
  adapter — a client's connection must stay pinned to one instance

For Groupz at any foreseeable scale, the standard Redis adapter on Starter Redis is
all that's ever needed.

---

## 7. Google Cloud

GCP is a viable path if you're already in the Google ecosystem or want Cloud Run's
auto-scaling model. Pricing is slightly more complex than Render but competitive with AWS.

### Cloud Run (containers, serverless)

Cloud Run runs Docker containers and scales to zero. The catch for WebSocket apps:
**persistent connections need min-instances > 0** or every cold start drops open sockets.

| Config                    | Monthly cost (est.) | Notes |
|---------------------------|---------------------|-------|
| 1 instance (min=1), 1 vCPU, 512 MB | ~$15–20/mo | Comparable to Render Starter |
| 2 instances, 1 vCPU, 2 GB | ~$40–50/mo | Comparable to Render Standard×2 |
| Auto-scales 1–5, burst capacity | ~$20–80/mo | Depends on traffic |

Cloud Run pricing: $0.000024/vCPU-second, $0.0000025/GB-second, $0.40/million requests.
At 1 vCPU × 1 month always-on ≈ 2.6M seconds × $0.000024 = ~$62 raw, but min-instances
billing is capped — usually comes out cheaper with real usage patterns.

**WebSocket support:** Yes, Cloud Run supports WebSockets since 2021 with HTTP/2. Session
affinity (sticky routing) is available but requires configuration.

### Compute Engine (VMs, like EC2)

Most direct comparison to Render or EC2. You manage the VM yourself.

| Instance type  | vCPU | RAM  | Monthly cost | Render equivalent |
|----------------|------|------|-------------|-------------------|
| e2-micro       | 0.25 shared | 1 GB  | ~$7/mo    | Render Starter    |
| e2-small       | 0.5 shared  | 2 GB  | ~$14/mo   | Between Starter/Standard |
| e2-medium      | 1 shared    | 4 GB  | ~$27/mo   | Render Standard   |
| e2-standard-2  | 2 dedicated | 8 GB  | ~$67/mo   | Render Pro        |
| n2-standard-2  | 2 dedicated | 8 GB  | ~$75/mo   | Above Render Pro  |

**Spot/preemptible VMs:** 60–90% cheaper, but can be terminated with 30-second notice.
Not suitable for a persistent WebSocket server — connections drop on preemption.

### Memorystore (managed Redis)

GCP's managed Redis. More expensive than Render Redis.

| Tier         | Memory | Cost/mo | Notes |
|--------------|--------|---------|-------|
| Basic, 1 GB  | 1 GB   | ~$35/mo | No replication, no failover |
| Standard, 1 GB | 1 GB | ~$70/mo | With replication and failover |

At the scale where GCP makes sense, you'd use Standard tier. Compared to Render Redis
Starter ($10), Memorystore is significantly more expensive — factor this in.

### Cloud Load Balancing

Required for multi-instance. ~$18/mo base (forwarding rule + rule processing) plus
$0.008/GB traffic. WebSocket connections are supported natively.

### GCP multi-instance cost breakdown

| Component              | Cost/mo |
|------------------------|---------|
| 2× e2-medium           | $54     |
| Cloud Load Balancing   | $18     |
| Memorystore Redis (Basic 1 GB) | $35 |
| Container Registry     | ~$1     |
| Data transfer          | ~$5     |
| **Total**              | **~$113** |

### When to consider GCP

- You want Cloud Run's auto-scaling model (scale to zero during off-hours)
- You're already using Google Workspace / Firebase and want one billing account
- You want Graviton-equivalent ARM compute (Google Tau T2A instances, ~40% better
  price/perf than x86 for well-optimised workloads)
- You want global Anycast load balancing for users on different continents

---

## 8. AWS

### Single instance

| Option         | Monthly cost | CPU   | RAM   | Notes |
|----------------|-------------|-------|-------|-------|
| EC2 t3.micro   | ~$8–10/mo   | 2 vCPU burst | 1 GB | Comparable to Render Starter |
| EC2 t3.small   | ~$15–18/mo  | 2 vCPU burst | 2 GB | Between Render Starter/Standard |
| EC2 t3.medium  | ~$30–33/mo  | 2 vCPU burst | 4 GB | Comparable to Render Standard |
| EC2 t3.large   | ~$60–65/mo  | 2 vCPU burst | 8 GB | Comparable to Render Pro |
| ECS Fargate    | ~$15–20/mo  | 0.25 vCPU   | 0.5 GB | Managed containers, no EC2 admin |

t3 instances have burstable CPU — they accumulate credits when idle and spend them under
load. Good for Groupz's bursty broadcast pattern. Run out of credits → throttled back to
baseline (roughly 20% of 2 vCPU).

### Multi-instance on AWS

| Component                     | Cost/mo |
|-------------------------------|---------|
| 2× EC2 t3.medium              | $62     |
| ALB (Application Load Balancer) | $22   |
| ElastiCache Redis t3.micro    | $15     |
| ECR container registry        | $1      |
| Data transfer                 | ~$5     |
| **Total**                     | **~$105** |

ALB supports WebSocket sticky sessions (stickiness duration configurable). Required for
Socket.IO — a client's socket must stay on the same instance.

### When AWS makes sense

1. You're already in AWS for other services (RDS, Cognito, S3) — operational overhead
   amortises across the system
2. You want Graviton (ARM) instances (m7g/t4g): ~20% better price/perf than x86
3. You need compliance features: VPC isolation, CloudTrail audit logs, AWS Shield
4. You're operating at the scale (100k+ daily active users) where the engineering
   investment in AWS operations pays back

For Groupz at current scale: the AWS overhead isn't worth it. Render wins on simplicity.

---

## 9. Provider comparison

### Side-by-side: single instance, equivalent compute

| Feature                | Render Standard | AWS EC2 t3.medium | GCP e2-medium | Fly.io (shared-cpu-2x) |
|------------------------|-----------------|-------------------|---------------|------------------------|
| Monthly cost           | $25             | ~$30–33           | ~$27          | ~$14                   |
| vCPU                   | 1 dedicated     | 2 burst           | 1 shared      | 2 shared               |
| RAM                    | 2 GB            | 4 GB              | 4 GB          | 512 MB                 |
| Cold starts            | None            | None (always on)  | None          | ~2s if dormant         |
| Git deploy             | Yes (auto)      | Manual / CodeDeploy | Cloud Build / manual | Fly deploy CLI |
| WebSocket              | Yes             | Yes (SG rules)    | Yes           | Yes                    |
| Managed Redis          | Yes ($10+)      | ElastiCache ($15+) | Memorystore ($35+) | Upstash ($0–15+) |
| Ops complexity         | Very low        | Medium            | Medium        | Low                    |
| Docker support         | Yes (Dockerfile) | Yes (ECR/ECS)   | Yes (Artifact Registry) | Yes (native) |

### Side-by-side: managed Redis

| Provider         | Free tier | $10/mo tier | $25/mo tier | Notes |
|------------------|-----------|-------------|-------------|-------|
| Render Redis     | 25 MB     | 100 MB      | 1 GB        | Best value if already on Render |
| AWS ElastiCache  | None      | —           | t3.micro cache.t3.micro ~$15 | No free tier |
| GCP Memorystore  | None      | —           | 1 GB Basic ~$35 | Most expensive |
| Upstash          | 10k req/day | Pay-as-you-go | ~$10 reserved | Redis-compatible, serverless |
| Redis Cloud (Redis Ltd) | 30 MB | 100 MB ($7) | 250 MB ($15) | Most flexible, provider-agnostic |

**Upstash** is worth noting for Socket.IO adapter use: it's serverless Redis, charges
per request. For a small number of instances it can be cheaper than managed Redis, and
it works with any hosting provider — useful if you ever mix providers.

### Cost vs. ceiling — all providers

```
Active group ceiling vs. monthly cost

12,000 |                                   AWS ASG ●  GCP multi ●
       |
10,000 |
       |
 8,000 |
       |
 6,000 |            Render multi ●
       |
 5,000 |                    Render Pro ●         AWS t3.large ●
       |
 4,000 |
       |
 3,000 |
       |
 2,000 |        Render Std ●    AWS t3.med ●  GCP e2-med ●
       |
 1,000 |
       |
  600  |  Render Starter ●
       |   Fly.io shared ●
  300  | Render Free ●
       +------+------+------+------+------+------+------+---->
          $0    $25    $50    $75   $100   $125   $150   $200
                           Monthly cost

  Render: ●   AWS: ●   GCP: ●   Fly.io: ●
```

**Verdict:**
- **$0–$60/mo → Render.** Simplest ops, best value, zero infrastructure management.
- **$60–$150/mo → Render multi-instance with Redis.** Still no infra to manage.
- **$150+/mo → Re-evaluate.** At this spend, AWS or GCP start making sense if you need
  more control, compliance, or are bundling with other services.

---

## 10. Domain names

A custom domain is a one-time decision. You buy it from a registrar, then point DNS
records to Render (backend) and Vercel (frontend). Both auto-provision SSL for free.

### Registrar comparison

| Registrar     | .com/yr  | .io/yr  | .app/yr | WHOIS privacy | Free DNS | Notes |
|---------------|---------|---------|---------|---------------|----------|-------|
| **Cloudflare** | $8.95  | $25.00  | $11.00  | Free          | Yes      | At-cost (no markup). Best pick. |
| Porkbun       | ~$9.50  | ~$22.00 | ~$12.00 | Free          | Yes      | Often cheapest, clean UI |
| Namecheap     | ~$10.98 | ~$28.00 | ~$13.00 | Free          | Yes      | Reliable, competitive |
| Google / Squarespace | $12.00 | $30.00 | $14.00 | Free    | Yes      | Clean, slightly pricier |
| Vercel Domains | ~$20.00 | ~$40.00 | ~$20.00 | Free         | Yes      | Convenient but expensive |
| GoDaddy       | $12–20  | $30–60  | $15–30  | Paid ($3–10+) | Yes      | Aggressive upselling, avoid |

**Recommendation: Cloudflare Registrar.** At-cost pricing (they charge you exactly what
ICANN charges them, no markup). You also get Cloudflare's free DDoS protection, CDN
proxy, and DNS management as a bonus. Best deal in the industry.

### What you get with a domain + Cloudflare DNS (free)

- **DDoS protection**: Cloudflare's network absorbs volumetric attacks automatically
- **CDN proxy**: Static assets cached at 300+ edge locations (less relevant since you're
  already on Vercel CDN, but adds a layer)
- **Free SSL**: Both Render and Vercel auto-provision Let's Encrypt certs regardless —
  you don't need Cloudflare for this
- **DNS management**: Fast propagation, DNSSEC, free
- **Analytics**: Basic request counts, no PII (no data collection)

### Setting up a custom domain for Groupz

```
Domain: groupz.app (example)

DNS records:
  groupz.app          → CNAME  cname.vercel-dns.com   (frontend)
  api.groupz.app      → CNAME  [your-render-slug].onrender.com  (backend)
```

Steps:
1. Buy domain at Cloudflare (or any registrar, then transfer DNS to Cloudflare)
2. In Vercel: Project → Domains → Add `groupz.app` → Vercel shows you the CNAME
3. In Render: Service → Custom Domains → Add `api.groupz.app` → Render shows you the CNAME
4. In Cloudflare DNS: add both CNAME records (set to "DNS only" / grey cloud, not proxied,
   for the Render backend — proxied mode breaks WebSocket long-polling fallback)
5. SSL auto-provisions within minutes on both sides

**Important:** Set the Render CNAME to **DNS only** (not Cloudflare proxied). Cloudflare
proxy terminates WebSocket connections after 100 seconds of inactivity. For the Vercel
frontend, proxied is fine.

### Domain cost per year

| TLD   | Annual cost (Cloudflare) | Notes |
|-------|--------------------------|-------|
| .com  | ~$9–10                  | Most trusted, best for any market |
| .app  | ~$11                    | Modern, Google-owned TLD, HTTPS forced |
| .io   | ~$25                    | Popular for tech apps, pricier |
| .co   | ~$10                    | Common alternative to .com |
| .xyz  | ~$1–3 (first yr promo)  | Cheap but less trusted |

For a road trip / group coordination app: `.app` or `.com` are the best fits.

---

## 11. Cost stacks at every level

### Level 0 — Free (current)

| Service                | Monthly | Annual  |
|------------------------|---------|---------|
| Render Free            | $0      | $0      |
| Vercel Hobby           | $0      | $0      |
| Domain (optional)      | $0.83   | $10     |
| **Total**              | **$0–$1** | **$0–$10** |

**What you get:** Cold starts after 15 min inactivity. Up to ~200–300 active groups. No
custom domain.
**Pain point:** Cold starts mid-trip are unacceptable UX. This is the only problem at
this tier.

---

### Level 1 — Small production (~$8/mo)

| Service                | Monthly | Annual  |
|------------------------|---------|---------|
| Render Starter         | $7      | $84     |
| Vercel Hobby           | $0      | $0      |
| Domain (.com)          | $0.83   | $10     |
| **Total**              | **~$8** | **~$94** |

**What you get:** No cold starts. Custom domain. SSL included. Up to ~400–600 active
groups. Zero code changes from current. This is the **recommended first upgrade**.

---

### Level 2 — Growth (~$26/mo)

| Service                | Monthly | Annual  |
|------------------------|---------|---------|
| Render Standard        | $25     | $300    |
| Vercel Hobby           | $0      | $0      |
| Domain (.com)          | $0.83   | $10     |
| **Total**              | **~$26** | **~$310** |

**What you get:** 1 vCPU / 2 GB RAM. Up to ~1,500–2,000 active groups. Still no code
changes. Comfortable headroom for thousands of users per day.

---

### Level 3 — Scaling (~$61/mo)

Requires code change: add `@socket.io/redis-adapter` (~15 lines in `app.js`).

| Service                | Monthly | Annual  |
|------------------------|---------|---------|
| 2× Render Standard     | $50     | $600    |
| Render Redis Starter   | $10     | $120    |
| Vercel Hobby           | $0      | $0      |
| Domain (.com)          | $0.83   | $10     |
| **Total**              | **~$61** | **~$730** |

**What you get:** 2× the compute, shared rooms via Redis. Up to ~4,000–6,000 active
groups. Still fully on Render — no new platforms to learn.

---

### Level 4 — Serious scale (~$120/mo)

| Service                | Monthly | Annual  |
|------------------------|---------|---------|
| 3× Render Standard     | $75     | $900    |
| Render Redis Standard  | $25     | $300    |
| Vercel Hobby           | $0      | $0      |
| Domain (.com)          | $0.83   | $10     |
| **Total**              | **~$101** | **~$1,210** |

**What you get:** Up to ~6,000–9,000 active groups. Redis with persistence and replication.
Still zero platform migration.

---

### Level 5 — AWS or GCP entry (~$110–120/mo)

At this spend, migrating to AWS or GCP starts making sense if you want more control.
Requires significant infrastructure setup (VPC, load balancer, autoscaling, CI/CD pipeline
to ECR/Artifact Registry).

**AWS option:**
| Service                | Monthly |
|------------------------|---------|
| 2× EC2 t3.large        | $124    |
| ALB                    | $22     |
| ElastiCache Redis      | $15     |
| ECR                    | $1      |
| Data transfer          | $5      |
| Vercel Hobby           | $0      |
| Domain                 | $0.83   |
| **Total**              | **~$168** |

**GCP option:**
| Service                | Monthly |
|------------------------|---------|
| 2× e2-standard-2       | $134    |
| Cloud Load Balancing   | $18     |
| Memorystore Redis 1 GB | $35     |
| Artifact Registry      | $1      |
| Data transfer          | $5      |
| Vercel Hobby           | $0      |
| Domain                 | $0.83   |
| **Total**              | **~$194** |

Active group ceiling at this level: **8,000–12,000** simultaneously active.

---

### Level 6 — Enterprise / serious infrastructure (~$300+/mo)

At this point you're running Kubernetes (EKS on AWS or GKE on GCP), auto-scaling node
groups, Redis Cluster, and dedicated DevOps. This is not a near-term concern for Groupz.

```
Monthly cost summary across all levels:

$200 |                                      AWS ●  GCP ●
     |
$150 |
     |
$120 |                        Render L4 ●
     |
$100 |
     |
 $80 |
     |
 $60 |               Render L3 ●
     |
 $40 |
     |
 $26 |       Render L2 ●
     |
  $8 | Render L1 ●
     |
  $0 | L0 ●
     +---+---+---+---+---+---+---+---+---+---+--> scale
         0  1   2   3   4   5   6   7   8   (×1000 active groups)
```

---

## 12. Decision flowchart

```
START: Cold starts are hurting UX?
  │
  ▼ Yes
  Render Starter ($7/mo) ────────────────────────────── No code change
  │
  ▼ After growth: hitting CPU limits under normal load?
  Render Standard ($25/mo) ──────────────────────────── No code change
  │
  ▼ After growth: 1,000+ simultaneous active groups?
  Add Redis adapter (~15 lines) + 2× Standard ($60/mo) ─ One code change
  │
  ▼ After growth: 5,000+ simultaneous active groups?
  Add 3rd instance → 3× Standard + Redis ($101/mo)
  │
  ▼ After growth: need more control or bundling services?
  ┌─────────────────────┐     ┌─────────────────────┐
  │ AWS                 │     │ GCP                 │
  │ Best ecosystem      │     │ Best for Cloud Run  │
  │ integration, most   │     │ auto-scale, or if   │
  │ hiring pool         │     │ already in Google   │
  └─────────────────────┘     └─────────────────────┘
  │
  ▼ At any point: want a custom domain?
  Buy .com or .app at Cloudflare (~$9–11/yr) ────────── DNS-only for Render backend
```

---

## 13. Code space reference

Group codes are 6 uppercase hex characters (0–9, A–F) → **16,777,216 unique codes**.

`generateCode()` tries 10 random draws before returning null (→ `SERVER_ERROR`).
Code exhaustion only becomes a 0.01% failure risk at ~6.7 million simultaneous active
groups. Server memory and CPU will fail orders of magnitude before code space is a concern.

Groups expire after 16 hours (hard limit) or 24 hours idle. In steady state, the number
of live group codes is bounded by the creation rate × average session length, not by the
absolute code space.


NOTES:
https://domains.cloudflare.com/
grpfest.com
$10.46 // Renews at $10.46    (a year)