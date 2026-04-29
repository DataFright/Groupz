// Suite: Group session — in-session actions
// Covers end-group, leave-group, and the Members drawer while the user is the host.
// Requires both servers.

describe('Group session — in-session actions', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
  })

  // ── End Group ────────────────────────────────────────────────────────────────

  it('clicking End Group opens a confirmation dialog', () => {
    cy.contains('button', 'End Group').first().click()
    cy.contains('End this group for everyone?').should('be.visible')
  })

  it('cancelling the End Group dialog dismisses it without leaving', () => {
    cy.contains('button', 'End Group').first().click()
    cy.contains('button', 'Cancel').click()
    cy.contains('End this group for everyone?').should('not.exist')
    cy.contains('button', 'End Group').should('be.visible')
  })

  it('confirming End Group returns to the home screen', () => {
    cy.contains('button', 'End Group').click()
    cy.contains('End this group for everyone?').should('be.visible')
    cy.contains('End this group for everyone?').parent().contains('button', 'End Group').click()
    cy.contains('h1', 'Groupz', { timeout: 10000 }).should('be.visible')
  })

  // ── Leave Group ───────────────────────────────────────────────────────────────

  it('clicking the Leave button opens a confirmation dialog', () => {
    cy.get('[aria-label="Leave"]').click()
    cy.contains('Leave this group?').should('be.visible')
  })

  it('cancelling the Leave dialog dismisses it without leaving', () => {
    cy.get('[aria-label="Leave"]').click()
    cy.contains('button', 'Cancel').click()
    cy.contains('Leave this group?').should('not.exist')
    cy.get('[aria-label="Leave"]').should('be.visible')
  })

  it('confirming Leave returns to the home screen', () => {
    cy.get('[aria-label="Leave"]').click()
    cy.contains('Leave this group?').should('be.visible')
    cy.contains('button', 'Leave').click()
    cy.contains('h1', 'Groupz', { timeout: 10000 }).should('be.visible')
  })

  // ── Members drawer ────────────────────────────────────────────────────────────

  it('opening the Members drawer shows the current user', () => {
    cy.get('[aria-label="Members"]').click()
    cy.contains('Alice').should('be.visible')
  })
})
