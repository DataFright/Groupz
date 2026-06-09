// Suite: Create group — map view
// Covers the full create-group flow: form → server → map UI.
// Requires both the Vite dev server (port 3000) and the backend (port 3001).

describe('Create group — map view', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
  })

  it('renders the Leaflet map after creation', () => {
    cy.get('.leaflet-container').should('exist')
  })

  it('shows the north compass indicator', () => {
    cy.get('[aria-label="North is up"]').should('be.visible')
  })

  it('shows the CODE label in the top bar', () => {
    cy.contains('CODE').should('be.visible')
  })

  it('displays a 6-character uppercase group code', () => {
    cy.contains(/^[A-F0-9]{6}$/).should('be.visible')
  })

  it('shows the End Group button for the host', () => {
    cy.contains('button', 'End Group').should('be.visible')
  })

  it('shows the Leave button', () => {
    cy.get('[aria-label="Leave"]').should('be.visible')
  })

  it('shows a member count of 1 member', () => {
    cy.contains('1 member').should('be.visible')
  })
})
