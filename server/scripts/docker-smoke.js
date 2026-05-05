import { exec } from 'child_process'
import { promisify } from 'util'
import http from 'http'
import { io } from 'socket.io-client'
import { fileURLToPath } from 'url'
import path from 'path'

const execAsync = promisify(exec)

const IMAGE     = 'groupz-server-smoke'
const CONTAINER = 'groupz-smoke-test'
const HOST_PORT = 3099
const BASE_URL  = `http://localhost:${HOST_PORT}`
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ✓  ${label}`)
    passed++
  } else {
    console.log(`  ✗  ${label}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')))
  })
}

async function waitForReady(maxMs = 30_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      const { status } = await httpGet(`${BASE_URL}/health`)
      if (status === 200) return true
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function socketConnect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false })
    const t = setTimeout(() => { socket.disconnect(); reject(new Error('connect timeout')) }, 10_000)
    socket.once('connect', () => { clearTimeout(t); resolve(socket) })
    socket.once('connect_error', err => { clearTimeout(t); reject(err) })
  })
}

async function runChecks() {
  // ── 1. Health endpoint ────────────────────────────────────────────────────
  try {
    const { status, body } = await httpGet(`${BASE_URL}/health`)
    check('Health endpoint returns 200 with status ok', status === 200 && body?.status === 'ok')
  } catch (e) {
    check('Health endpoint returns 200 with status ok', false, e.message)
  }

  // ── 2. Socket.IO connects ─────────────────────────────────────────────────
  try {
    const socket = await socketConnect(BASE_URL)
    socket.disconnect()
    check('Socket.IO connects', true)
  } catch (e) {
    check('Socket.IO connects', false, e.message)
  }

  // ── 3. create-group returns a 6-char code ─────────────────────────────────
  // Keep the host socket alive through check 4 — disconnecting it would delete
  // the group (no members left), causing the join to get GROUP_NOT_FOUND.
  let createdCode
  let hostSocket
  try {
    hostSocket = await socketConnect(BASE_URL)
    createdCode = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { hostSocket.disconnect(); reject(new Error('timeout')) }, 8_000)
      hostSocket.once('group-created', ({ code }) => { clearTimeout(t); resolve(code) })
      hostSocket.emit('create-group', { name: 'SmokeHost', icon: '🦊' })
    })
    check('create-group receives group-created with 6-char code',
      typeof createdCode === 'string' && createdCode.length === 6)
  } catch (e) {
    hostSocket?.disconnect()
    hostSocket = null
    check('create-group receives group-created with 6-char code', false, e.message)
  }

  // ── 4. join-group (valid code) ────────────────────────────────────────────
  if (createdCode) {
    try {
      const socket = await socketConnect(BASE_URL)
      const confirmed = await new Promise((resolve, reject) => {
        const t = setTimeout(() => { socket.disconnect(); reject(new Error('timeout')) }, 8_000)
        socket.once('join-confirmed', payload => { clearTimeout(t); resolve(payload) })
        socket.once('join-error',    ({ message }) => { clearTimeout(t); reject(new Error(message)) })
        socket.emit('join-group', { code: createdCode, name: 'SmokeJoiner', icon: '🐸' })
      })
      socket.disconnect()
      check('join-group (valid code) receives join-confirmed', confirmed?.code === createdCode)
    } catch (e) {
      check('join-group (valid code) receives join-confirmed', false, e.message)
    } finally {
      hostSocket?.disconnect()
      hostSocket = null
    }
  }

  // ── 5. join-group (bad code) returns GROUP_NOT_FOUND ─────────────────────
  try {
    const socket = await socketConnect(BASE_URL)
    const errCode = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { socket.disconnect(); reject(new Error('timeout')) }, 8_000)
      socket.once('join-error', ({ code }) => { clearTimeout(t); resolve(code) })
      socket.emit('join-group', { code: 'ZZZZZZ', name: 'SmokeJoiner', icon: '🐸' })
    })
    socket.disconnect()
    check('join-group (bad code) returns GROUP_NOT_FOUND error', errCode === 'GROUP_NOT_FOUND')
  } catch (e) {
    check('join-group (bad code) returns GROUP_NOT_FOUND error', false, e.message)
  }
}

async function main() {
  // Remove any stale container from a previous failed run
  try { await execAsync(`docker rm -f ${CONTAINER}`) } catch { /* nothing to clean */ }

  console.log(`Building image "${IMAGE}"…`)
  await execAsync(`docker build -t ${IMAGE} .`, { cwd: SERVER_DIR })
  console.log('Image built.\n')

  console.log(`Starting container "${CONTAINER}" on port ${HOST_PORT}…`)
  await execAsync(`docker run -d --name ${CONTAINER} -p ${HOST_PORT}:3001 ${IMAGE}`)

  try {
    console.log('Waiting for server to be ready (max 30 s)…')
    const ready = await waitForReady(30_000)
    if (!ready) {
      console.error('Server did not become ready within 30 s')
      process.exitCode = 1
      return
    }
    console.log('Server ready.\n')
    await runChecks()
  } finally {
    console.log('\nCleaning up…')
    try { await execAsync(`docker stop ${CONTAINER}`) } catch { /* ignore */ }
    try { await execAsync(`docker rm ${CONTAINER}`)   } catch { /* ignore */ }
    console.log('Container removed.')
  }

  const total = passed + failed
  console.log(`\n${passed}/${total} checks passed${failed > 0 ? ` — ${failed} FAILED` : ''}`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exitCode = 1
})
