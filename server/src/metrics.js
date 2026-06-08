import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const isTest = process.env.NODE_ENV === 'test'
const __dir = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(__dir, '..', 'logs')
const LOG_FILE = join(LOG_DIR, 'value-verifier.jsonl')
const CT_TZ = 'America/Chicago'

if (!isTest && !existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

const BOT_UA = /bot|crawler|spider|scraper|curl|wget|python|go-http|libwww|httpclient|okhttp|node-fetch|got\//i

function fingerprint(ip, ua) {
  return createHash('sha256').update(`${ip}:::${ua}`).digest('hex').slice(0, 12)
}

function botLikelihood(ua) {
  if (!ua) return 8
  if (BOT_UA.test(ua)) return 9
  if (!ua.includes('Mozilla')) return 5
  return 0
}

// ── Central Time helpers ──────────────────────────────────────────────────────

function ctDate(ts) {
  // Returns YYYY-MM-DD in CT
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts))
}

function ctTime(ts) {
  // Returns e.g. "5:58 PM"
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: CT_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function ctHour(ts) {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }).format(new Date(ts)),
    10
  )
}

// ── IP geolocation (ip-api.com, free, no key needed) ─────────────────────────

const geoCache = new Map()

async function lookupGeo(ip) {
  if (geoCache.has(ip)) return geoCache.get(ip)
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country`)
    if (!res.ok) return null
    const d = await res.json()
    if (d.status !== 'success') return null
    const geo = { city: d.city, region: d.regionName, country: d.country }
    geoCache.set(ip, geo)
    return geo
  } catch {
    return null
  }
}

// ── Session tracking ──────────────────────────────────────────────────────────

const pending = new Map()

export function sessionStart(socket) {
  if (isTest) return
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim()
    || socket.handshake.address
  const ua = socket.handshake.headers['user-agent'] || ''
  const now = Date.now()
  pending.set(socket.id, {
    sessionId: socket.id,
    ip,
    fingerprint: fingerprint(ip, ua),
    userAgent: ua,
    botLikelihood: botLikelihood(ua),
    connectedAt: now,
    dateCt: ctDate(now),
    timeCt: ctTime(now),
    hourCt: ctHour(now),
    action: null,
    groupCode: null,
    memberName: null,
    icon: null,
    gpsShared: false,
    gpsUpdates: 0,
  })
}

export function sessionAction(socketId, action, { code, name, icon, memberCount } = {}) {
  if (isTest) return
  const s = pending.get(socketId)
  if (s) Object.assign(s, { action, groupCode: code, memberName: name, icon, memberCount: memberCount ?? null })
}

export function sessionGps(socketId) {
  if (isTest) return
  const s = pending.get(socketId)
  if (!s) return
  s.gpsUpdates++
  s.gpsShared = true
}

export async function sessionEnd(socketId) {
  if (isTest) return
  const s = pending.get(socketId)
  if (!s) return
  pending.delete(socketId)
  const now = Date.now()

  const geo = await lookupGeo(s.ip)

  const record = {
    ...s,
    ...(geo ?? {}),
    connectedAt: new Date(s.connectedAt).toISOString(),
    disconnectedAt: new Date(now).toISOString(),
    durationSeconds: Math.round((now - s.connectedAt) / 1000),
  }

  // stdout so Render's log viewer retains sessions across deploys
  console.log(JSON.stringify({ event: 'session', ...record }))

  try {
    appendFileSync(LOG_FILE, JSON.stringify(record) + '\n')
  } catch { /* non-critical */ }
}

// ── Summary ───────────────────────────────────────────────────────────────────

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
    timezone: CT_TZ,
    totalRecordsOnDisk: records.length,
    last24h:  buildWindow(within(1),  1),
    last7d:   buildWindow(within(7),  7),
    last30d:  buildWindow(within(30), 30),
  }
}

function buildWindow(records, days) {
  if (!records.length) return { windowDays: days, totalSessions: 0, byDate: {} }

  // Aggregate totals
  const uniqueIps = new Set()
  const uniqueFp  = new Set()
  const fpCounts  = {}
  let bots = 0, gps = 0, creates = 0, joins = 0, noAction = 0, totalDur = 0
  const durations = []

  for (const r of records) {
    uniqueIps.add(r.ip)
    uniqueFp.add(r.fingerprint)
    fpCounts[r.fingerprint] = (fpCounts[r.fingerprint] || 0) + 1
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

  // Group sessions by CT date
  const grouped = {}
  for (const r of records) {
    const date = r.dateCt || ctDate(r.connectedAt)
    if (!grouped[date]) grouped[date] = []
    grouped[date].push(r)
  }

  const byDate = {}
  for (const [date, sessions] of Object.entries(grouped)) {
    const dateBots = sessions.filter(s => s.botLikelihood >= 5).length
    byDate[date] = {
      date,
      dayOfWeek: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
      totalSessions: sessions.length,
      suspectedBots: dateBots,
      likelyHumans: sessions.length - dateBots,
      sessions: sessions
        .sort((a, b) => new Date(a.connectedAt) - new Date(b.connectedAt))
        .map(r => ({
          timeCt:        r.timeCt || ctTime(r.connectedAt),
          name:          r.memberName || null,
          ip:            r.ip,
          location:      [r.city, r.region, r.country].filter(Boolean).join(', ') || 'Unknown',
          action:        r.action,
          groupCode:     r.groupCode || null,
          memberCount:   r.memberCount ?? null,
          gpsShared:     r.gpsShared,
          gpsUpdates:    r.gpsUpdates,
          durationSeconds: r.durationSeconds,
          duration:      fmt(r.durationSeconds),
          botLikelihood: r.botLikelihood,
          isBot:         r.botLikelihood >= 5,
        })),
    }
  }

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
    byDate,
  }
}

function pct(n, total) { return `${Math.round((n / total) * 100)}%` }
function fmt(s) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), sec = s % 60
  if (m < 60) return `${m}m ${sec}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
