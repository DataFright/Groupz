// Visit the app with a stubbed geolocation so the map doesn't block on GPS permission.
Cypress.Commands.add('visitWithGeo', (lat = 51.5074, lng = -0.1278) => {
  cy.visit('/', {
    onBeforeLoad(win) {
      cy.stub(win.navigator.geolocation, 'getCurrentPosition').callsFake(success => {
        success({ coords: { latitude: lat, longitude: lng, accuracy: 10 } })
      })
    },
  })
})

// Navigate to the map view by filling the Home form and submitting.
// Waits until the "End Group" button is visible (host) before resolving.
Cypress.Commands.add('createGroupViaUI', (name = 'Alice') => {
  cy.get('input[placeholder="Enter your name"]').type(name)
  cy.get('button[type="submit"]').click()
  cy.contains('button', 'End Group', { timeout: 10000 }).should('be.visible')
})

// Navigate to the map view by joining an existing group via the Home form.
// Waits until the Leaflet map is visible (non-host) before resolving.
Cypress.Commands.add('joinGroupViaUI', (code, name = 'Bob') => {
  cy.contains('button[type="button"]', 'Join Group').click()
  cy.get('input[placeholder="Enter 6-character code"]').type(code)
  cy.get('input[placeholder="Enter your name"]').type(name)
  cy.get('button[type="submit"]').click()
  cy.get('.leaflet-container', { timeout: 10000 }).should('exist')
})
