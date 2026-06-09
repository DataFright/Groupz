import { io } from 'socket.io-client'

const URL = import.meta.env.VITE_SOCKET_URL || ''

export const socket = io(URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 8000,
  timeout: 10000,
})
