/**
 * Scenario tests — four membership shapes that cover common real-world usage:
 *   1. Single user in a group
 *   2. Multiple users in one group
 *   3. Multiple groups, one user each
 *   4. Multiple groups, multiple users each
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

// Wait for an event only if it fires within `ms` ms, otherwise resolve null
function maybeOnce(socket, event, ms = 200) {
  return new Promise(resolve => {
    const t = setTimeout(() => { socket.off(event, h); resolve(null) }, ms)
    function h(data) { clearTimeout(t); resolve(data) }
    socket.once(event, h)
  })
}

describe('Scenario tests', () => {
  let httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits, serverUrl, baseUrl

  beforeAll(async () => {
    ;({ httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits } = createApp({ corsOrigin: '*' }))
    await new Promise(resolve => httpServer.listen(0, resolve))
    const port = httpServer.address().port
    serverUrl = `http://localhost:${port}`
    baseUrl = serverUrl
  })

  afterAll(async () => {
    clearInterval(cleanupTimer)
    await new Promise(resolve => io.close(resolve))
    await new Promise(resolve => httpServer.close(resolve))
  })

  afterEach(async () => {
    io.disconnectSockets(true)
    await new Promise(r => setTimeout(r, 100))
    Object.keys(groups).forEach(k => delete groups[k])
    Object.keys(socketToGroup).forEach(k => delete socketToGroup[k])
    ipCreateLimits.clear()
    ipJoinLimits.clear()
  })

  // ─── 1. Single user in a group ─────────────────────────────────────────────

  describe('1 — single user in a group', () => {
    it('creates a group and is stored as the host', async () => {
      const c = await connect(serverUrl)
      const { code, socketId } = await new Promise(resolve => {
        c.once('group-created', resolve)
        c.emit('create-group', { name: 'Solo', icon: '🦊' })
      })
      expect(code).toHaveLength(6)
      expect(socketId).toBe(c.id)
      expect(groups[code].hostSocketId).toBe(c.id)
    })

    it('initial members-update contains exactly the creator', async () => {
      const c = await connect(serverUrl)
      const [, memberList] = await Promise.all([
        once(c, 'group-created'),
        once(c, 'members-update'),
        Promise.resolve(c.emit('create-group', { name: 'Solo', icon: '🦊' })),
      ])
      expect(memberList).toHaveLength(1)
      expect(memberList[0].name).toBe('Solo')
      expect(memberList[0].socketId).toBe(c.id)
    })

    it('solo user location update is reflected in members-update back to themselves', async () => {
      const c = await connect(serverUrl)
      // Drain both group-created and the initial members-update together so the
      // listener registered below only fires for the location update.
      const [{ code }] = await Promise.all([
        once(c, 'group-created'),
        once(c, 'members-update'),
        Promise.resolve(c.emit('create-group', { name: 'Solo', icon: '🦊' })),
      ])

      const update = await new Promise(resolve => {
        c.once('members-update', resolve)
        c.emit('location-update', { lat: 48.8566, lng: 2.3522 })
      })
      expect(update[0].lat).toBe(48.8566)
      expect(update[0].lng).toBe(2.3522)
      expect(update[0].active).toBe(true)
    })

    it('REST /api/groups/:code returns memberCount of 1 for a solo group', async () => {
      const c = await connect(serverUrl)
      const { code } = await new Promise(resolve => {
        c.once('group-created', resolve)
        c.emit('create-group', { name: 'Solo', icon: '🦊' })
      })

      const res = await fetch(`${baseUrl}/api/groups/${code}`)
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.exists).toBe(true)
      expect(body.memberCount).toBe(1)
    })

    it('solo user voluntarily leaving destroys the group', async () => {
      const c = await connect(serverUrl)
      const { code } = await new Promise(resolve => {
        c.once('group-created', resolve)
        c.emit('create-group', { name: 'Solo', icon: '🦊' })
      })

      await new Promise(resolve => {
        c.once('left-group', resolve)
        c.emit('leave-group')
      })
      await new Promise(r => setTimeout(r, 50))
      expect(groups[code]).toBeUndefined()
    })

    it('solo user ending the group destroys it', async () => {
      const c = await connect(serverUrl)
      const { code } = await new Promise(resolve => {
        c.once('group-created', resolve)
        c.emit('create-group', { name: 'Solo', icon: '🦊' })
      })

      await new Promise(resolve => {
        c.once('group-ended', resolve)
        c.emit('end-group')
      })
      await new Promise(r => setTimeout(r, 50))
      expect(groups[code]).toBeUndefined()
    })

    it('icon and name are stored exactly as provided', async () => {
      const c = await connect(serverUrl)
      const { code } = await new Promise(resolve => {
        c.once('group-created', resolve)
        c.emit('create-group', { name: '  Alice  ', icon: '🐼' })
      })
      const member = groups[code].members[c.id]
      expect(member.name).toBe('Alice')   // trimmed
      expect(member.icon).toBe('🐼')
    })
  })

  // ─── 2. Multiple users in one group ────────────────────────────────────────

  describe('2 — multiple users in one group', () => {
    it('member count grows by 1 for each join', async () => {
      const [host, c2, c3, c4] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code } = await new Promise(resolve => {
        host.once('group-created', resolve)
        host.emit('create-group', { name: 'Host', icon: '🦊' })
      })
      expect(Object.keys(groups[code].members)).toHaveLength(1)

      for (const [c, name, expectedCount] of [
        [c2, 'Two',   2],
        [c3, 'Three', 3],
        [c4, 'Four',  4],
      ]) {
        await new Promise(resolve => {
          c.once('join-confirmed', resolve)
          c.emit('join-group', { code, name, icon: '🐻' })
        })
        expect(Object.keys(groups[code].members)).toHaveLength(expectedCount)
      }
    })

    it('all existing members receive members-update when a new member joins', async () => {
      const [host, c2, c3] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code } = await new Promise(resolve => {
        host.once('group-created', resolve)
        host.emit('create-group', { name: 'Host', icon: '🦊' })
      })
      await new Promise(resolve => {
        c2.once('join-confirmed', resolve)
        c2.emit('join-group', { code, name: 'Two', icon: '🐻' })
      })

      // c3 joins — both host and c2 should get a 3-member update
      const [hostUpdate, c2Update] = await Promise.all([
        new Promise(resolve => {
          host.on('members-update', function h(list) {
            if (list.length === 3) { host.off('members-update', h); resolve(list) }
          })
        }),
        new Promise(resolve => {
          c2.on('members-update', function h(list) {
            if (list.length === 3) { c2.off('members-update', h); resolve(list) }
          })
        }),
        new Promise(resolve => {
          c3.once('join-confirmed', resolve)
          c3.emit('join-group', { code, name: 'Three', icon: '🦁' })
        }),
      ])

      expect(hostUpdate).toHaveLength(3)
      expect(c2Update).toHaveLength(3)
    })

    it('non-host member leaving does not change the host', async () => {
      const [host, member] = await Promise.all([connect(serverUrl), connect(serverUrl)])

      const { code } = await new Promise(resolve => {
        host.once('group-created', resolve)
        host.emit('create-group', { name: 'Host', icon: '🦊' })
      })
      await new Promise(resolve => {
        member.once('join-confirmed', resolve)
        member.emit('join-group', { code, name: 'Leaver', icon: '🐻' })
      })

      const hostIdBefore = groups[code].hostSocketId

      await new Promise(resolve => {
        host.on('members-update', function h(list) {
          if (list.length === 1) { host.off('members-update', h); resolve(list) }
        })
        member.emit('leave-group')
      })

      expect(groups[code].hostSocketId).toBe(hostIdBefore)
      expect(groups[code].hostSocketId).toBe(host.id)
    })

    it('remaining members receive members-update when a non-host leaves', async () => {
      const [host, c2, leaver] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code } = await new Promise(resolve => {
        host.once('group-created', resolve)
        host.emit('create-group', { name: 'Host', icon: '🦊' })
      })
      for (const [c, name] of [[c2, 'Two'], [leaver, 'Leaver']]) {
        await new Promise(resolve => {
          c.once('join-confirmed', resolve)
          c.emit('join-group', { code, name, icon: '🐻' })
        })
      }

      const [hostUpdate, c2Update] = await Promise.all([
        new Promise(resolve => {
          host.on('members-update', function h(list) {
            if (list.length === 2) { host.off('members-update', h); resolve(list) }
          })
        }),
        new Promise(resolve => {
          c2.on('members-update', function h(list) {
            if (list.length === 2) { c2.off('members-update', h); resolve(list) }
          })
        }),
        Promise.resolve(leaver.emit('leave-group')),
      ])

      expect(hostUpdate.find(m => m.socketId === leaver.id)).toBeUndefined()
      expect(c2Update.find(m => m.socketId === leaver.id)).toBeUndefined()
    })

    it('a location update is visible to all 4 group members', async () => {
      const clients = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])
      const [c1, c2, c3, c4] = clients

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
      // Drain the members-update triggered by c4 joining so the listeners below
      // only fire for the subsequent location update.
      await Promise.all([
        new Promise(resolve => {
          c2.on('members-update', function h(l) { if (l.length === 4) { c2.off('members-update', h); resolve() } })
        }),
        new Promise(resolve => {
          c3.on('members-update', function h(l) { if (l.length === 4) { c3.off('members-update', h); resolve() } })
        }),
        new Promise(resolve => {
          c4.once('join-confirmed', resolve)
          c4.emit('join-group', { code, name: 'Four', icon: '🐻' })
        }),
      ])

      // c1 sends a location — all others should receive members-update with c1's position
      const updates = await Promise.all([
        once(c2, 'members-update'),
        once(c3, 'members-update'),
        once(c4, 'members-update'),
        Promise.resolve(c1.emit('location-update', { lat: 35.6762, lng: 139.6503 })),
      ])

      for (const list of updates.slice(0, 3)) {
        const c1Entry = list.find(m => m.socketId === c1.id)
        expect(c1Entry.lat).toBe(35.6762)
        expect(c1Entry.lng).toBe(139.6503)
      }
    })

    it('host-changed is sent to all remaining members when host disconnects', async () => {
      const [host, c2, c3] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code } = await new Promise(resolve => {
        host.once('group-created', resolve)
        host.emit('create-group', { name: 'Host', icon: '🦊' })
      })
      for (const [c, name] of [[c2, 'Two'], [c3, 'Three']]) {
        await new Promise(resolve => {
          c.once('join-confirmed', resolve)
          c.emit('join-group', { code, name, icon: '🐻' })
        })
      }

      const [c2Event, c3Event] = await Promise.all([
        once(c2, 'host-changed'),
        once(c3, 'host-changed'),
        Promise.resolve(host.disconnect()),
      ])

      expect(c2Event.newHostSocketId).toBe(c3Event.newHostSocketId)
      expect(c2Event.status).toBe(200)
    })

    it('remove-member on all non-host members eventually leaves solo host', async () => {
      const [host, c2, c3] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code } = await new Promise(resolve => {
        host.once('group-created', resolve)
        host.emit('create-group', { name: 'Host', icon: '🦊' })
      })
      for (const [c, name] of [[c2, 'Two'], [c3, 'Three']]) {
        await new Promise(resolve => {
          c.once('join-confirmed', resolve)
          c.emit('join-group', { code, name, icon: '🐻' })
        })
      }

      await Promise.all([
        once(c2, 'removed-from-group'),
        Promise.resolve(host.emit('remove-member', { targetSocketId: c2.id })),
      ])
      await Promise.all([
        once(c3, 'removed-from-group'),
        Promise.resolve(host.emit('remove-member', { targetSocketId: c3.id })),
      ])

      expect(Object.keys(groups[code].members)).toHaveLength(1)
      expect(groups[code].members[host.id]).toBeDefined()
    })
  })

  // ─── 3. Multiple groups, one user each ─────────────────────────────────────

  describe('3 — multiple groups, one user each', () => {
    it('two groups exist independently in memory', async () => {
      const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

      const { code: code1 } = await new Promise(resolve => {
        c1.once('group-created', resolve)
        c1.emit('create-group', { name: 'Alice', icon: '🦊' })
      })
      const { code: code2 } = await new Promise(resolve => {
        c2.once('group-created', resolve)
        c2.emit('create-group', { name: 'Bob', icon: '🐻' })
      })

      expect(code1).not.toBe(code2)
      expect(groups[code1]).toBeDefined()
      expect(groups[code2]).toBeDefined()
      expect(Object.keys(groups[code1].members)).toHaveLength(1)
      expect(Object.keys(groups[code2].members)).toHaveLength(1)
    })

    it('location update in group A does not broadcast to user in group B', async () => {
      const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

      await new Promise(resolve => { c1.once('group-created', resolve); c1.emit('create-group', { name: 'Alice', icon: '🦊' }) })
      await new Promise(resolve => { c2.once('group-created', resolve); c2.emit('create-group', { name: 'Bob', icon: '🐻' }) })

      c1.emit('location-update', { lat: 10, lng: 10 })
      const leaked = await maybeOnce(c2, 'members-update', 300)
      expect(leaked).toBeNull()
    })

    it('ending group A does not send group-ended to user in group B', async () => {
      const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

      const { code: code1 } = await new Promise(resolve => { c1.once('group-created', resolve); c1.emit('create-group', { name: 'Alice', icon: '🦊' }) })
      await new Promise(resolve => { c2.once('group-created', resolve); c2.emit('create-group', { name: 'Bob', icon: '🐻' }) })

      c1.emit('end-group')
      const leaked = await maybeOnce(c2, 'group-ended', 300)
      expect(leaked).toBeNull()
      expect(groups[code1]).toBeUndefined()
    })

    it('/health activeGroups count reflects both groups', async () => {
      const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

      await new Promise(resolve => { c1.once('group-created', resolve); c1.emit('create-group', { name: 'Alice', icon: '🦊' }) })
      await new Promise(resolve => { c2.once('group-created', resolve); c2.emit('create-group', { name: 'Bob', icon: '🐻' }) })

      const res = await fetch(`${baseUrl}/health`)
      const body = await res.json()
      expect(body.activeGroups).toBeGreaterThanOrEqual(2)
    })

    it('three independent groups each have their own host', async () => {
      const clients = await Promise.all([connect(serverUrl), connect(serverUrl), connect(serverUrl)])
      const codes = []
      for (const c of clients) {
        const { code } = await new Promise(resolve => {
          c.once('group-created', resolve)
          c.emit('create-group', { name: 'User', icon: '🦊' })
        })
        codes.push(code)
      }

      const [a, b, c] = codes
      expect(new Set(codes).size).toBe(3)
      expect(groups[a].hostSocketId).toBe(clients[0].id)
      expect(groups[b].hostSocketId).toBe(clients[1].id)
      expect(groups[c].hostSocketId).toBe(clients[2].id)
    })

    it('leaving one group leaves the other group intact', async () => {
      const [c1, c2] = await Promise.all([connect(serverUrl), connect(serverUrl)])

      const { code: code1 } = await new Promise(resolve => { c1.once('group-created', resolve); c1.emit('create-group', { name: 'Alice', icon: '🦊' }) })
      const { code: code2 } = await new Promise(resolve => { c2.once('group-created', resolve); c2.emit('create-group', { name: 'Bob', icon: '🐻' }) })

      await new Promise(resolve => { c1.once('left-group', resolve); c1.emit('leave-group') })

      expect(groups[code1]).toBeUndefined()
      expect(groups[code2]).toBeDefined()
    })
  })

  // ─── 4. Multiple groups, multiple users each ───────────────────────────────

  describe('4 — multiple groups, multiple users each', () => {
    it('two groups run concurrently without cross-contamination of member lists', async () => {
      const [a1, a2, b1, b2] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code: codeA } = await new Promise(resolve => { a1.once('group-created', resolve); a1.emit('create-group', { name: 'A1', icon: '🦊' }) })
      const { code: codeB } = await new Promise(resolve => { b1.once('group-created', resolve); b1.emit('create-group', { name: 'B1', icon: '🦊' }) })

      await new Promise(resolve => { a2.once('join-confirmed', resolve); a2.emit('join-group', { code: codeA, name: 'A2', icon: '🐻' }) })
      await new Promise(resolve => { b2.once('join-confirmed', resolve); b2.emit('join-group', { code: codeB, name: 'B2', icon: '🐻' }) })

      expect(Object.keys(groups[codeA].members)).toHaveLength(2)
      expect(Object.keys(groups[codeB].members)).toHaveLength(2)

      const aIds = Object.keys(groups[codeA].members)
      const bIds = Object.keys(groups[codeB].members)
      expect(aIds.some(id => bIds.includes(id))).toBe(false)
    })

    it('location update in group A is invisible to group B members', async () => {
      const [a1, a2, b1, b2] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code: codeA } = await new Promise(resolve => { a1.once('group-created', resolve); a1.emit('create-group', { name: 'A1', icon: '🦊' }) })
      const { code: codeB } = await new Promise(resolve => { b1.once('group-created', resolve); b1.emit('create-group', { name: 'B1', icon: '🦊' }) })
      await new Promise(resolve => { a2.once('join-confirmed', resolve); a2.emit('join-group', { code: codeA, name: 'A2', icon: '🐻' }) })
      // Drain b1's members-update from b2 joining before arming the leak check.
      await Promise.all([
        once(b1, 'members-update'),
        new Promise(resolve => { b2.once('join-confirmed', resolve); b2.emit('join-group', { code: codeB, name: 'B2', icon: '🐻' }) }),
      ])

      a1.emit('location-update', { lat: 99, lng: 99 })
      const b1Leak = await maybeOnce(b1, 'members-update', 300)
      const b2Leak = await maybeOnce(b2, 'members-update', 300)
      expect(b1Leak).toBeNull()
      expect(b2Leak).toBeNull()
    })

    it('end-group in group A does not affect group B members', async () => {
      const [a1, a2, b1, b2] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code: codeA } = await new Promise(resolve => { a1.once('group-created', resolve); a1.emit('create-group', { name: 'A1', icon: '🦊' }) })
      const { code: codeB } = await new Promise(resolve => { b1.once('group-created', resolve); b1.emit('create-group', { name: 'B1', icon: '🦊' }) })
      await new Promise(resolve => { a2.once('join-confirmed', resolve); a2.emit('join-group', { code: codeA, name: 'A2', icon: '🐻' }) })
      await new Promise(resolve => { b2.once('join-confirmed', resolve); b2.emit('join-group', { code: codeB, name: 'B2', icon: '🐻' }) })

      await Promise.all([once(a1, 'group-ended'), once(a2, 'group-ended'), Promise.resolve(a1.emit('end-group'))])

      expect(groups[codeA]).toBeUndefined()
      expect(groups[codeB]).toBeDefined()

      const b1Leak = await maybeOnce(b1, 'group-ended', 300)
      const b2Leak = await maybeOnce(b2, 'group-ended', 300)
      expect(b1Leak).toBeNull()
      expect(b2Leak).toBeNull()
    })

    it('host disconnecting in group A does not affect group B', async () => {
      const [a1, a2, b1, b2] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code: codeA } = await new Promise(resolve => { a1.once('group-created', resolve); a1.emit('create-group', { name: 'A1', icon: '🦊' }) })
      const { code: codeB } = await new Promise(resolve => { b1.once('group-created', resolve); b1.emit('create-group', { name: 'B1', icon: '🦊' }) })
      await new Promise(resolve => { a2.once('join-confirmed', resolve); a2.emit('join-group', { code: codeA, name: 'A2', icon: '🐻' }) })
      await new Promise(resolve => { b2.once('join-confirmed', resolve); b2.emit('join-group', { code: codeB, name: 'B2', icon: '🐻' }) })

      const b1HostBefore = groups[codeB].hostSocketId

      await Promise.all([once(a2, 'host-changed'), Promise.resolve(a1.disconnect())])

      // Group B host is unchanged
      expect(groups[codeB].hostSocketId).toBe(b1HostBefore)
      // No cross-group host-changed leaked
      const b2Leak = await maybeOnce(b2, 'host-changed', 300)
      expect(b2Leak).toBeNull()
    })

    it('remove-member in group A does not disconnect group B users', async () => {
      const [a1, a2, b1, b2] = await Promise.all([
        connect(serverUrl), connect(serverUrl), connect(serverUrl), connect(serverUrl),
      ])

      const { code: codeA } = await new Promise(resolve => { a1.once('group-created', resolve); a1.emit('create-group', { name: 'A1', icon: '🦊' }) })
      const { code: codeB } = await new Promise(resolve => { b1.once('group-created', resolve); b1.emit('create-group', { name: 'B1', icon: '🦊' }) })
      await new Promise(resolve => { a2.once('join-confirmed', resolve); a2.emit('join-group', { code: codeA, name: 'A2', icon: '🐻' }) })
      await new Promise(resolve => { b2.once('join-confirmed', resolve); b2.emit('join-group', { code: codeB, name: 'B2', icon: '🐻' }) })

      await Promise.all([
        once(a2, 'removed-from-group'),
        Promise.resolve(a1.emit('remove-member', { targetSocketId: a2.id })),
      ])

      const b2Leak = await maybeOnce(b2, 'removed-from-group', 300)
      expect(b2Leak).toBeNull()
      expect(groups[codeB].members[b2.id]).toBeDefined()
    })

    it('three groups with two members each all track locations independently', async () => {
      const pairs = await Promise.all([
        Promise.all([connect(serverUrl), connect(serverUrl)]),
        Promise.all([connect(serverUrl), connect(serverUrl)]),
        Promise.all([connect(serverUrl), connect(serverUrl)]),
      ])

      const codes = []
      for (const [host, member] of pairs) {
        const { code } = await new Promise(resolve => {
          host.once('group-created', resolve)
          host.emit('create-group', { name: 'Host', icon: '🦊' })
        })
        await new Promise(resolve => {
          member.once('join-confirmed', resolve)
          member.emit('join-group', { code, name: 'Member', icon: '🐻' })
        })
        codes.push(code)
      }

      // Each host sends a unique lat
      for (const [[host], lat] of pairs.map((p, i) => [p, (i + 1) * 10])) {
        host.emit('location-update', { lat, lng: 0 })
      }
      await new Promise(r => setTimeout(r, 200))

      for (const [i, code] of codes.entries()) {
        const hostMember = groups[code].members[pairs[i][0].id]
        expect(hostMember.lat).toBe((i + 1) * 10)
        // Verify no cross-contamination
        for (const [j, otherCode] of codes.entries()) {
          if (i === j) continue
          const hostInOther = groups[otherCode].members[pairs[i][0].id]
          expect(hostInOther).toBeUndefined()
        }
      }
    })
  })
})
