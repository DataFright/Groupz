// Suite: Mobile — home screen accessibility
// Verifies that all home screen elements are reachable and interactive at the
// default Cypress mobile viewport (390×844, set globally in cypress.config.cjs).
// These tests focus on scrollability and tap-target accessibility — behaviours
// that can break silently on small screens without dedicated coverage.
// No server required — only the Vite dev server needs to be running.

describe('Mobile — home screen accessibility (390×844)', () => {
  beforeEach(() => {
    cy.visit('/')
  })

  it('displays the Groupz title at mobile viewport', () => {
    cy.contains('h1', 'Groupz').should('be.visible')
  })

  it('shows both tab buttons on mobile', () => {
    cy.contains('button[type="button"]', 'Create Group').should('be.visible')
    cy.contains('button[type="button"]', 'Join Group').should('be.visible')
  })

  it('Create Group tab is the default active tab on mobile', () => {
    cy.contains('button[type="submit"]', 'Create Group').should('exist')
  })

  it('the Create Group submit button is reachable on mobile', () => {
    cy.contains('button[type="submit"]', 'Create Group').scrollIntoView().should('be.visible')
  })

  it('the icon picker renders all icons on mobile', () => {
    cy.get('button[aria-label]').should('have.length', 20)
  })

  it('an icon picker button is tappable on mobile', () => {
    cy.get('button[aria-label]').first().click()
    // Clicking an already-selected icon keeps the form functional
    cy.contains('button[type="submit"]', 'Create Group').should('exist')
  })

  it('switching to Join Group tab reveals the code input on mobile', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').should('exist')
  })

  it('all Join tab form elements are present on mobile', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.get('input[placeholder="Enter 6-character code"]').should('exist')
    cy.get('input[placeholder="Enter your name"]').should('exist')
    cy.contains('button[type="submit"]', 'Join Group').should('exist')
  })

  it('the Join Group submit button is reachable by scrolling on mobile', () => {
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.contains('button[type="submit"]', 'Join Group').scrollIntoView().should('be.visible')
  })

  it('form validation triggers inline error on empty name submit', () => {
    cy.contains('button[type="submit"]', 'Create Group').click()
    cy.contains('Enter your name').should('be.visible')
  })

  it('switching tabs on mobile does not lose the typed name', () => {
    cy.get('input[placeholder="Enter your name"]').type('Alice')
    cy.contains('button[type="button"]', 'Join Group').click()
    cy.contains('button[type="button"]', 'Create Group').click()
    cy.get('input[placeholder="Enter your name"]').should('have.value', 'Alice')
  })
})
