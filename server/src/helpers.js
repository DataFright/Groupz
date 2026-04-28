import { randomBytes } from 'crypto'
import { ErrorCode, makeError } from './errorCodes.js'

export const ALLOWED_ICONS = new Set([
  '🦊','🐻','🐼','🐨','🦁','🐯','🦝','🐺',
  '🦄','🐸','🐙','🦋','🌵','🌈','⚡','🔥',
  '💎','🚀','🎸','🏔️'
])

export function validateInput(name, icon) {
  if (!name || typeof name !== 'string') return makeError(ErrorCode.INVALID_NAME, 'Name is required')
  const trimmed = name.trim()
  if (trimmed.length === 0) return makeError(ErrorCode.INVALID_NAME, 'Name is required')
  if (trimmed.length > 16)  return makeError(ErrorCode.INVALID_NAME, 'Name must be 1–16 characters')
  if (!icon || !ALLOWED_ICONS.has(icon)) return makeError(ErrorCode.INVALID_ICON, 'Invalid icon selection')
  return null
}

export function generateCode(groups) {
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(3).toString('hex').toUpperCase().slice(0, 6)
    if (!groups[code]) return code
  }
  return null
}

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
