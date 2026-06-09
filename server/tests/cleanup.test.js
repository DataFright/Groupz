/**
 * Cleanup tests — inactivity auto-remove and host transfer via the cleanup loop.
 *
 * Uses cleanupIntervalMs: 80 so tests don't have to wait 60 seconds.
 * Each test backdates member.lastSeen by 181 s then lets the next tick remove them.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { io as Client } from 'socket.io-client'
import { createApp } from '../src/app.js'

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

// Give the cleanup loop two full ticks to fire after backdating lastSeen
const TICK = 80
const WAIT = TICK * 2 + 50

describe('Cleanup — auto-remove inactive members', () => {
  let httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits } = createApp({
      corsOrigin: '*',
      cleanupIntervalMs: TICK,
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
    await new Promise(r => setTimeout(r, TICK))
    Object.keys(groups).forEach(k => delete groups[k])
    Object.keys(socketToGroup).forEach(k => delete socketToGroup[k])
    ipCreateLimits.clear()
    ipJoinLimits.clear()
  })

  // ─── Member removal ─────────────────────────────────────────────────────────

  it('removes a non-host member whose lastSeen is older than 180 s', async () => {
    const host = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const member = await connect(serverUrl)
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Idle', icon: '🐻' })
    })

    groups[code].members[member.id].lastSeen = Date.now() - 181_000

    await new Promise(r => setTimeout(r, WAIT))

    expect(groups[code].members[member.id]).toBeUndefined()
    expect(socketToGroup[member.id]).toBeUndefined()
  })

  it('sends removed-from-group to the evicted member', async () => {
    const host = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const member = await connect(serverUrl)
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Idle', icon: '🐻' })
    })

    groups[code].members[member.id].lastSeen = Date.now() - 181_000

    const payload = await once(member, 'removed-from-group')
    expect(payload.status).toBe(200)
  })

  it('remaining members receive a members-update after the idle member is removed', async () => {
    const host = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const idle = await connect(serverUrl)
    // Drain both join-confirmed (idle) and the join members-update (host) before backdating,
    // so the once() below doesn't accidentally catch the join broadcast instead of the cleanup one.
    await Promise.all([
      once(idle, 'join-confirmed'),
      once(host, 'members-update'),
      Promise.resolve(idle.emit('join-group', { code, name: 'Idle', icon: '🐻' })),
    ])

    groups[code].members[idle.id].lastSeen = Date.now() - 181_000
    const update = await once(host, 'members-update')

    expect(update).toHaveLength(1)
    expect(update.find(m => m.socketId === idle.id)).toBeUndefined()
  })

  it('deletes the group when the only member becomes inactive', async () => {
    const solo = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      solo.once('group-created', resolve)
      solo.emit('create-group', { name: 'Solo', icon: '🦊' })
    })

    groups[code].members[solo.id].lastSeen = Date.now() - 181_000

    await new Promise(r => setTimeout(r, WAIT))

    expect(groups[code]).toBeUndefined()
    expect(socketToGroup[solo.id]).toBeUndefined()
  })

  it('keeps empty group during the 3-min reconnect grace period after disconnect', async () => {
    const solo = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      solo.once('group-created', resolve)
      solo.emit('create-group', { name: 'Solo', icon: '🦊' })
    })

    await new Promise(resolve => {
      solo.once('disconnect', resolve)
      solo.disconnect()
    })
    await new Promise(r => setTimeout(r, WAIT))

    // Group must survive cleanup ticks while within the grace period
    expect(groups[code]).toBeDefined()
    expect(groups[code].emptyAt).toBeDefined()
  })

  it('deletes empty group once grace period expires', async () => {
    const solo = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      solo.once('group-created', resolve)
      solo.emit('create-group', { name: 'Solo', icon: '🦊' })
    })

    await new Promise(resolve => {
      solo.once('disconnect', resolve)
      solo.disconnect()
    })
    await new Promise(r => setTimeout(r, 50))

    // Simulate grace period already expired
    groups[code].emptyAt = Date.now() - 181_000

    await new Promise(r => setTimeout(r, WAIT))
    expect(groups[code]).toBeUndefined()
  })

  // ─── Host transfer ──────────────────────────────────────────────────────────

  it('transfers the host when the idle member was the host', async () => {
    const host = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const member = await connect(serverUrl)
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Member', icon: '🐻' })
    })

    // The host goes idle
    groups[code].members[host.id].lastSeen = Date.now() - 181_000

    const { newHostSocketId } = await once(member, 'host-changed')

    expect(newHostSocketId).toBe(member.id)
    expect(groups[code].hostSocketId).toBe(member.id)
  })

  it('new host can end the group after a cleanup-triggered host transfer', async () => {
    const host = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const member = await connect(serverUrl)
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Member', icon: '🐻' })
    })

    groups[code].members[host.id].lastSeen = Date.now() - 181_000
    await once(member, 'host-changed')

    const ended = await new Promise(resolve => {
      member.once('group-ended', resolve)
      member.emit('end-group')
    })
    expect(ended.status).toBe(200)
    expect(groups[code]).toBeUndefined()
  })
})

// ─── Hard group age limit ───────────────────────────────────────────────────────

describe('Cleanup — hard group age limit (maxGroupAgeMs)', () => {
  const TICK = 50
  const MAX_AGE = 80
  const WAIT = TICK * 2 + 50

  let httpServer, io, groups, socketToGroup, cleanupTimer, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer } = createApp({
      corsOrigin: '*',
      cleanupIntervalMs: TICK,
      maxGroupAgeMs: MAX_AGE,
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
    await new Promise(r => setTimeout(r, TICK))
    Object.keys(groups).forEach(k => delete groups[k])
    Object.keys(socketToGroup).forEach(k => delete socketToGroup[k])
  })

  it('emits group-ended and removes the group after maxGroupAgeMs', async () => {
    const host = await connect(serverUrl)
    let groupCode
    await new Promise(resolve => {
      host.once('group-created', ({ code }) => { groupCode = code; resolve() })
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const ended = once(host, 'group-ended')
    await new Promise(r => setTimeout(r, WAIT))
    const payload = await ended
    expect(payload.status).toBe(200)
    expect(groups[groupCode]).toBeUndefined()
  })

  it('cleans up socketToGroup after the group age limit fires', async () => {
    const host = await connect(serverUrl)
    await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    await new Promise(r => setTimeout(r, WAIT))
    expect(socketToGroup[host.id]).toBeUndefined()
  })

  it('all members receive group-ended when the age limit fires', async () => {
    const host = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })

    const member = await connect(serverUrl)
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Member', icon: '🐻' })
    })

    const hostEnded  = once(host, 'group-ended')
    const memberEnded = once(member, 'group-ended')
    await new Promise(r => setTimeout(r, WAIT))
    const [hp, mp] = await Promise.all([hostEnded, memberEnded])
    expect(hp.status).toBe(200)
    expect(mp.status).toBe(200)
  })
})
