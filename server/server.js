import 'dotenv/config'
import { createApp } from './src/app.js'

const PORT = process.env.PORT || 3001
const { httpServer } = createApp({
  corsOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
})

httpServer.listen(PORT, () => {
  console.log(`Groupz server running on port ${PORT}`)
})
