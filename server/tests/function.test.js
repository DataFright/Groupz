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
  // Drain both events emitted by create-group in the same handler so that
  // subsequent once('members-update') listeners in tests only capture events
  // from later operations (e.g. location-update), not from this initial emit.
  const [payload] = await Promise.all([
    once(client, 'group-created'),
    once(client, 'members-update'),
    Promise.resolve(client.emit('create-group', { name, icon })),
  ])
  return payload
}

async function joinGroup(client, code, name = 'Bob', icon = '🐻') {
  const p = once(client, 'join-confirmed')
  client.emit('join-group', { code, name, icon })
  return p
}

describe('Function tests — socket event handlers', () => {
  let httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits } = createApp({ corsOrigin: '*' }))
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
    ipCreateLimits.clear()
    ipJoinLimits.clear()
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

    it('emits join-error INVALID_NAME for name with control characters', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('create-group', { name: 'Alice\nBob', icon: '🦊' })
      const err = await p
      expect(err.code).toBe(ErrorCode.INVALID_NAME)
    })

    it('emits join-error INVALID_NAME when called with no payload', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('create-group')
      const err = await p
      expect(err.code).toBe(ErrorCode.INVALID_NAME)
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

    it('emits CODE_REQUIRED when code is a number instead of a string', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('join-group', { code: 123456, name: 'Bob', icon: '🐻' })
      const err = await p
      expect(err.code).toBe(ErrorCode.CODE_REQUIRED)
    })

    it('emits CODE_REQUIRED when code field is absent', async () => {
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('join-group', { name: 'Bob', icon: '🐻' })
      const err = await p
      expect(err.code).toBe(ErrorCode.CODE_REQUIRED)
    })

    it('emits INVALID_NAME for name with control characters', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const c = await connect(serverUrl)
      const p = once(c, 'join-error')
      c.emit('join-group', { code, name: 'Bob\x1f', icon: '🐻' })
      const err = await p
      expect(err.code).toBe(ErrorCode.INVALID_NAME)
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

    it('silently ignores Infinity latitude', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', { lat: Infinity, lng: 0 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    it('silently ignores a missing lng field', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', { lat: 51.5 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    it('silently ignores an entirely empty payload', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)
      c.emit('location-update', {})
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBeNull()
    })

    // ── Rate limiting ──────────────────────────────────────────────────────────

    it('the first update after joining is never rate-limited', async () => {
      // lastLocationSeen starts at 0, so the first update always passes
      // regardless of how quickly it arrives after joining.
      const c = await connect(serverUrl)
      await createGroup(c)
      const p = once(c, 'members-update')
      c.emit('location-update', { lat: 51.5074, lng: -0.1278 })
      const list = await p
      expect(list.find(m => m.socketId === c.id).lat).toBe(51.5074)
    })

    it('a second update arriving within 1 s of the first is silently dropped', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)

      // First update — goes through
      await new Promise(resolve => {
        c.once('members-update', resolve)
        c.emit('location-update', { lat: 10, lng: 10 })
      })
      expect(groups[code].members[c.id].lat).toBe(10)

      // Immediate second update — rate-limited, dropped silently
      c.emit('location-update', { lat: 20, lng: 20 })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code].members[c.id].lat).toBe(10) // unchanged
    })

    it('an update arriving more than 1 s after the previous is accepted', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)

      // First update
      await new Promise(resolve => {
        c.once('members-update', resolve)
        c.emit('location-update', { lat: 10, lng: 10 })
      })

      // Backdate lastLocationSeen to simulate >1 s elapsed
      groups[code].members[c.id].lastLocationSeen = Date.now() - 1100

      // Second update — should pass
      await new Promise(resolve => {
        c.once('members-update', resolve)
        c.emit('location-update', { lat: 20, lng: 20 })
      })
      expect(groups[code].members[c.id].lat).toBe(20)
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

    it('is a no-op when the socket is not in any group', async () => {
      const c = await connect(serverUrl)
      // No create-group or join-group — leave-group should not throw or emit anything
      c.emit('leave-group')
      await new Promise(r => setTimeout(r, 100))
      expect(Object.keys(groups)).toHaveLength(0)
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

    it('silently ignores attempt to remove a member who already left', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)
      const memberId = member.id

      await new Promise(resolve => {
        member.once('left-group', resolve)
        member.emit('leave-group')
      })
      // Drain the members-update that fires when member leaves
      await new Promise(r => setTimeout(r, 50))

      host.emit('remove-member', { targetSocketId: memberId })
      await new Promise(r => setTimeout(r, 100))
      expect(groups[code]).toBeDefined()
      expect(groups[code].members[host.id]).toBeDefined()
    })

    it('silently ignores remove-member with no targetSocketId', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      host.emit('remove-member', {})
      await new Promise(r => setTimeout(r, 100))
      expect(Object.keys(groups[code].members)).toHaveLength(2)
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

    it('clears socketToGroup for every member when the group ends', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)
      const hostId = host.id
      const memberId = member.id

      const p = once(host, 'group-ended')
      host.emit('end-group')
      await p

      expect(socketToGroup[hostId]).toBeUndefined()
      expect(socketToGroup[memberId]).toBeUndefined()
    })

    it('is a no-op when the socket is not in any group', async () => {
      const c = await connect(serverUrl)
      c.emit('end-group')
      await new Promise(r => setTimeout(r, 100))
      expect(Object.keys(groups)).toHaveLength(0)
    })
  })

  // ─── disconnect ───────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('when the host disconnects, remaining members receive host-changed', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      const p = once(member, 'host-changed')
      host.disconnect()
      const { newHostSocketId } = await p
      expect(newHostSocketId).toBe(member.id)
      expect(groups[code].hostSocketId).toBe(member.id)
    })

    it('when the last member disconnects, the group is kept briefly for reconnect', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)

      await new Promise(resolve => {
        c.once('disconnect', resolve)
        c.disconnect()
      })
      await new Promise(r => setTimeout(r, 100))

      // Group must still exist so the member can reconnect and rejoin
      expect(groups[code]).toBeDefined()
      expect(groups[code].emptyAt).toBeDefined()
      expect(socketToGroup[c.id]).toBeUndefined()
    })

    it('last member reconnects and rejoins as host', async () => {
      const c = await connect(serverUrl)
      const { code } = await createGroup(c)

      await new Promise(resolve => {
        c.once('disconnect', resolve)
        c.disconnect()
      })
      await new Promise(r => setTimeout(r, 100))

      const c2 = await connect(serverUrl)
      const confirmed = await new Promise(resolve => {
        c2.once('join-confirmed', resolve)
        c2.emit('join-group', { code, name: 'Solo', icon: '🦊' })
      })
      expect(confirmed.code).toBe(code)
      expect(confirmed.hostSocketId).toBe(c2.id)
      expect(groups[code].emptyAt).toBeUndefined()
      c2.disconnect()
    })

    it('disconnect of a socket not in any group is a no-op', async () => {
      const c = await connect(serverUrl)
      await new Promise(resolve => {
        c.once('disconnect', resolve)
        c.disconnect()
      })
      await new Promise(r => setTimeout(r, 100))
      expect(Object.keys(groups)).toHaveLength(0)
    })

    it('remaining members receive a members-update after host disconnects', async () => {
      const host = await connect(serverUrl)
      const { code } = await createGroup(host)
      const member = await connect(serverUrl)
      await joinGroup(member, code)

      // Drain the join members-update before testing
      await new Promise(r => setTimeout(r, 50))

      const p = once(member, 'members-update')
      host.disconnect()
      const list = await p
      expect(list.find(m => m.socketId === host.id)).toBeUndefined()
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

// ─── Group size limit ──────────────────────────────────────────────────────────

describe('Group size limit', () => {
  let httpServer, io, groups, socketToGroup, cleanupTimer, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer } = createApp({
      corsOrigin: '*',
      maxGroupSize: 2,
    }))
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

  it('emits join-error GROUP_FULL when the group is at capacity', async () => {
    const host = await connect(serverUrl)
    const { code } = await createGroup(host)

    const member = await connect(serverUrl)
    await joinGroup(member, code)  // fills the group (maxGroupSize: 2)

    const extra = await connect(serverUrl)
    const p = once(extra, 'join-error')
    extra.emit('join-group', { code, name: 'Extra', icon: '🦁' })
    const err = await p
    expect(err.code).toBe(ErrorCode.GROUP_FULL)
    expect(err.status).toBe(400)
  })

  it('does not add a member to a full group', async () => {
    const host = await connect(serverUrl)
    const { code } = await createGroup(host)

    const member = await connect(serverUrl)
    await joinGroup(member, code)

    const extra = await connect(serverUrl)
    extra.emit('join-group', { code, name: 'Extra', icon: '🦁' })
    await new Promise(r => setTimeout(r, 100))
    expect(Object.keys(groups[code].members)).toHaveLength(2)
  })
})

// ─── IP rate limiting ──────────────────────────────────────────────────────────

describe('IP rate limiting', () => {
  let httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits } = createApp({
      corsOrigin: '*',
      ipRateLimits: {
        createGroup: { max: 2, windowMs: 60_000 },
        joinGroup:   { max: 2, windowMs: 60_000 },
      },
    }))
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
    ipCreateLimits.clear()
    ipJoinLimits.clear()
  })

  it('emits join-error RATE_LIMITED after exceeding the create-group limit', async () => {
    const c1 = await connect(serverUrl)
    const c2 = await connect(serverUrl)
    const c3 = await connect(serverUrl)
    await createGroup(c1)
    await createGroup(c2)
    const p = once(c3, 'join-error')
    c3.emit('create-group', { name: 'Alice', icon: '🦊' })
    const err = await p
    expect(err.code).toBe(ErrorCode.RATE_LIMITED)
    expect(err.status).toBe(429)
  })

  it('does not create a group when the create-group rate limit is exceeded', async () => {
    const c1 = await connect(serverUrl)
    const c2 = await connect(serverUrl)
    const c3 = await connect(serverUrl)
    await createGroup(c1)
    await createGroup(c2)
    c3.emit('create-group', { name: 'Alice', icon: '🦊' })
    await new Promise(r => setTimeout(r, 100))
    expect(Object.keys(groups)).toHaveLength(2)
  })

  it('emits join-error RATE_LIMITED after exceeding the join-group limit', async () => {
    const host = await connect(serverUrl)
    const { code } = await createGroup(host)

    // Do one real join to seed the Map with the actual loopback IP key,
    // then manually fill the counter to max so the next attempt is blocked.
    const j1 = await connect(serverUrl)
    await joinGroup(j1, code)
    for (const entry of ipJoinLimits.values()) entry.count = 2  // max = 2

    const j2 = await connect(serverUrl)
    const p = once(j2, 'join-error')
    j2.emit('join-group', { code, name: 'Carol', icon: '🐱' })
    const err = await p
    expect(err.code).toBe(ErrorCode.RATE_LIMITED)
    expect(err.status).toBe(429)
  })
})

// ─── REST API — lookup rate limiting ──────────────────────────────────────────

describe('REST API — lookup rate limiting', () => {
  let httpServer, io, cleanupTimer, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, cleanupTimer } = createApp({
      corsOrigin: '*',
      ipRateLimits: { lookup: { max: 2, windowMs: 60_000 } },
    }))
    await new Promise(resolve => httpServer.listen(0, resolve))
    serverUrl = `http://localhost:${httpServer.address().port}`
  })

  afterAll(async () => {
    clearInterval(cleanupTimer)
    await new Promise(resolve => io.close(resolve))
    await new Promise(resolve => httpServer.close(resolve))
  })

  it('returns 429 after exceeding the lookup rate limit', async () => {
    await fetch(`${serverUrl}/api/groups/XXXXXX`)
    await fetch(`${serverUrl}/api/groups/XXXXXX`)
    const res = await fetch(`${serverUrl}/api/groups/XXXXXX`)
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })
})
