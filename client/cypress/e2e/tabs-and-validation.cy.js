// Suite: Home — tabs and validation
// Covers tab switching behaviour and client-side form validation.
// No server required.

describe('Home — tabs and validation', () => {
  beforeEach(() => cy.visit('/'))

  it('switching to Join Group tab shows the group code input', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').should('be.visible')
  })

  it('switching back to Create tab hides the code input', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.contains('button[type="button"]', 'Create Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').should('not.exist')
  })

  it('the code input auto-uppercases characters as the user types', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').type('abc123')
    cy.get('input[placeholder="Enter 6-character code"]').should('have.value', 'ABC123')
  })

  it('the submit button label changes to Join Group on the Join tab', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.contains('button[type="submit"]', 'Join Group').should('be.visible')
  })

  it('submitting with an empty name shows an error message', () => {
    cy.get('button[type="submit"]').click()
    cy.contains('Enter your name').should('be.visible')
    cy.get('button[type="submit"]').should('not.be.disabled')
  })

  it('submitting on the Join tab without a code shows an error message', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter your name"]').type('Alice')
    cy.get('button[type="submit"]').click()
    cy.contains('Enter the group code').should('be.visible')
  })

  it('switching tabs clears any existing error message', () => {
    cy.get('button[type="submit"]').click()
    cy.contains('Enter your name').should('be.visible')
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.contains('Enter your name').should('not.exist')
  })
})
