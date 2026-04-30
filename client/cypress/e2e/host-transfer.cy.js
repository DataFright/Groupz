// Suite: Host transfer
// Covers the host-changed event: when the original host disconnects, the
// remaining member receives host controls automatically.
// Requires both servers.

describe('Host transfer', () => {
  // Create a fresh group for each test so releasing the socket in one test
  // does not pollute the next.
  beforeEach(() => {
    cy.visitWithGeo()
    cy.task('createGroupAndHold').then(code => {
      cy.joinGroupViaUI(code, 'Alice')
    })
  })

  afterEach(() => cy.task('releaseGroupSocket'))

  it('non-host gains the End Group button after the original host disconnects', () => {
    cy.contains('button', 'End Group').should('not.exist')
    cy.task('releaseGroupSocket')
    cy.contains('button', 'End Group', { timeout: 8000 }).should('be.visible')
  })

  it('member count drops to 1 after the host disconnects', () => {
    cy.contains('2 members').should('be.visible')
    cy.task('releaseGroupSocket')
    cy.contains('1 member', { timeout: 8000 }).should('be.visible')
  })
})
