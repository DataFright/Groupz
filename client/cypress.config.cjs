const { defineConfig } = require('cypress')
const { io } = require('socket.io-client')

const BACKEND_URL = process.env.CYPRESS_BACKEND_URL || 'http://localhost:3001'

// Module-level socket kept alive for the duration of a test suite when
// createGroupAndHold is used. Released by the releaseGroupSocket task.
let heldSocket = null

// Second held socket for tests where the browser is the host and a task
// member joins as a non-host. Released by the releaseJoinSocket task.
let heldJoinSocket = null

// Named socket pool for scenario tests that need multiple concurrent task
// sockets across one or more groups. Keyed by caller-supplied id string.
let socketPool = {}

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    // Mobile viewport matches the primary use case (road trips, phones)
    viewportWidth: 390,
    viewportHeight: 844,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 8000,

    setupNodeEvents(on) {
      on('task', {
        // Creates a group on the real server and immediately disconnects.
        // Returns the 6-char group code.
        createGroup({ name = 'Task Host', icon = '🦊' } = {}) {
          return new Promise((resolve, reject) => {
            const socket = io(BACKEND_URL, { reconnection: false })
            const t = setTimeout(() => { socket.disconnect(); reject(new Error('createGroup timed out')) }, 20000)
            socket.once('group-created', ({ code }) => { clearTimeout(t); socket.disconnect(); resolve(code) })
            socket.once('connect_error', err => { clearTimeout(t); reject(err) })
            socket.once('connect', () => socket.emit('create-group', { name, icon }))
          })
        },

        // Creates a group and keeps the host socket alive so tests can join
        // as a non-host. Call releaseGroupSocket in afterEach / after to clean up.
        createGroupAndHold({ name = 'Task Host', icon = '🦊' } = {}) {
          return new Promise((resolve, reject) => {
            heldSocket = io(BACKEND_URL, { reconnection: false })
            const t = setTimeout(() => { heldSocket?.disconnect(); heldSocket = null; reject(new Error('createGroupAndHold timed out')) }, 20000)
            heldSocket.once('group-created', ({ code }) => { clearTimeout(t); resolve(code) })
            heldSocket.once('connect_error', err => { clearTimeout(t); reject(err) })
            heldSocket.once('connect', () => heldSocket.emit('create-group', { name, icon }))
          })
        },

        // Disconnects and releases the held host socket.
        releaseGroupSocket() {
          heldSocket?.disconnect()
          heldSocket = null
          return null
        },

        // Joins an existing group and keeps the member socket alive so tests
        // can observe the group from the host's perspective in the browser.
        // Pass lat/lng to immediately emit a location-update after joining.
        // Returns the joined member's socketId.
        joinGroupAndHold({ code, name = 'Task Member', icon = '🐸', lat = null, lng = null } = {}) {
          return new Promise((resolve, reject) => {
            heldJoinSocket = io(BACKEND_URL, { reconnection: false })
            const t = setTimeout(() => { heldJoinSocket?.disconnect(); heldJoinSocket = null; reject(new Error('joinGroupAndHold timed out')) }, 20000)
            heldJoinSocket.once('join-confirmed', ({ socketId }) => {
              clearTimeout(t)
              if (lat !== null && lng !== null) {
                heldJoinSocket.emit('location-update', { lat, lng })
              }
              resolve(socketId)
            })
            heldJoinSocket.once('join-error', ({ message }) => { clearTimeout(t); heldJoinSocket = null; reject(new Error(message)) })
            heldJoinSocket.once('connect_error', err => { clearTimeout(t); reject(err) })
            heldJoinSocket.once('connect', () => heldJoinSocket.emit('join-group', { code, name, icon }))
          })
        },

        // Disconnects and releases the held join socket.
        releaseJoinSocket() {
          heldJoinSocket?.disconnect()
          heldJoinSocket = null
          return null
        },

        // Creates a group from Node, stores the socket in the pool under id,
        // and resolves with the 6-char group code.
        createGroupInPool({ id, name = 'Task Host', icon = '🦊' } = {}) {
          return new Promise((resolve, reject) => {
            const socket = io(BACKEND_URL, { reconnection: false })
            const t = setTimeout(() => { socket.disconnect(); reject(new Error('createGroupInPool timed out')) }, 20000)
            socket.once('group-created', ({ code }) => { clearTimeout(t); socketPool[id] = socket; resolve(code) })
            socket.once('connect_error', err => { clearTimeout(t); reject(err) })
            socket.once('connect', () => socket.emit('create-group', { name, icon }))
          })
        },

        // Joins an existing group from Node, stores the socket in the pool
        // under id, and resolves with the joined member's socketId.
        // Pass lat/lng to immediately emit a location-update after joining.
        joinGroupInPool({ id, code, name = 'Task Member', icon = '🐸', lat = null, lng = null } = {}) {
          return new Promise((resolve, reject) => {
            const socket = io(BACKEND_URL, { reconnection: false })
            const t = setTimeout(() => { socket.disconnect(); reject(new Error('joinGroupInPool timed out')) }, 20000)
            socket.once('join-confirmed', ({ socketId }) => {
              clearTimeout(t)
              socketPool[id] = socket
              if (lat !== null && lng !== null) socket.emit('location-update', { lat, lng })
              resolve(socketId)
            })
            socket.once('join-error', ({ message }) => { clearTimeout(t); reject(new Error(message)) })
            socket.once('connect_error', err => { clearTimeout(t); reject(err) })
            socket.once('connect', () => socket.emit('join-group', { code, name, icon }))
          })
        },

        // Disconnects and removes one socket from the pool by id.
        releasePoolSocket({ id } = {}) {
          socketPool[id]?.disconnect()
          delete socketPool[id]
          return null
        },

        // Disconnects and clears all pool sockets.
        releaseAllPoolSockets() {
          Object.values(socketPool).forEach(s => s?.disconnect())
          socketPool = {}
          return null
        },

        // Joins `count` members into an existing group in parallel, storing each
        // socket in the pool under ids 'fill_0', 'fill_1', … 'fill_N'.
        // Used to fill a group to capacity without slow sequential task chains.
        fillGroupWithMembers({ code, count = 19, icon = '🐻' } = {}) {
          const joins = Array.from({ length: count }, (_, i) =>
            new Promise((resolve, reject) => {
              const socket = io(BACKEND_URL, { reconnection: false })
              const t = setTimeout(() => { socket.disconnect(); reject(new Error(`fillGroupWithMembers slot ${i} timed out`)) }, 20000)
              socket.once('join-confirmed', () => { clearTimeout(t); socketPool[`fill_${i}`] = socket; resolve() })
              socket.once('join-error', ({ message }) => { clearTimeout(t); socket.disconnect(); reject(new Error(`slot ${i}: ${message}`)) })
              socket.once('connect_error', err => { clearTimeout(t); reject(err) })
              socket.once('connect', () => socket.emit('join-group', { code, name: `Fill${i}`, icon }))
            })
          )
          return Promise.all(joins).then(() => null)
        },
      })
    },
  },
})
