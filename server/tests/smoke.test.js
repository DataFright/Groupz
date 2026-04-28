import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { io as Client } from 'socket.io-client'
import { createApp } from '../src/app.js'

describe('Smoke tests', () => {
  let httpServer, io, cleanupTimer, serverUrl

  beforeAll(async () => {
    ;({ httpServer, io, cleanupTimer } = createApp({ corsOrigin: '*' }))
    await new Promise(resolve => httpServer.listen(0, resolve))
    serverUrl = `http://localhost:${httpServer.address().port}`
  })

  afterAll(async () => {
    clearInterval(cleanupTimer)
    await new Promise(resolve => io.close(resolve))
    await new Promise(resolve => httpServer.close(resolve))
  })

  it('server starts and listens on a port', () => {
    expect(httpServer.listening).toBe(true)
    expect(httpServer.address().port).toBeGreaterThan(0)
  })

  it('GET /health returns 200 with expected shape', async () => {
    const res = await fetch(`${serverUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('uptime')
    expect(body).toHaveProperty('activeGroups')
    expect(typeof body.activeGroups).toBe('number')
  })

  it('GET /api/groups/UNKNOWN returns 404 with error shape', async () => {
    const res = await fetch(`${serverUrl}/api/groups/UNKNOWN`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.exists).toBe(false)
    expect(body.error.code).toBe('GROUP_NOT_FOUND')
    expect(body.error.status).toBe(404)
  })

  it('a socket client can connect and disconnect cleanly', async () => {
    const client = Client(serverUrl, { reconnection: false })
    await new Promise((resolve, reject) => {
      client.on('connect', resolve)
      client.on('connect_error', reject)
    })
    expect(client.connected).toBe(true)
    // Register disconnect handler BEFORE calling disconnect to avoid the race
    const disconnected = new Promise(resolve => client.on('disconnect', resolve))
    client.disconnect()
    await disconnected
    expect(client.connected).toBe(false)
  })

  it('unknown socket events are silently ignored', async () => {
    const client = Client(serverUrl, { reconnection: false })
    await new Promise(resolve => client.on('connect', resolve))
    // Emitting a bogus event should not crash the server
    client.emit('totally-made-up-event', { foo: 'bar' })
    await new Promise(r => setTimeout(r, 100))
    expect(httpServer.listening).toBe(true)
    client.disconnect()
  })
})
