// Suite: Re-center map button
// Verifies the 🎯 FAB that flies the map back to the user's location.
// The actual flyTo animation cannot be asserted in headless Chrome, so
// these tests confirm the button exists, is accessible, and does not
// crash the app when clicked.
// Requires both servers.

describe('Re-center map button', () => {
  beforeEach(() => {
    cy.visitWithGeo(51.5074, -0.1278)
    cy.createGroupViaUI('Alice')
  })

  it('is visible on the map screen', () => {
    cy.get('[aria-label="Re-center map"]').should('be.visible')
  })

  it('clicking it leaves the map and other controls intact', () => {
    cy.get('[aria-label="Re-center map"]').click()
    cy.get('.leaflet-container').should('exist')
    cy.get('[aria-label="Members"]').should('be.visible')
    cy.get('[aria-label="Leave"]').should('be.visible')
  })

  it('clicking it before the first location fix resolves silently', () => {
    // flyToMeRef.current is null until the first geolocation success;
    // clicking early should not throw — the optional-chain guard handles it.
    // We test by clicking immediately (before the 2500 ms interval fires) and
    // asserting the app is still functional.
    cy.get('[aria-label="Re-center map"]').click()
    cy.contains(/^[A-F0-9]{6}$/).should('be.visible')
  })
})
