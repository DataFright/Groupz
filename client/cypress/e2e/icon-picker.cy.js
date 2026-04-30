// Suite: Home — icon picker
// Covers icon selection behaviour in the Create/Join form.
// No server required.

describe('Home — icon picker', () => {
  beforeEach(() => cy.visit('/'))

  it('the first icon (🦊) is selected by default', () => {
    cy.get('button[aria-label="🦊"]')
      .invoke('attr', 'class')
      .should('include', 'selected')
  })

  it('clicking a different icon selects it and deselects the previous one', () => {
    cy.get('button[aria-label="🐸"]').click()
    cy.get('button[aria-label="🐸"]').invoke('attr', 'class').should('include', 'selected')
    cy.get('button[aria-label="🦊"]').invoke('attr', 'class').should('not.include', 'selected')
  })

  it('selected icon persists when switching between Create and Join tabs', () => {
    cy.get('button[aria-label="🚀"]').click()
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('button[aria-label="🚀"]').invoke('attr', 'class').should('include', 'selected')
    cy.contains('button[type="button"]', 'Create Group').click()
    cy.get('button[aria-label="🚀"]').invoke('attr', 'class').should('include', 'selected')
  })
})
