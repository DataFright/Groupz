const { defineConfig } = require('cypress')
const { io } = require('socket.io-client')

// Module-level socket kept alive for the duration of a test suite when
// createGroupAndHold is used. Released by the releaseGroupSocket task.
let heldSocket = null

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
            const socket = io('http://localhost:3001', { reconnection: false })
            const t = setTimeout(() => { socket.disconnect(); reject(new Error('createGroup timed out')) }, 8000)
            socket.once('group-created', ({ code }) => { clearTimeout(t); socket.disconnect(); resolve(code) })
            socket.once('connect_error', err => { clearTimeout(t); reject(err) })
            socket.once('connect', () => socket.emit('create-group', { name, icon }))
          })
        },

        // Creates a group and keeps the host socket alive so tests can join
        // as a non-host. Call releaseGroupSocket in afterEach / after to clean up.
        createGroupAndHold({ name = 'Task Host', icon = '🦊' } = {}) {
          return new Promise((resolve, reject) => {
            heldSocket = io('http://localhost:3001', { reconnection: false })
            const t = setTimeout(() => { heldSocket?.disconnect(); heldSocket = null; reject(new Error('createGroupAndHold timed out')) }, 8000)
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
      })
    },
  },
})
