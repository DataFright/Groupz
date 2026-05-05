import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { validateInput, generateCode, buildMemberList } from './helpers.js'
import { ErrorCode, makeError } from './errorCodes.js'

export function createApp({
  corsOrigin = 'http://localhost:3000',
  cleanupIntervalMs = 60_000,
  maxGroupAgeMs = 16 * 60 * 60 * 1000,
  maxGroupSize = 20,
  ipRateLimits,
} = {}) {
  const rlCreate = { max: ipRateLimits?.createGroup?.max ?? 100, windowMs: ipRateLimits?.createGroup?.windowMs ?? 3_600_000 }
  const rlJoin   = { max: ipRateLimits?.joinGroup?.max  ?? 300, windowMs: ipRateLimits?.joinGroup?.windowMs  ?? 3_600_000 }
  const ipCreateLimits = new Map()
  const ipJoinLimits   = new Map()

  function checkRateLimit(map, ip, { max, windowMs }) {
    const now = Date.now()
    const entry = map.get(ip) ?? { count: 0, windowStart: now }
    if (now - entry.windowStart > windowMs) {
      map.set(ip, { count: 1, windowStart: now })
      return true
    }
    if (entry.count >= max) return false
    entry.count++
    map.set(ip, entry)
    return true
  }

  function getIp(socket) {
    return socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim()
      || socket.handshake.address
  }

  const groups = {}
  const socketToGroup = {}

  const app = express()
  app.use(cors({ origin: corsOrigin }))
  app.use(express.json())

  const httpServer = createServer(app)
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
  })

  // --- REST endpoints ---

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      activeGroups: Object.keys(groups).length,
    })
  })

  app.get('/api/groups/:code', (req, res) => {
    const code = req.params.code.trim().toUpperCase()
    const group = groups[code]
    if (!group) {
      return res.status(404).json({
        exists: false,
        error: makeError(ErrorCode.GROUP_NOT_FOUND, 'Group not found'),
      })
    }
    res.status(200).json({
      exists: true,
      memberCount: Object.keys(group.members).length,
      createdAt: group.createdAt,
    })
  })

  // --- Inactivity cleanup (every 60s) ---

  const cleanupTimer = setInterval(() => {
    const now = Date.now()

    for (const [ip, entry] of ipCreateLimits) {
      if (now - entry.windowStart > rlCreate.windowMs) ipCreateLimits.delete(ip)
    }
    for (const [ip, entry] of ipJoinLimits) {
      if (now - entry.windowStart > rlJoin.windowMs) ipJoinLimits.delete(ip)
    }

    for (const [code, group] of Object.entries(groups)) {
      // Remove members not seen in 60s — covers stuck/zombie sockets that
      // never triggered a disconnect event (e.g. network dropped mid-session).
      for (const member of Object.values(group.members)) {
        if (now - member.lastSeen > 60_000) {
          delete group.members[member.socketId]
          delete socketToGroup[member.socketId]
          const target = io.sockets.sockets.get(member.socketId)
          if (target) {
            target.emit('removed-from-group', { status: 200 })
            target.leave(code)
          }
        }
      }

      if (Object.keys(group.members).length === 0) {
        delete groups[code]
        continue
      }

      // Transfer host if the host was just removed
      if (!group.members[group.hostSocketId]) {
        const newHostId = Object.keys(group.members)[0]
        group.hostSocketId = newHostId
        io.to(code).emit('host-changed', { newHostSocketId: newHostId, status: 200 })
      }

      // Mark remaining members active/inactive based on 10s window
      for (const member of Object.values(group.members)) {
        member.active = now - member.lastSeen <= 10_000
      }

      if (now - group.createdAt > maxGroupAgeMs) {
        io.to(code).emit('group-ended', { status: 200 })
        io.in(code).socketsLeave(code)
        for (const sid of Object.keys(group.members)) delete socketToGroup[sid]
        delete groups[code]
        continue
      }

      if (now - group.lastActivity > 86_400_000) {
        io.to(code).emit('group-ended', { status: 200 })
        io.in(code).socketsLeave(code)
        for (const sid of Object.keys(group.members)) delete socketToGroup[sid]
        delete groups[code]
        continue
      }

      io.to(code).emit('members-update', buildMemberList(group))
    }
  }, cleanupIntervalMs)

  // --- Socket.IO ---

  io.on('connection', (socket) => {

    socket.on('create-group', ({ name, icon } = {}) => {
      if (!checkRateLimit(ipCreateLimits, getIp(socket), rlCreate))
        return socket.emit('join-error', makeError(ErrorCode.RATE_LIMITED, 'Too many groups created. Try again later.'))

      const err = validateInput(name, icon)
      if (err) return socket.emit('join-error', err)

      const code = generateCode(groups)
      if (!code) return socket.emit('join-error', makeError(ErrorCode.SERVER_ERROR, 'Could not generate group code'))

      const now = Date.now()
      groups[code] = {
        code,
        hostSocketId: socket.id,
        createdAt: now,
        lastActivity: now,
        members: {
          [socket.id]: {
            socketId: socket.id,
            name: name.trim(),
            icon,
            lat: null,
            lng: null,
            lastSeen: now,         // updated on every accepted location-update; used for inactivity cleanup
            lastLocationSeen: 0,   // tracks rate limiting only; 0 = no update yet, always passes first check
            active: true,
          }
        }
      }
      socketToGroup[socket.id] = code
      socket.join(code)

      socket.emit('group-created', { code, socketId: socket.id, status: 201 })
      io.to(code).emit('members-update', buildMemberList(groups[code]))
    })

    socket.on('join-group', ({ code: rawCode, name, icon } = {}) => {
      const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
      if (!code) return socket.emit('join-error', makeError(ErrorCode.CODE_REQUIRED, 'Group code is required'))

      if (!checkRateLimit(ipJoinLimits, getIp(socket), rlJoin))
        return socket.emit('join-error', makeError(ErrorCode.RATE_LIMITED, 'Too many join attempts. Try again later.'))

      const err = validateInput(name, icon)
      if (err) return socket.emit('join-error', err)

      const group = groups[code]
      if (!group) return socket.emit('join-error', makeError(ErrorCode.GROUP_NOT_FOUND, 'Group not found'))

      if (!group.members[socket.id] && Object.keys(group.members).length >= maxGroupSize)
        return socket.emit('join-error', makeError(ErrorCode.GROUP_FULL, 'This group is full (max 20 members)'))

      const now = Date.now()
      if (group.members[socket.id]) {
        group.members[socket.id].name = name.trim()
        group.members[socket.id].icon = icon
      } else {
        group.members[socket.id] = {
          socketId: socket.id,
          name: name.trim(),
          icon,
          lat: null,
          lng: null,
          lastSeen: now,
          lastLocationSeen: 0,
          active: true,
        }
      }
      socketToGroup[socket.id] = code
      socket.join(code)

      socket.emit('join-confirmed', { code, socketId: socket.id, hostSocketId: group.hostSocketId, status: 200 })
      io.to(code).emit('members-update', buildMemberList(group))
    })

    socket.on('location-update', ({ lat, lng } = {}) => {
      const code = socketToGroup[socket.id]
      if (!code) return
      const group = groups[code]
      if (!group) return
      if (typeof lat !== 'number' || typeof lng !== 'number') return
      if (!isFinite(lat) || !isFinite(lng)) return
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return

      const member = group.members[socket.id]
      if (!member) return

      const now = Date.now()
      // Drop updates arriving faster than once per second to prevent flooding.
      // Uses lastLocationSeen (not lastSeen) so the first update after joining
      // is never blocked — lastLocationSeen starts at 0.
      if (now - member.lastLocationSeen < 1_000) return

      member.lat = lat
      member.lng = lng
      member.lastSeen = now
      member.lastLocationSeen = now
      member.active = true
      group.lastActivity = now

      io.to(code).emit('members-update', buildMemberList(group))
    })

    socket.on('leave-group', () => handleLeave(socket, false))

    socket.on('remove-member', ({ targetSocketId } = {}) => {
      const code = socketToGroup[socket.id]
      if (!code) return
      const group = groups[code]
      if (!group) return
      if (group.hostSocketId !== socket.id) return
      if (!targetSocketId || targetSocketId === socket.id) return
      if (!group.members[targetSocketId]) return

      delete group.members[targetSocketId]
      delete socketToGroup[targetSocketId]

      const target = io.sockets.sockets.get(targetSocketId)
      if (target) {
        target.emit('removed-from-group', { status: 200 })
        target.leave(code)
      }
      io.to(code).emit('members-update', buildMemberList(group))
    })

    socket.on('end-group', () => {
      const code = socketToGroup[socket.id]
      if (!code) return
      const group = groups[code]
      if (!group) return
      if (group.hostSocketId !== socket.id) return

      io.to(code).emit('group-ended', { status: 200 })
      io.in(code).socketsLeave(code)
      for (const sid of Object.keys(group.members)) delete socketToGroup[sid]
      delete groups[code]
    })

    socket.on('disconnect', () => handleLeave(socket, true))
  })

  function handleLeave(socket, isDisconnect) {
    const code = socketToGroup[socket.id]
    if (!code) return
    const group = groups[code]
    if (!group) return

    delete socketToGroup[socket.id]
    delete group.members[socket.id]

    if (!isDisconnect) {
      socket.leave(code)
      socket.emit('left-group', { status: 200 })
    }

    if (Object.keys(group.members).length === 0) {
      delete groups[code]
      return
    }

    if (group.hostSocketId === socket.id) {
      const newHostId = Object.keys(group.members)[0]
      group.hostSocketId = newHostId
      io.to(code).emit('host-changed', { newHostSocketId: newHostId, status: 200 })
    }

    io.to(code).emit('members-update', buildMemberList(group))
  }

  return { app, httpServer, io, groups, socketToGroup, cleanupTimer, ipCreateLimits, ipJoinLimits }
}
