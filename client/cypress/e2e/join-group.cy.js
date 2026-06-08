// Suite: Join group — joining flow
// Covers joining an existing group via the 6-character code.
// Uses cy.task('createGroupAndHold') to keep a host socket alive from Node so the
// browser session joins as a non-host member.
// Requires both servers.

describe('Join group — joining flow', () => {
  let groupCode

  // Create one persistent host group shared across tests in this suite.
  // Each test cy.visit()s fresh, so it re-joins as a new socket session.
  before(() => {
    cy.task('createGroupAndHold').then(code => { groupCode = code })
  })

  after(() => cy.task('releaseGroupSocket'))

  function joinGroup(name = 'Bob') {
    cy.visitWithGeo()
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').type(groupCode)
    cy.get('input[placeholder="Enter your name"]').type(name)
    cy.get('button[type="submit"]').click()
    cy.get('.leaflet-container', { timeout: 10000 }).should('exist')
  }

  it('navigates to the map view when joining with a valid code', () => {
    joinGroup()
  })

  it('non-host joiner sees Leave but not End Group', () => {
    joinGroup()
    cy.get('[aria-label="Leave"]').should('be.visible')
    cy.contains('button', 'End Group').should('not.exist')
  })

  it('member count shows 2 members while the host is still active', () => {
    joinGroup()
    cy.contains('2 members', { timeout: 12000 }).should('be.visible')
  })

  it('the map displays the same code that was used to join', () => {
    joinGroup()
    cy.contains(groupCode).should('be.visible')
  })

  it('shows a Group not found error when the code does not exist', () => {
    cy.visitWithGeo()
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').type('ZZZZZZ')
    cy.get('input[placeholder="Enter your name"]').type('Bob')
    cy.get('button[type="submit"]').click()
    cy.contains('Group not found', { timeout: 10000 }).should('be.visible')
  })
})

describe('Join group — group full', () => {
  after(() => cy.task('releaseAllPoolSockets'))

  it('shows a group full error when the group has reached max capacity (20 members)', () => {
    cy.task('createGroupInPool', { id: 'fullHost', name: 'Host', icon: '🦊' }).then(code => {
      // Fill to 20 members: host (1) + 19 fill sockets = 20 total
      cy.task('fillGroupWithMembers', { code, count: 19 }).then(() => {
        cy.visitWithGeo()
        cy.contains('button[type="button"]', 'Join Group').click()
        cy.get('input[placeholder="Enter 6-character code"]').type(code)
        cy.get('input[placeholder="Enter your name"]').type('Extra')
        cy.get('button[type="submit"]').click()
        cy.contains('group is full', { timeout: 10000, matchCase: false }).should('be.visible')
      })
    })
  })
})
