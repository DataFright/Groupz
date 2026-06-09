import { randomBytes } from 'crypto'
import { ErrorCode, makeError } from './errorCodes.js'

// Must stay in sync with ICONS in client/src/constants/icons.js.
export const ALLOWED_ICONS = new Set([
  '🦊','🐻','🐼','🐨','🦁','🐯','🦝','🐺',
  '🦄','🐸','🐙','🦋','🌵','🌈','⚡','🔥',
  '💎','🚀','🎸','🏔️'
])

// Validates name and icon for both create-group and join-group.
// Returns a makeError object on failure, or null on success.
// Control characters are blocked to prevent display exploits.
export function validateInput(name, icon) {
  if (!name || typeof name !== 'string') return makeError(ErrorCode.INVALID_NAME, 'Name is required')
  const trimmed = name.trim()
  if (trimmed.length === 0) return makeError(ErrorCode.INVALID_NAME, 'Name is required')
  if (trimmed.length > 16)  return makeError(ErrorCode.INVALID_NAME, 'Name must be 1–16 characters')
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return makeError(ErrorCode.INVALID_NAME, 'Name contains invalid characters')
  if (!icon || !ALLOWED_ICONS.has(icon)) return makeError(ErrorCode.INVALID_ICON, 'Invalid icon selection')
  return null
}

// Generates a unique 6-character hex code (e.g. "A3F9B2").
// Retries up to 10 times to avoid collisions in busy servers; returns null
// on the rare chance all 10 attempts collide (practically impossible below ~16M groups).
export function generateCode(groups) {
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(3).toString('hex').toUpperCase().slice(0, 6)
    if (!groups[code]) return code
  }
  return null
}

// Returns the public member list for a group — strips internal fields
// (lastSeen, lastLocationSeen) that clients should never see.
export function buildMemberList(group) {
  return Object.values(group.members).map(m => ({
    socketId: m.socketId,
    name:     m.name,
    icon:     m.icon,
    lat:      m.lat,
    lng:      m.lng,
    active:   m.active,
  }))
}
