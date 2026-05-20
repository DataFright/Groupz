// Suite: Scenarios — real-world group configurations
// Verifies the four core usage patterns at the UI layer. The server-side unit
// and integration tests already cover socket-level correctness for these
// shapes; these tests confirm the browser renders the right state for each.
// All scenarios require both servers.

// ── Scenario 1: Single user in a group ───────────────────────────────────────

describe('Scenario 1 — single user in a group', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
  })

  it('member count shows 1 while alone', () => {
    cy.contains('1 member').should('be.visible')
  })

  it('members drawer shows only the current user with HOST and You badges', () => {
    cy.get('[aria-label="Members"]').click()
    cy.contains('Members (1)').should('be.visible')
    cy.contains('li', 'Alice').contains('HOST').should('be.visible')
    cy.contains('li', 'Alice').contains('You').should('be.visible')
  })

  it('solo host ending the group returns to the home screen', () => {
    cy.contains('button', 'End Group').click()
    cy.contains('End this group for everyone?').parent().contains('button', 'End Group').click()
    cy.contains('h1', 'Groupz', { timeout: 10000 }).should('be.visible')
  })
})

// ── Scenario 2: Multiple users in one group ───────────────────────────────────
// Browser is the host (Alice); two task sockets join as Bob and Charlie.

describe('Scenario 2 — multiple users in one group', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
    cy.contains(/^[A-F0-9]{6}$/).invoke('text').then(code => {
      cy.task('joinGroupInPool', { id: 'bob',     code, name: 'Bob',     icon: '🐸' })
      cy.task('joinGroupInPool', { id: 'charlie', code, name: 'Charlie', icon: '🦁' })
    })
    cy.contains('3 members', { timeout: 8000 }).should('be.visible')
  })

  afterEach(() => cy.task('releaseAllPoolSockets'))

  it('member count reflects all three members', () => {
    cy.contains('3 members').should('be.visible')
  })

  it('members drawer lists all three members', () => {
    cy.get('[aria-label="Members"]').click()
    cy.contains('Members (3)').should('be.visible')
    cy.contains('Alice').should('be.visible')
    cy.contains('Bob').should('be.visible')
    cy.contains('Charlie').should('be.visible')
  })

  it('member count decreases when one task member disconnects', () => {
    cy.task('releasePoolSocket', { id: 'bob' })
    cy.contains('2 members', { timeout: 8000 }).should('be.visible')
  })

  it('host ending the group returns to the home screen', () => {
    cy.contains('button', 'End Group').click()
    cy.contains('End this group for everyone?').parent().contains('button', 'End Group').click()
    cy.contains('h1', 'Groupz', { timeout: 10000 }).should('be.visible')
  })
})

// ── Scenario 3: Multiple groups, one user each ────────────────────────────────
// A task socket holds a separate group (group B) while the browser is in group A.

describe('Scenario 3 — multiple groups, one user each', () => {
  beforeEach(() => {
    cy.task('createGroupInPool', { id: 'groupB', name: 'User B', icon: '🐻' })
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
  })

  afterEach(() => cy.task('releaseAllPoolSockets'))

  it("browser group shows only its own member — not the other group's user", () => {
    cy.get('[aria-label="Members"]').click()
    cy.contains('Members (1)').should('be.visible')
    cy.contains('Alice').should('be.visible')
    cy.contains('User B').should('not.exist')
  })

  it('the server health endpoint reports at least 2 active groups', () => {
    // at.least rather than eq — other specs in the run may have live groups too
    cy.request('http://localhost:3001/health')
      .its('body.activeGroups')
      .should('be.at.least', 2)
  })
})

// ── Scenario 4: Multiple groups, multiple users each ─────────────────────────
// Group B has two task sockets (host + member). Group A has the browser (Alice)
// plus one task member. Neither group should see the other's users.

describe('Scenario 4 — multiple groups, multiple users each', () => {
  beforeEach(() => {
    // Set up group B with two task sockets
    cy.task('createGroupInPool', { id: 'hostB', name: 'Host B', icon: '🐻' }).then(codeB => {
      cy.task('joinGroupInPool', { id: 'memberB', code: codeB, name: 'Member B', icon: '🦁' })
    })
    // Browser creates group A; a task member joins it
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
    cy.contains(/^[A-F0-9]{6}$/).invoke('text').then(codeA => {
      cy.task('joinGroupInPool', { id: 'memberA', code: codeA, name: 'Member A', icon: '🐸' })
    })
    cy.contains('2 members', { timeout: 8000 }).should('be.visible')
  })

  afterEach(() => cy.task('releaseAllPoolSockets'))

  it("browser group A only shows its own two members — not group B's users", () => {
    cy.get('[aria-label="Members"]').click()
    cy.contains('Members (2)').should('be.visible')
    cy.contains('Alice').should('be.visible')
    cy.contains('Member A').should('be.visible')
    cy.contains('Host B').should('not.exist')
    cy.contains('Member B').should('not.exist')
  })

  it('the server health endpoint reports at least 2 active groups', () => {
    // at.least rather than eq — other specs in the run may have live groups too
    cy.request('http://localhost:3001/health')
      .its('body.activeGroups')
      .should('be.at.least', 2)
  })
})
