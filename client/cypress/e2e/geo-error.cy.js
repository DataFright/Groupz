// Suite: Geolocation error — location unavailable banner
// Verifies the yellow warning banner that GroupMap renders when
// navigator.geolocation reports a failure.
// Requires both servers (socket connection needed to enter the map view).

// Shared setup: visit with a geo stub that always fires the error callback.
// The error fires on every interval tick (every 2500 ms), so the banner
// appears within the first interval after the map mounts.
function visitWithGeoError(message = 'User denied Geolocation') {
  cy.visit('/', {
    onBeforeLoad(win) {
      cy.stub(win.navigator.geolocation, 'getCurrentPosition').callsFake((_, error) => {
        error({ message })
      })
    },
  })
}

describe('Geolocation error banner', () => {
  it('appears when geolocation is denied', () => {
    visitWithGeoError()
    cy.createGroupViaUI('Alice')
    cy.contains('Location unavailable', { timeout: 5000 }).should('be.visible')
  })

  it('includes the error message returned by the browser', () => {
    visitWithGeoError('Position unavailable')
    cy.createGroupViaUI('Alice')
    cy.contains('Position unavailable', { timeout: 5000 }).should('be.visible')
  })

  it('is dismissed by clicking the ✕ button', () => {
    visitWithGeoError()
    cy.createGroupViaUI('Alice')
    cy.contains('Location unavailable', { timeout: 5000 }).should('be.visible')
    cy.get('[aria-label="Dismiss location error"]').click()
    cy.contains('Location unavailable').should('not.exist')
  })

  it('does not appear when geolocation succeeds', () => {
    // visitWithGeo stubs getCurrentPosition to call the success callback,
    // so onGeoError(null) is called and the banner never renders.
    cy.visitWithGeo()
    cy.createGroupViaUI('Alice')
    cy.contains('Location unavailable').should('not.exist')
  })
})
