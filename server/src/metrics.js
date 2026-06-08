import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const isTest = process.env.NODE_ENV === 'test'
const __dir = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(__dir, '..', 'logs')
const LOG_FILE = join(LOG_DIR, 'value-verifier.jsonl')

if (!isTest && !existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

// User-agent patterns strongly associated with bots or automated tools
const BOT_UA = /bot|crawler|spider|scraper|curl|wget|python|go-http|libwww|httpclient|okhttp|node-fetch|got\//i

function fingerprint(ip, ua) {
  return createHash('sha256').update(`${ip}:::${ua}`).digest('hex').slice(0, 12)
}

function botLikelihood(ua) {
  if (!ua) return 8                  // no UA → almost certainly automated
  if (BOT_UA.test(ua)) return 9      // known bot/tool signature
  if (!ua.includes('Mozilla')) return 5  // non-browser UA
  return 0
}

// Pending sessions keyed by socket ID — flushed to disk on disconnect
const pending = new Map()

export function sessionStart(socket) {
  if (isTest) return
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim()
    || socket.handshake.address
  const ua = socket.handshake.headers['user-agent'] || ''
  const now = Date.now()
  const ts = new Date(now)
  pending.set(socket.id, {
    sessionId: socket.id,
    ip,
    fingerprint: fingerprint(ip, ua),
    userAgent: ua,
    botLikelihood: botLikelihood(ua),
    connectedAt: now,
    date: ts.toISOString().slice(0, 10),
    hourUtc: ts.getUTCHours(),
    action: null,        // 'create' | 'join' | null (null = probed but never joined)
    groupCode: null,
    memberName: null,
    icon: null,
    gpsShared: false,
    gpsUpdates: 0,
  })
}

export function sessionAction(socketId, action, { code, name, icon } = {}) {
  if (isTest) return
  const s = pending.get(socketId)
  if (s) Object.assign(s, { action, groupCode: code, memberName: name, icon })
}

export function sessionGps(socketId) {
  if (isTest) return
  const s = pending.get(socketId)
  if (!s) return
  s.gpsUpdates++
  s.gpsShared = true
}

export function sessionEnd(socketId) {
  if (isTest) return
  const s = pending.get(socketId)
  if (!s) return
  pending.delete(socketId)
  const now = Date.now()
  try {
    appendFileSync(LOG_FILE, JSON.stringify({
      ...s,
      connectedAt: new Date(s.connectedAt).toISOString(),
      disconnectedAt: new Date(now).toISOString(),
      durationSeconds: Math.round((now - s.connectedAt) / 1000),
    }) + '\n')
  } catch { /* non-critical — never crash the server over a log write */ }
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function getSummary() {
  let lines
  try {
    lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
  } catch {
    return { error: 'No sessions logged yet' }
  }
  const records = lines.flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const now = Date.now()
  const within = days => records.filter(r => now - new Date(r.connectedAt).getTime() <= days * 86_400_000)
  return {
    generatedAt: new Date().toISOString(),
    totalRecordsOnDisk: records.length,
    last24h:  aggregate(within(1),  1),
    last7d:   aggregate(within(7),  7),
    last30d:  aggregate(within(30), 30),
  }
}

function aggregate(records, days) {
  if (!records.length) return { windowDays: days, totalSessions: 0 }

  const uniqueIps  = new Set(records.map(r => r.ip))
  const uniqueFp   = new Set(records.map(r => r.fingerprint))
  const fpCounts   = {}
  const ipCounts   = {}
  const hourly     = Array(24).fill(0)
  const daily      = {}
  let bots = 0, gps = 0, creates = 0, joins = 0, noAction = 0, totalDur = 0
  const durations  = []

  for (const r of records) {
    fpCounts[r.fingerprint] = (fpCounts[r.fingerprint] || 0) + 1
    ipCounts[r.ip]          = (ipCounts[r.ip] || 0) + 1
    hourly[r.hourUtc]++
    daily[r.date] = (daily[r.date] || 0) + 1
    if (r.botLikelihood >= 5) bots++
    if (r.gpsShared) gps++
    if      (r.action === 'create') creates++
    else if (r.action === 'join')   joins++
    else                            noAction++
    totalDur += r.durationSeconds
    durations.push(r.durationSeconds)
  }

  durations.sort((a, b) => a - b)
  const avg = Math.round(totalDur / records.length)
  const med = durations[Math.floor(durations.length / 2)]

  const topIps = Object.entries(ipCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([ip, sessions]) => ({ ip, sessions }))

  return {
    windowDays: days,
    totalSessions: records.length,
    uniqueIps: uniqueIps.size,
    uniqueFingerprints: uniqueFp.size,
    returningVisitors: Object.values(fpCounts).filter(c => c > 1).length,
    suspectedBots: bots,
    likelyHumans: records.length - bots,
    actions: { create: creates, join: joins, noGroupAction: noAction },
    gpsShared: { count: gps, rate: pct(gps, records.length) },
    duration: { avgSeconds: avg, medianSeconds: med, avg: fmt(avg), median: fmt(med) },
    hourlyDistribution: hourly.map((sessions, hour) => ({ hour, sessions })),
    dailyDistribution: daily,
    topIps,
  }
}

function pct(n, total) { return `${Math.round((n / total) * 100)}%` }
function fmt(s) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), sec = s % 60
  if (m < 60) return `${m}m ${sec}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
