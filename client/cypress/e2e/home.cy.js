// Suite: Home — page rendering
// Covers the static structure of the home screen.
// No server required — only the Vite dev server needs to be running.

describe('Home — page rendering', () => {
  beforeEach(() => cy.visit('/'))

  it('displays the Groupz title', () => {
    cy.contains('h1', 'Groupz').should('be.visible')
  })

  it('displays the app subtitle', () => {
    cy.contains('Live location sharing for groups').should('be.visible')
  })

  it('shows Create Group and Join Group tab buttons', () => {
    cy.contains('button[type="button"]', 'Create Group').should('be.visible')
    cy.contains('button[type="button"]', 'Join Group').should('be.visible')
  })

  it('defaults to the Create Group tab', () => {
    cy.contains('button[type="submit"]', 'Create Group').should('be.visible')
  })

  it('shows the Your Name label and text input', () => {
    cy.contains('label', 'Your Name').should('be.visible')
    cy.get('input[placeholder="Enter your name"]').should('be.visible')
  })

  it('shows the Choose Icon label', () => {
    cy.contains('label', 'Choose Icon').should('be.visible')
  })

  it('renders exactly 20 icon option buttons', () => {
    cy.get('button[aria-label]').should('have.length', 20)
  })
})
