/**
 * Integration tests — multi-client, multi-step flows that verify the full
 * real-time behaviour of the app end-to-end.
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

// Shared server state — both suites in this file use the same instance.
let httpServer, io, groups, socketToGroup, cleanupTimer, serverUrl

async function setup() {
  ;({ httpServer, io, groups, socketToGroup, cleanupTimer } = createApp({ corsOrigin: '*' }))
  await new Promise(resolve => httpServer.listen(0, resolve))
  serverUrl = `http://localhost:${httpServer.address().port}`
}

async function teardown() {
  clearInterval(cleanupTimer)
  await new Promise(resolve => io.close(resolve))
  await new Promise(resolve => httpServer.close(resolve))
}

async function reset() {
  io.disconnectSockets(true)
  await new Promise(r => setTimeout(r, 100))
  Object.keys(groups).forEach(k => delete groups[k])
  Object.keys(socketToGroup).forEach(k => delete socketToGroup[k])
}

describe('Integration — Part 1: session, host transfer, and lifecycle', () => {
  beforeAll(setup)
  afterAll(teardown)
  afterEach(reset)

  // ─── Full session flow ──────────────────────────────────────────────────────

  it('full create → join → location sharing flow', async () => {
    const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

    // c1 creates the group
    const { code } = await new Promise(resolve => {
      c1.once('group-created', resolve)
      c1.emit('create-group', { name: 'Alice', icon: '🦊' })
    })

    // c2 joins; wait for a members-update that includes both users
    // (skip any leftover 1-member update from create-group)
    const afterJoin = await new Promise(resolve => {
      c1.on('members-update', function h(list) {
        if (list.length === 2) { c1.off('members-update', h); resolve(list) }
      })
      c2.emit('join-group', { code, name: 'Bob', icon: '🐻' })
    })
    expect(afterJoin).toHaveLength(2)

    // c1 sends location; c2 should see it
    const afterLocation = await new Promise(resolve => {
      c2.once('members-update', resolve)
      c1.emit('location-update', { lat: 51.5074, lng: -0.1278 })
    })
    const alice = afterLocation.find(m => m.name === 'Alice')
    expect(alice.lat).toBe(51.5074)
    expect(alice.lng).toBe(-0.1278)
  })

  // ─── Host transfer ─────────────────────────────────────────────────────────

  it('host transfer: new member becomes host when host disconnects', async () => {
    const [host, member] = await Promise.all([connect(serverUrl), connect(serverUrl)])

    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Bob', icon: '🐻' })
    })

    const hostChanged = await new Promise(resolve => {
      member.once('host-changed', resolve)
      host.disconnect()
    })
    expect(hostChanged.newHostSocketId).toBe(member.id)
    expect(hostChanged.status).toBe(200)
    expect(groups[code]?.hostSocketId).toBe(member.id)
  })

  it('new host can end the group after host transfer', async () => {
    const [host, member] = await Promise.all([connect(serverUrl), connect(serverUrl)])

    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })
    await new Promise(resolve => {
      member.once('join-confirmed', resolve)
      member.emit('join-group', { code, name: 'Bob', icon: '🐻' })
    })

    await new Promise(resolve => {
      member.once('host-changed', resolve)
      host.disconnect()
    })

    const ended = await new Promise(resolve => {
      member.once('group-ended', resolve)
      member.emit('end-group')
    })
    expect(ended.status).toBe(200)
    expect(groups[code]).toBeUndefined()
  })

  // ─── Group lifecycle ────────────────────────────────────────────────────────

  it('group is deleted when the last member leaves voluntarily', async () => {
    const c = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      c.once('group-created', resolve)
      c.emit('create-group', { name: 'Solo', icon: '🦊' })
    })

    await new Promise(resolve => {
      c.once('left-group', resolve)
      c.emit('leave-group')
    })
    expect(groups[code]).toBeUndefined()
  })

  it('group is deleted when the last member disconnects abruptly', async () => {
    const c = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      c.once('group-created', resolve)
      c.emit('create-group', { name: 'Solo', icon: '🦊' })
    })

    await new Promise(resolve => {
      c.on('disconnect', resolve)
      c.disconnect()
    })
    await new Promise(r => setTimeout(r, 100))
    expect(groups[code]).toBeUndefined()
  })

  // ─── end-group broadcast ───────────────────────────────────────────────────

  it('end-group broadcasts group-ended to all members simultaneously', async () => {
    const [host, m1, m2] = await Promise.all([
      connect(serverUrl), connect(serverUrl), connect(serverUrl)
    ])

    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })
    for (const [c, name] of [[m1, 'Bob'], [m2, 'Carol']]) {
      await new Promise(resolve => {
        c.once('join-confirmed', resolve)
        c.emit('join-group', { code, name, icon: '🐻' })
      })
    }

    const [r1, r2, r3] = await Promise.all([
      once(host, 'group-ended'),
      once(m1,   'group-ended'),
      once(m2,   'group-ended'),
      Promise.resolve(host.emit('end-group')),
    ])
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200])
    expect(groups[code]).toBeUndefined()
  })
})

describe('Integration — Part 2: member management, location, and edge cases', () => {
  beforeAll(setup)
  afterAll(teardown)
  afterEach(reset)

  // ─── remove-member cascade ─────────────────────────────────────────────────

  it('remove-member: target is ejected and bystanders see updated list', async () => {
    const [host, victim, bystander] = await Promise.all([
      connect(serverUrl), connect(serverUrl), connect(serverUrl)
    ])

    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })
    for (const [c, name] of [[victim, 'Victim'], [bystander, 'Bystander']]) {
      await new Promise(resolve => {
        c.once('join-confirmed', resolve)
        c.emit('join-group', { code, name, icon: '🐻' })
      })
    }

    const [, bystanderUpdate] = await Promise.all([
      once(victim,    'removed-from-group'),
      once(bystander, 'members-update'),
      Promise.resolve(host.emit('remove-member', { targetSocketId: victim.id })),
    ])

    expect(bystanderUpdate).toHaveLength(2) // host + bystander
    expect(bystanderUpdate.find(m => m.socketId === victim.id)).toBeUndefined()
  })

  // ─── Location tracking ─────────────────────────────────────────────────────

  it('consecutive location updates accumulate correctly', async () => {
    const c = await connect(serverUrl)
    const { code } = await new Promise(resolve => {
      c.once('group-created', resolve)
      c.emit('create-group', { name: 'Alice', icon: '🦊' })
    })

    for (const [lat, lng] of [[10, 20], [11, 21], [12, 22]]) {
      // Reset the rate-limit timestamp so rapid test updates aren't dropped.
      // In production the client sends every 2 500 ms, well above the 1 s limit.
      groups[code].members[c.id].lastLocationSeen = 0
      await new Promise(resolve => {
        c.once('members-update', resolve)
        c.emit('location-update', { lat, lng })
      })
    }

    const member = groups[code].members[c.id]
    expect(member.lat).toBe(12)
    expect(member.lng).toBe(22)
    expect(member.active).toBe(true)
  })

  it('both members see each other after mutual location updates', async () => {
    const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

    const { code } = await new Promise(resolve => {
      c1.once('group-created', resolve)
      c1.emit('create-group', { name: 'Alice', icon: '🦊' })
    })
    await new Promise(resolve => {
      c2.once('join-confirmed', resolve)
      c2.emit('join-group', { code, name: 'Bob', icon: '🐻' })
    })

    // c1 sends location
    await new Promise(resolve => {
      c2.once('members-update', resolve)
      c1.emit('location-update', { lat: 1, lng: 1 })
    })

    // c2 sends location
    const final = await new Promise(resolve => {
      c1.once('members-update', resolve)
      c2.emit('location-update', { lat: 2, lng: 2 })
    })

    expect(final.find(m => m.name === 'Alice').lat).toBe(1)
    expect(final.find(m => m.name === 'Bob').lat).toBe(2)
  })

  // ─── Edge cases ────────────────────────────────────────────────────────────

  it('re-joining with the same socket updates name and icon without duplicating', async () => {
    const [host, joiner] = await Promise.all([connect(serverUrl), connect(serverUrl)])

    const { code } = await new Promise(resolve => {
      host.once('group-created', resolve)
      host.emit('create-group', { name: 'Host', icon: '🦊' })
    })
    await new Promise(resolve => {
      joiner.once('join-confirmed', resolve)
      joiner.emit('join-group', { code, name: 'Bob', icon: '🐻' })
    })

    // Re-join with different name — should update, not add a second entry
    const update = await new Promise(resolve => {
      joiner.once('join-confirmed', resolve)
      joiner.emit('join-group', { code, name: 'Robert', icon: '🐼' })
    })
    expect(Object.keys(groups[code].members)).toHaveLength(2)
    expect(groups[code].members[joiner.id].name).toBe('Robert')
    expect(update.code).toBe(code)
  })

  it('three clients can all share locations simultaneously', async () => {
    const clients = await Promise.all([
      connect(serverUrl), connect(serverUrl), connect(serverUrl)
    ])
    const [c1, c2, c3] = clients

    const { code } = await new Promise(resolve => {
      c1.once('group-created', resolve)
      c1.emit('create-group', { name: 'One', icon: '🦊' })
    })
    for (const [c, name] of [[c2, 'Two'], [c3, 'Three']]) {
      await new Promise(resolve => {
        c.once('join-confirmed', resolve)
        c.emit('join-group', { code, name, icon: '🐻' })
      })
    }

    // All 3 send a location
    for (const [c, lat] of [[c1, 10], [c2, 20], [c3, 30]]) {
      c.emit('location-update', { lat, lng: 0 })
      await new Promise(r => setTimeout(r, 30))
    }

    await new Promise(r => setTimeout(r, 100))
    const members = Object.values(groups[code].members)
    const lats = members.map(m => m.lat).filter(Boolean).sort()
    expect(lats).toEqual([10, 20, 30])
  })
})
