import http from 'http'
import { io } from 'socket.io-client'

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL     = process.env.LOAD_TEST_URL || 'http://127.0.0.1:3099'
const NUM_GROUPS   = parseInt(process.env.LOAD_GROUPS   ?? '10')
const MEMBERS_PER  = parseInt(process.env.LOAD_MEMBERS  ?? '5')   // includes host
const DURATION_MS  = parseInt(process.env.LOAD_DURATION ?? '30') * 1_000
const UPDATE_MS    = 1_100   // just above the server's 1/s rate limit

// Small bounding box (Paris area) — cycles through valid coordinates
const BASE_LAT = 48.8566
const BASE_LNG = 2.3522

// ── Helpers ───────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')))
  })
}

function socketConnect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false })
    const t = setTimeout(() => { socket.disconnect(); reject(new Error('connect timeout')) }, 10_000)
    socket.once('connect',       () => { clearTimeout(t); resolve(socket) })
    socket.once('connect_error', err => { clearTimeout(t); reject(err) })
  })
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function fmt(n)  { return n.toLocaleString() }
function fms(n)  { return `${Math.round(n)} ms` }
function fps(n, d) { return `${(n / (d / 1_000)).toFixed(1)}/s` }

// ── Phase 1: Setup ────────────────────────────────────────────────────────────
async function setup() {
  const setupStart = Date.now()
  console.log(`\nConnecting to ${BASE_URL}…`)

  // Verify server is reachable
  try {
    const h = await httpGet(`${BASE_URL}/health`)
    if (h.status !== 'ok') throw new Error('unhealthy')
  } catch (e) {
    console.error(`Server not reachable at ${BASE_URL}: ${e.message}`)
    console.error('Start the container first:')
    console.error('  docker run -d --name groupz-load -p 3099:3001 groupz-server-smoke')
    process.exit(1)
  }

  console.log(`Creating ${NUM_GROUPS} groups × ${MEMBERS_PER} members (${NUM_GROUPS * MEMBERS_PER} total connections)…`)

  const allSockets = []
  const groups = []   // [{ code, sockets: [...] }]
  let setupErrors = 0

  // Process an array of async tasks in chunks to avoid flooding the server
  async function batchRun(tasks, size = 50) {
    for (let i = 0; i < tasks.length; i += size) {
      const results = await Promise.allSettled(tasks.slice(i, i + size).map(fn => fn()))
      for (const r of results) {
        if (r.status === 'rejected') setupErrors++
        else if (r.value) {
          const { socket, code, joinSocket, group } = r.value
          if (socket && code) {
            allSockets.push(socket)
            groups.push({ code, sockets: [socket] })
          }
          if (joinSocket && group) {
            group.sockets.push(joinSocket)
            allSockets.push(joinSocket)
          }
        }
      }
    }
  }

  // Create host sockets in batches of 50
  await batchRun(
    Array.from({ length: NUM_GROUPS }, (_, i) => async () => {
      const socket = await socketConnect(BASE_URL)
      const code = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('create-group timeout')), 8_000)
        socket.once('group-created', ({ code }) => { clearTimeout(t); resolve(code) })
        socket.emit('create-group', { name: `Host${i}`, icon: '🦊' })
      })
      return { socket, code }
    })
  )

  // Join members in batches of 100
  const joinTasks = groups.flatMap(group =>
    Array.from({ length: MEMBERS_PER - 1 }, (_, i) => async () => {
      const joinSocket = await socketConnect(BASE_URL)
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('join-group timeout')), 8_000)
        joinSocket.once('join-confirmed', () => { clearTimeout(t); resolve() })
        joinSocket.once('join-error', ({ message }) => { clearTimeout(t); reject(new Error(message)) })
        joinSocket.emit('join-group', { code: group.code, name: `M${i}`, icon: '🐸' })
      })
      return { joinSocket, group }
    })
  )
  await batchRun(joinTasks, 100)

  const setupMs = Date.now() - setupStart
  const totalConns = allSockets.length
  console.log(`Setup: ${totalConns} connections in ${(setupMs / 1000).toFixed(1)} s${setupErrors ? ` (${setupErrors} errors)` : ''}\n`)

  return { groups, allSockets }
}

// ── Phase 2: Sustained load ───────────────────────────────────────────────────
async function runLoad(groups, allSockets) {
  let sent = 0
  let received = 0
  let errors = 0
  const latencySamples = []
  let peakGroups = 0
  const timers = []

  console.log(`Running load for ${DURATION_MS / 1000} s…`)
  const loadStart = Date.now()

  // Poll /health every 5 s
  const healthTimer = setInterval(async () => {
    try {
      const h = await httpGet(`${BASE_URL}/health`)
      if (h.activeGroups > peakGroups) peakGroups = h.activeGroups
    } catch { /* ignore */ }
  }, 5_000)

  // Each socket sends location-update every UPDATE_MS
  for (let g = 0; g < groups.length; g++) {
    const { sockets } = groups[g]
    for (let m = 0; m < sockets.length; m++) {
      const socket = sockets[m]
      let pendingSendTime = null

      // Listen for broadcasts to count received and measure latency
      socket.on('members-update', () => {
        received++
        if (pendingSendTime !== null) {
          latencySamples.push(Date.now() - pendingSendTime)
          pendingSendTime = null
        }
      })

      socket.on('disconnect', () => { errors++ })
      socket.on('error',      () => { errors++ })

      // Stagger start slightly so all sockets don't fire simultaneously
      const stagger = Math.floor((g * MEMBERS_PER + m) * (UPDATE_MS / (NUM_GROUPS * MEMBERS_PER)))
      const t = setTimeout(() => {
        const interval = setInterval(() => {
          if (Date.now() - loadStart >= DURATION_MS) { clearInterval(interval); return }
          const lat = BASE_LAT + (Math.random() - 0.5) * 0.01
          const lng = BASE_LNG + (Math.random() - 0.5) * 0.01
          pendingSendTime = Date.now()
          socket.emit('location-update', { lat, lng })
          sent++
        }, UPDATE_MS)
        timers.push(interval)
      }, stagger)
      timers.push(t)
    }
  }

  // Wait for duration
  await new Promise(r => setTimeout(r, DURATION_MS + 200))

  clearInterval(healthTimer)
  timers.forEach(t => clearInterval(t))

  const elapsed = Date.now() - loadStart

  return { sent, received, errors, latencySamples, peakGroups, elapsed }
}

// ── Phase 3: Report ───────────────────────────────────────────────────────────
function printReport(cfg, setupConns, results) {
  const { sent, received, errors, latencySamples, peakGroups, elapsed } = results
  const sorted = [...latencySamples].sort((a, b) => a - b)
  const p50  = percentile(sorted, 50)
  const p95  = percentile(sorted, 95)
  const pmax = sorted[sorted.length - 1] ?? 0

  const bar = '━'.repeat(46)
  console.log(`\nLoad test: ${cfg.groups} groups × ${cfg.members} members — ${cfg.duration} s`)
  console.log(bar)
  console.log(`Setup:          ${setupConns} connections`)
  console.log(`Updates sent:   ${fmt(sent)} (${fps(sent, elapsed)})`)
  console.log(`Broadcasts rcv: ${fmt(received)} (${fps(received, elapsed)})`)
  if (sorted.length > 0) {
    console.log(`Latency:        p50 ${fms(p50)}  p95 ${fms(p95)}  max ${fms(pmax)}  (${fmt(sorted.length)} samples)`)
  }
  console.log(`Errors:         ${errors}`)
  console.log(`Active groups:  ${peakGroups} (peak from /health)`)
  console.log(bar)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = { groups: NUM_GROUPS, members: MEMBERS_PER, duration: DURATION_MS / 1000 }

  const { groups, allSockets } = await setup()

  const results = await runLoad(groups, allSockets)

  console.log('Disconnecting all sockets…')
  allSockets.forEach(s => s.disconnect())

  printReport(cfg, allSockets.length, results)
}

main().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
