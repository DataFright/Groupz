// Unsets ELECTRON_RUN_AS_NODE before spawning Cypress.
// Needed because Claude Code's shell sets this, which makes the Cypress
// Electron binary behave like bare Node.js and reject its own flags.
const { spawnSync } = require('child_process')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const args = process.argv.slice(2)
const result = spawnSync(
  'node',
  [require.resolve('cypress/bin/cypress'), ...args],
  { stdio: 'inherit', env }
)
process.exit(result.status ?? 1)
