// Suite: Home — validation edge cases
// Covers whitespace-only name rejection and input length constraints.
// No server required.

describe('Home — validation edge cases', () => {
  beforeEach(() => cy.visit('/'))

  it('a whitespace-only name is rejected with the empty name error', () => {
    cy.get('input[placeholder="Enter your name"]').type('   ')
    cy.get('button[type="submit"]').click()
    cy.contains('Enter your name').should('be.visible')
  })

  it('name input enforces the 16-character limit via maxlength', () => {
    cy.get('input[placeholder="Enter your name"]').should('have.attr', 'maxlength', '16')
  })

  it('group code input enforces the 6-character limit via maxlength', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').should('have.attr', 'maxlength', '6')
  })
})
