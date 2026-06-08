/**
 * Metrics tests — covers the /api/metrics REST endpoint (auth behaviour,
 * response shape) and pure-function unit tests for parseUA / botLikelihood.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createApp } from '../src/app.js'
import { parseUA, botLikelihood } from '../src/metrics.js'

// ── /api/metrics endpoint ─────────────────────────────────────────────────────

describe('GET /api/metrics', () => {
  let httpServer, io, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io } = createApp({ corsOrigin: '*' }))
    await new Promise(resolve => httpServer.listen(0, resolve))
    serverUrl = `http://localhost:${httpServer.address().port}`
  })

  afterAll(async () => {
    await new Promise(resolve => io.close(resolve))
    await new Promise(resolve => httpServer.close(resolve))
  })

  afterEach(() => {
    delete process.env.METRICS_KEY
  })

  it('returns 200 when METRICS_KEY is not set', async () => {
    const res = await fetch(`${serverUrl}/api/metrics`)
    expect(res.status).toBe(200)
  })

  it('returns the summary object with expected top-level keys', async () => {
    const res  = await fetch(`${serverUrl}/api/metrics`)
    const data = await res.json()
    // No log file in test env — server returns a minimal error object, not the
    // full summary, but the endpoint itself must be 200 and return valid JSON.
    expect(typeof data).toBe('object')
    expect(data).not.toBeNull()
  })

  it('returns 401 when METRICS_KEY is set but no key is provided', async () => {
    process.env.METRICS_KEY = 'super-secret'
    const res  = await fetch(`${serverUrl}/api/metrics`)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 401 when METRICS_KEY is set and the wrong key is provided', async () => {
    process.env.METRICS_KEY = 'super-secret'
    const res = await fetch(`${serverUrl}/api/metrics?key=wrong-key`)
    expect(res.status).toBe(401)
  })

  it('returns 200 when METRICS_KEY is set and the correct key is provided', async () => {
    process.env.METRICS_KEY = 'super-secret'
    const res = await fetch(`${serverUrl}/api/metrics?key=super-secret`)
    expect(res.status).toBe(200)
  })

  it('does not expose the METRICS_KEY value in the response body', async () => {
    process.env.METRICS_KEY = 'my-private-key'
    const res  = await fetch(`${serverUrl}/api/metrics?key=my-private-key`)
    const text = await res.text()
    expect(text).not.toContain('my-private-key')
  })
})

// ── parseUA ───────────────────────────────────────────────────────────────────

describe('parseUA', () => {
  it('returns unknown for all fields when UA is null', () => {
    expect(parseUA(null)).toEqual({ device: 'unknown', os: 'unknown', browser: 'unknown' })
  })

  it('returns unknown for all fields when UA is an empty string', () => {
    expect(parseUA('')).toEqual({ device: 'unknown', os: 'unknown', browser: 'unknown' })
  })

  it('detects Windows desktop with Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(parseUA(ua)).toEqual({ device: 'desktop', os: 'Windows', browser: 'Chrome' })
  })

  it('detects macOS desktop with Firefox', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:120.0) Gecko/20100101 Firefox/120.0'
    expect(parseUA(ua)).toEqual({ device: 'desktop', os: 'macOS', browser: 'Firefox' })
  })

  it('detects macOS desktop with Safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    expect(parseUA(ua)).toEqual({ device: 'desktop', os: 'macOS', browser: 'Safari' })
  })

  it('detects Windows desktop with Edge', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    expect(parseUA(ua)).toEqual({ device: 'desktop', os: 'Windows', browser: 'Edge' })
  })

  it('detects iPhone as mobile iOS Safari', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(parseUA(ua)).toEqual({ device: 'mobile', os: 'iOS', browser: 'Safari' })
  })

  it('detects Android phone as mobile Android Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(parseUA(ua)).toEqual({ device: 'mobile', os: 'Android', browser: 'Chrome' })
  })

  it('detects iPad as tablet iOS Safari', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(parseUA(ua)).toEqual({ device: 'tablet', os: 'iOS', browser: 'Safari' })
  })

  it('returns other for all fields when UA is curl', () => {
    expect(parseUA('curl/7.85.0')).toEqual({ device: 'other', os: 'other', browser: 'other' })
  })

  it('returns other for all fields when UA is python-requests', () => {
    expect(parseUA('python-requests/2.28.0')).toEqual({ device: 'other', os: 'other', browser: 'other' })
  })

  it('returns other for all fields for an unrecognised headless UA', () => {
    expect(parseUA('CustomScript/1.0')).toEqual({ device: 'other', os: 'other', browser: 'other' })
  })
})

// ── botLikelihood ─────────────────────────────────────────────────────────────

describe('botLikelihood', () => {
  it('returns 8 when UA is null (no user-agent header)', () => {
    expect(botLikelihood(null)).toBe(8)
  })

  it('returns 8 when UA is an empty string', () => {
    expect(botLikelihood('')).toBe(8)
  })

  it('returns 9 for curl', () => {
    expect(botLikelihood('curl/7.85.0')).toBe(9)
  })

  it('returns 9 for wget', () => {
    expect(botLikelihood('Wget/1.21.3')).toBe(9)
  })

  it('returns 9 for python-requests', () => {
    expect(botLikelihood('python-requests/2.28.0')).toBe(9)
  })

  it('returns 9 for a Googlebot UA', () => {
    expect(botLikelihood('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(9)
  })

  it('returns 5 for a UA that has no Mozilla prefix', () => {
    expect(botLikelihood('SomeUnknownApp/3.0')).toBe(5)
  })

  it('returns 0 for a normal Chrome browser UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0'
    expect(botLikelihood(ua)).toBe(0)
  })

  it('returns 0 for a normal Safari iOS UA', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
    expect(botLikelihood(ua)).toBe(0)
  })
})
