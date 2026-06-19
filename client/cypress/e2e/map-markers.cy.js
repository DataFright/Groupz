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

// Suite: Map — marker overlap spreading
// Verifies that nearby markers are spread radially so icons and tooltips don't
// stack on top of each other. Uses the pool socket infrastructure so multiple
// task-side members can share the same group as the browser user.
//
// How it works: when two markers are within 44 px of each other at the current
// zoom, computeOverlapOffsets assigns each a non-zero translate offset.
// createEmojiIcon writes that offset as a style="transform:translate(Xpx,Ypx)"
// attribute on the .emoji-marker div. Markers that do NOT need spreading have no
// style attribute at all. The assertions below check for that attribute.

describe('Map — marker overlap spreading', () => {
  beforeEach(() => {
    cy.visitWithGeo(51.5074, -0.1278)
    cy.createGroupViaUI('Alice')
    // Wait for Alice's first GPS fix so the map has flown to zoom 15
    cy.get('.emoji-marker--me', { timeout: 8000 }).should('exist')
  })

  afterEach(() => cy.task('releaseAllPoolSockets'))

  it('two members at the exact same GPS location are spread apart (not stacked)', () => {
    cy.contains(/^[A-F0-9]{6}$/).invoke('text').then(code => {
      cy.task('joinGroupInPool', {
        id: 'bob', code, name: 'Bob', icon: '🐸',
        lat: 51.5074, lng: -0.1278,   // identical to Alice
      })
    })
    // Wait until both markers are visible on the map
    cy.get('.emoji-marker', { timeout: 8000 }).should('have.length', 2)
    // Both icons must carry a translate transform (i.e. were spread, not left stacked)
    cy.get('.emoji-marker--me')
      .should('have.attr', 'style').and('include', 'translate')
    cy.get('.emoji-marker:not(.emoji-marker--me)')
      .should('have.attr', 'style').and('include', 'translate')
  })

  it('two members ~22 m apart are spread apart (within pixel threshold at zoom 15)', () => {
    // 0.0002° lat ≈ 22 m — about 7 px at zoom 15, well inside the 44 px ICON_PX threshold.
    // This is the real-world "same canoe / adjacent kayak" scenario.
    cy.contains(/^[A-F0-9]{6}$/).invoke('text').then(code => {
      cy.task('joinGroupInPool', {
        id: 'bob', code, name: 'Bob', icon: '🐸',
        lat: 51.5076, lng: -0.1278,   // ~22 m north of Alice
      })
    })
    cy.get('.emoji-marker', { timeout: 8000 }).should('have.length', 2)
    cy.get('.emoji-marker--me')
      .should('have.attr', 'style').and('include', 'translate')
    cy.get('.emoji-marker:not(.emoji-marker--me)')
      .should('have.attr', 'style').and('include', 'translate')
  })

  it('three members at the same GPS location each get a distinct spread position', () => {
    cy.contains(/^[A-F0-9]{6}$/).invoke('text').then(code => {
      cy.task('joinGroupInPool', {
        id: 'bob', code, name: 'Bob', icon: '🐸',
        lat: 51.5074, lng: -0.1278,
      })
      cy.task('joinGroupInPool', {
        id: 'carol', code, name: 'Carol', icon: '🦋',
        lat: 51.5074, lng: -0.1278,
      })
    })
    cy.get('.emoji-marker', { timeout: 8000 }).should('have.length', 3)
    // Every marker must be translated — none left stacked at the original position
    cy.get('.emoji-marker').each($el => {
      cy.wrap($el).should('have.attr', 'style').and('include', 'translate')
    })
    // All three translate values must be distinct (no two members share a position)
    cy.get('.emoji-marker').then($markers => {
      const transforms = [...$markers].map(el => el.getAttribute('style'))
      expect(new Set(transforms).size).to.eq(3)
    })
  })
})
