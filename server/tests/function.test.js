/**
 * Function tests — each test exercises one socket event handler in isolation
 * using a single connected client. No multi-step flows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { io as Client } from 'socket.io-client'
import { createApp } from '../src/app.js'
import { ErrorCode } from '../src/errorCodes.js'

function connect(url) {
  return new Promise((resolve, reject) => {
    const c = Client(url, { reconnection: false })
    c.on('connect', () => resolve(c))
    c.on('connect_error', reject)
  })
}

function once(socket, event) {
  return new Promise(resolve => socket.once(event, resolve))
}

async function createGroup(client, name = 'Alice', icon = '🦊') {
  const p = once(client, 'group-created')
  client.emit('create-group', { name, icon })
  return p
}

async function joinGroup(client, code, name = 'Bob', icon = '🐻') {
  const p = once(client, 'join-confirmed')
  client.emit('join-group', { code, name, icon })
  return p
}

describe('Function tests — socket event handlers', () => {
  let httpServer, io, groups, socketToGroup, cleanupTimer, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer } = createApp({ corsOrigin: '*' }))
    await new Promise(resolve => httpServer.listen(0, resolve))
    serverUrl = `http://localhost:${httpServer.address().port}`
  })

  afterAll(async () => {
    clearInterval(cleanupTimer)
    await new Promise(resolve => io.close(resolve))
    await new Promise(resolve => httpServer.close(resolve))
  })

  afterEach(async () => {
    io.disconnectSockets(true)
    await new Promise(r => setTimeout(r, 80))
    Object.keys(groups).forEach(k => delete groups[k])
    Object.keys(socketToGroup).forEach(k => delete socketToGroup[k])
  })

  // ─── create-group ──────────────────────────────────────────────────────────

  describe('create-group', () => {
    it('responds with group-created containing a 6-char code and socketId', async () => {
      const c = await connect(serverUrl)
      const payload = await createGroup(c)
      expect(payload.code).toMatch(/^[A-F0-9]{6}$/)
      expect(payload.socketId).toBe(c.id)
      expect(payload.status).toBe(201)
    })

    it('stores the group in server memory with caller as host', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      expect(groups[code]).toBeDefined()
      expect(groups[code].hostSocketId).toBe(c.id)
      expect(groups[code].members[c.id]).toBeDefined()
    })

    it('emits join-error INVALID_NAME for empty name', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('create-group', { name: '', icon: '🦊' })
      const err = await p
      expect(err.code).toBe(ErrorCode.INVALID_NAME)
      expect(err.status).toBe(400)
    })

    it('emits join-error INVALID_NAME for name over 16 chars', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('create-group', { name: 'A'.repeat(17), icon: '🦊' })
      const err = await p
      expect(err.code).toBe(ErrorCode.INVALID_NAME)
    })

    it('emits join-error INVALID_ICON for unknown icon', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('create-group', { name: 'Alice', icon: '🤠' })
      const err = await p
      expect(err.code).toBe(ErrorCode.INVALID_ICON)
      expect(err.status).toBe(400)
    })

    it('does not create a group on validation failure', async () => {
      const c = await connect(serverUrl)
      c.emit('create-group', { name: '', icon: '🦊' })
      await new Promise(r => setTimeout(r, 100))
      expect(Object.keys(groups)).toHaveLength(0)
    })
  })

  // ─── join-group ────────────────────────────────────────────────────────────

  describe('join-group', () => {
    it('responds with join-confirmed containing code, socketId, and hostSocketId', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)

      const joiner = await connect(serverUrl)
      const payload = await joinGroup(joiner, code)
      expect(payload.code).toBe(code)
      expect(payload.socketId).toBe(joiner.id)
      expect(payload.hostSocketId).toBe(host.id)
      expect(payload.status).toBe(200)
    })

    it('emits join-error GROUP_NOT_FOUND for non-existent code', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('join-group', { code: 'XXXXXX', name: 'Bob', icon: '🐻' })
      const err = await p
      expect(err.code).toBe(ErrorCode.GROUP_NOT_FOUND)
      expect(err.status).toBe(404)
    })

    it('emits join-error CODE_REQUIRED for empty code', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('join-group', { code: '', name: 'Bob', icon: '🐻' })
      const err = await p
      expect(err.code).toBe(ErrorCode.CODE_REQUIRED)
      expect(err.status).toBe(400)
    })

    it('normalises lowercase code to uppercase', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)

      const joiner = await connect(serverUrl)
      const p = once(joiner, 'join-confirmed')
      joiner.emit('join-group', { code: code.toLowerCase(), name: 'Bob', icon: '🐻' })
      const payload = await p
      expect(payload.code).toBe(code)
    })

    it('adds joiner to the group members', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)

      const joiner = await connect(serverUrl)
      await joinGroup(joiner, code)
      expect(groups[code].members[joiner.id]).toBeDefined()
    })
  })

  // ─── location-update ───────────────────────────────────────────────────────

  describe('location-update', () => {
    it('updates member lat/lng and broadcasts members-update', async () => {
      const c = await connect(serverUrl)
      await createGroup(c)

      const p = once(c, 'members-update')
      c.emit('location-update', { lat: 51.5074, lng: -0.1278 })
      const list = await p
      const me = list.find(m => m.socketId === c.id)
      expect(me.lat).toBe(51.5074)
      expect(me.lng).toBe(-0.1278)
    })

    it('marks the member as active after an update', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      groups[code].members[c.id].active = false

      c.emit('location-update', { lat: 0, lng: 0 })
      await new Promise(r => setTimeout(r, 80))
      expect(groups[code].members[c.id].active).toBe(true)
    })

    it('silently ignores latitude out of range (> 90)', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', { lat: 91, lng: 0 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    it('silently ignores longitude out of range (< -180)', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', { lat: 0, lng: -181 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    it('silently ignores NaN coordinates', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', { lat: NaN, lng: 0 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    it('silently ignores non-numeric coordinates', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', { lat: 'bad', lng: 0 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    it('is ignored when the socket is not in a group', async () => {
      const c = await connect(serverUrl)
      // No create-group or join-group emitted — should not throw
      c.emit('location-update', { lat: 10, lng: 10 })
      await new Promise(r => setTimeout(r, 100))
      expect(Object.keys(groups)).toHaveLength(0)
    })
  })

  // ─── leave-group ───────────────────────────────────────────────────────────

  describe('leave-group', () => {
    it('emits left-group (200) back to the leaving client', async () => {
      const c = await connect(serverUrl)
      await createGroup(c)
      const p = once(c, 'left-group')
      c.emit('leave-group')
      const payload = await p
      expect(payload.status).toBe(200)
    })

    it('removes the member from server state', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      const p = once(c, 'left-group')
      c.emit('leave-group')
      await p
      expect(groups[code]).toBeUndefined() // last member — group deleted
    })

    it('cleans up socketToGroup entry', async () => {
      const c = await connect(serverUrl)
      await createGroup(c)
      const p = once(c, 'left-group')
      c.emit('leave-group')
      await p
      expect(socketToGroup[c.id]).toBeUndefined()
    })
  })

  // ─── remove-member ─────────────────────────────────────────────────────────

  describe('remove-member', () => {
    it('host can remove another member; target receives removed-from-group (200)', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      const p = once(member, 'removed-from-group')
      host.emit('remove-member', { targetSocketId: member.id })
      const payload = await p
      expect(payload.status).toBe(200)
      expect(groups[code].members[member.id]).toBeUndefined()
    })

    it('non-host cannot remove members', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      member.emit('remove-member', { targetSocketId: host.id })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[host.id]).toBeDefined()
    })

    it('host cannot remove themselves via remove-member', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      host.emit('remove-member', { targetSocketId: host.id })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[host.id]).toBeDefined()
    })
  })

  // ─── end-group ─────────────────────────────────────────────────────────────

  describe('end-group', () => {
    it('host can end the group; receives group-ended (200)', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)

      const p = once(host, 'group-ended')
      host.emit('end-group')
      const payload = await p
      expect(payload.status).toBe(200)
      expect(groups[code]).toBeUndefined()
    })

    it('non-host cannot end the group', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      member.emit('end-group')
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code]).toBeDefined()
    })
  })

  // ─── REST API ──────────────────────────────────────────────────────────────

  describe('REST API', () => {
    it('GET /api/groups/:code returns 200 for an existing group', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)

      const res = await fetch(`${serverUrl}/api/groups/${code}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.exists).toBe(true)
      expect(body.memberCount).toBe(1)
      expect(body.createdAt).toBeTypeOf('number')
    })

    it('GET /api/groups/:code returns 404 for unknown group', async () => {
      const res = await fetch(`${serverUrl}/api/groups/ZZZZZZ`)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.exists).toBe(false)
      expect(body.error.code).toBe(ErrorCode.GROUP_NOT_FOUND)
    })

    it('GET /api/groups/:code is case-insensitive', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      const res = await fetch(`${serverUrl}/api/groups/${code.toLowerCase()}`)
      expect(res.status).toBe(200)
    })

    it('GET /health reflects active group count', async () => {
      const c = await connect(serverUrl)
      await createGroup(c)

      const res = await fetch(`${serverUrl}/health`)
      const body = await res.json()
      expect(body.activeGroups).toBe(1)
    })
  })
})
