import { describe, it, expect } from 'vitest'
import { validateInput, generateCode, buildMemberList, ALLOWED_ICONS } from '../src/helpers.js'
import { ErrorCode } from '../src/errorCodes.js'

// ─── validateInput ────────────────────────────────────────────────────────────

describe('validateInput', () => {
  it('returns null for a valid name and allowed icon', () => {
    expect(validateInput('Alice', '🦊')).toBeNull()
  })

  it('trims whitespace before checking length', () => {
    expect(validateInput('  Alice  ', '🦊')).toBeNull()
  })

  it('accepts a name of exactly 16 characters', () => {
    expect(validateInput('A'.repeat(16), '🦊')).toBeNull()
  })

  it('returns INVALID_NAME (400) for null name', () => {
    const err = validateInput(null, '🦊')
    expect(err.code).toBe(ErrorCode.INVALID_NAME)
    expect(err.status).toBe(400)
    expect(typeof err.message).toBe('string')
  })

  it('returns INVALID_NAME for empty string name', () => {
    expect(validateInput('', '🦊').code).toBe(ErrorCode.INVALID_NAME)
  })

  it('returns INVALID_NAME for whitespace-only name', () => {
    expect(validateInput('   ', '🦊').code).toBe(ErrorCode.INVALID_NAME)
  })

  it('returns INVALID_NAME for name longer than 16 characters', () => {
    expect(validateInput('A'.repeat(17), '🦊').code).toBe(ErrorCode.INVALID_NAME)
  })

  it('returns INVALID_NAME for non-string name', () => {
    expect(validateInput(42, '🦊').code).toBe(ErrorCode.INVALID_NAME)
  })

  it('returns INVALID_ICON (400) for an icon not in the allowed set', () => {
    const err = validateInput('Alice', '🤠')
    expect(err.code).toBe(ErrorCode.INVALID_ICON)
    expect(err.status).toBe(400)
  })

  it('returns INVALID_ICON for empty icon', () => {
    expect(validateInput('Alice', '').code).toBe(ErrorCode.INVALID_ICON)
  })

  it('returns INVALID_ICON for null icon', () => {
    expect(validateInput('Alice', null).code).toBe(ErrorCode.INVALID_ICON)
  })

  it('accepts every icon in ALLOWED_ICONS', () => {
    for (const icon of ALLOWED_ICONS) {
      expect(validateInput('Alice', icon)).toBeNull()
    }
  })

  it('ALLOWED_ICONS contains exactly 20 entries', () => {
    expect(ALLOWED_ICONS.size).toBe(20)
  })
})

// ─── generateCode ─────────────────────────────────────────────────────────────

describe('generateCode', () => {
  it('returns a 6-character string', () => {
    expect(generateCode({})).toHaveLength(6)
  })

  it('returns an uppercase alphanumeric code', () => {
    const code = generateCode({})
    expect(code).toMatch(/^[A-F0-9]{6}$/)
  })

  it('does not return a code already present in groups', () => {
    const groups = {}
    for (let i = 0; i < 50; i++) {
      const code = generateCode(groups)
      expect(groups[code]).toBeUndefined()
      groups[code] = true
    }
  })

  it('returns null when every attempt collides (all slots occupied)', () => {
    // Proxy makes every property lookup truthy, simulating 100% collision
    const full = new Proxy({}, { get: () => ({}) })
    expect(generateCode(full)).toBeNull()
  })
})

// ─── buildMemberList ──────────────────────────────────────────────────────────

describe('buildMemberList', () => {
  it('returns an empty array for a group with no members', () => {
    expect(buildMemberList({ members: {} })).toEqual([])
  })

  it('returns correctly shaped member objects', () => {
    const group = {
      members: {
        's1': { socketId: 's1', name: 'Alice', icon: '🦊', lat: 37.7, lng: -122.4, active: true }
      }
    }
    const list = buildMemberList(group)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({ socketId: 's1', name: 'Alice', icon: '🦊', lat: 37.7, lng: -122.4, active: true })
  })

  it('returns all members when multiple exist', () => {
    const group = {
      members: {
        's1': { socketId: 's1', name: 'Alice', icon: '🦊', lat: null, lng: null, active: true },
        's2': { socketId: 's2', name: 'Bob',   icon: '🐻', lat: null, lng: null, active: false },
      }
    }
    expect(buildMemberList(group)).toHaveLength(2)
  })

  it('preserves null lat/lng for members who have not sent a location yet', () => {
    const group = {
      members: {
        's1': { socketId: 's1', name: 'Alice', icon: '🦊', lat: null, lng: null, active: true }
      }
    }
    const [member] = buildMemberList(group)
    expect(member.lat).toBeNull()
    expect(member.lng).toBeNull()
  })

  it('preserves the active flag accurately', () => {
    const group = {
      members: {
        's1': { socketId: 's1', name: 'Alice', icon: '🦊', lat: 0, lng: 0, active: false }
      }
    }
    expect(buildMemberList(group)[0].active).toBe(false)
  })
})

// ─── errorCodes ───────────────────────────────────────────────────────────────

describe('makeError', () => {
  it('includes code, message, and numeric HTTP status', async () => {
    const { makeError } = await import('../src/errorCodes.js')
    const err = makeError(ErrorCode.GROUP_NOT_FOUND, 'Group not found')
    expect(err.code).toBe(ErrorCode.GROUP_NOT_FOUND)
    expect(err.message).toBe('Group not found')
    expect(err.status).toBe(404)
  })

  it('maps every defined ErrorCode to a valid HTTP status', async () => {
    const { makeError } = await import('../src/errorCodes.js')
    for (const code of Object.values(ErrorCode)) {
      const err = makeError(code, 'test')
      expect(err.status).toBeGreaterThanOrEqual(400)
      expect(err.status).toBeLessThan(600)
    }
  })
})
