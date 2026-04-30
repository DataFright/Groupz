// Suite: Map — member markers
// Covers emoji marker and name tooltip rendering on the Leaflet map.
// Markers only appear once the server broadcasts a location-update back via
// members-update, so the geolocation interval (2500ms) must fire first.
// Requires both servers.

describe('Map — member markers', () => {
  beforeEach(() => {
    cy.visitWithGeo(51.5074, -0.1278)
    cy.createGroupViaUI('Alice')
  })

  afterEach(() => cy.task('releaseJoinSocket'))

  it('own emoji marker appears on the map after the first location update', () => {
    cy.get('.emoji-marker--me', { timeout: 8000 }).should('exist')
  })

  it('own name appears as a permanent tooltip on the map', () => {
    cy.contains('.member-tooltip', 'Alice', { timeout: 8000 }).should('exist')
  })

  it('a second member marker and tooltip appear when another member joins with a known location', () => {
    cy.contains(/^[A-F0-9]{6}$/)
      .invoke('text')
      .then(code => {
        cy.task('joinGroupAndHold', {
          code,
          name: 'Bob',
          icon: '🐸',
          lat: 48.8566,
          lng: 2.3522,
        })
      })
    cy.contains('.member-tooltip', 'Bob', { timeout: 8000 }).should('exist')
  })
})
