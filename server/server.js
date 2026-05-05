import 'dotenv/config'
import { createApp } from './src/app.js'

const PORT = process.env.PORT || 3001
const { httpServer } = createApp({
  corsOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  ipRateLimits: {
    createGroup: { max: parseInt(process.env.RATE_LIMIT_CREATE ?? '100') },
    joinGroup:   { max: parseInt(process.env.RATE_LIMIT_JOIN   ?? '300') },
  },
})

httpServer.listen(PORT, () => {
  console.log(`Groupz server running on port ${PORT}`)
})
