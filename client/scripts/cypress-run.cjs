// Unsets ELECTRON_RUN_AS_NODE before spawning Cypress.
// The Claude Code VS Code extension sets ELECTRON_RUN_AS_NODE=1 so Cypress's
// Electron binary boots in Node.js mode and crashes before the runner starts.
// We delete it from a copy of process.env so only the cypress subprocess is affected.
const { spawnSync } = require('child_process')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const args = process.argv.slice(2)
const result = spawnSync('npx', ['cypress', ...args], { stdio: 'inherit', env, shell: true })
process.exit(result.status ?? 1)
