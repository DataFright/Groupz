// Suite: Member list — multi-member behaviour
// Covers the Members drawer when more than one person is in the group.
// Requires both servers.

// ── Host perspective ──────────────────────────────────────────────────────────
// Browser creates the group (Alice = host); a task socket joins as Bob.

describe('Member list — host perspective', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
    // Extract the displayed code so the task can join the same group
    cy.contains(/^[A-F0-9]{6}$/)
      .invoke('text')
      .then(code => cy.task('joinGroupAndHold', { code, name: 'Bob', icon: '🐸' }))
    cy.contains('2 members', { timeout: 8000 }).should('be.visible')
    cy.get('[aria-label="Members"]').click()
  })

  afterEach(() => cy.task('releaseJoinSocket'))

  it('both members appear in the drawer', () => {
    cy.contains('Alice').should('be.visible')
    cy.contains('Bob').should('be.visible')
  })

  it('own entry shows the You badge', () => {
    cy.contains('li', 'Alice').contains('You').should('be.visible')
  })

  it('own entry shows the HOST badge', () => {
    cy.contains('li', 'Alice').contains('HOST').should('be.visible')
  })

  it('host sees a remove button for the non-host member', () => {
    cy.get('[aria-label="Remove Bob"]').should('be.visible')
  })

  it('host does not see a remove button for their own entry', () => {
    cy.get('[aria-label="Remove Alice"]').should('not.exist')
  })

  it('removing a member drops the count and removes them from the drawer', () => {
    cy.get('[aria-label="Remove Bob"]').click()
    cy.contains('Bob').should('not.exist')
    cy.contains('Members (1)').should('be.visible')
  })
})

// ── Non-host perspective ──────────────────────────────────────────────────────
// Task socket creates the group (Task Host); browser joins as Bob.

describe('Member list — non-host perspective', () => {
  let groupCode

  before(() => {
    cy.task('createGroupAndHold', { name: 'Task Host', icon: '🦊' }).then(code => {
      groupCode = code
    })
  })

  after(() => cy.task('releaseGroupSocket'))

  beforeEach(() => {
    cy.visitWithGeo()
    cy.joinGroupViaUI(groupCode, 'Bob')
    cy.contains('2 members', { timeout: 8000 }).should('be.visible')
    cy.get('[aria-label="Members"]').click()
  })

  it('non-host does not see any remove buttons', () => {
    cy.get('[aria-label^="Remove"]').should('not.exist')
  })

  it('the task host entry shows the HOST badge', () => {
    cy.contains('li', 'Task Host').contains('HOST').should('be.visible')
  })

  it('own entry shows the You badge', () => {
    cy.contains('li', 'Bob').contains('You').should('be.visible')
  })
})
