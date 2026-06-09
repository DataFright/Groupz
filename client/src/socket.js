// Singleton Socket.IO client shared across the entire app.
// autoConnect: false — we connect manually on form submit so the socket
// isn't open before the user has decided to create or join a group.

import { io } from 'socket.io-client'

// Empty string falls back to the Vite dev proxy (localhost:3001).
// In production, VITE_SOCKET_URL is set to the Render backend URL.
const URL = import.meta.env.VITE_SOCKET_URL || ''

export const socket = io(URL, {
  autoConnect:          false,
  reconnection:         true,
  reconnectionAttempts: 10,       // give up after ~45 s of retries
  reconnectionDelay:    1500,     // first retry after 1.5 s
  reconnectionDelayMax: 8000,     // back-off cap at 8 s
  timeout:              10000,    // connection timeout per attempt
})
