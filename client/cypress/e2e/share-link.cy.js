// Suite: Share link — deep-link and share button
// Covers the ?join=CODE URL pre-fill and the share button on the map top bar.
// Deep-link tests only need the Vite dev server.
// Share button tests require both servers.

// ── Deep-link (?join=CODE) ────────────────────────────────────────────────────

describe('Share link — deep link pre-fill', () => {
  it('selects the Join tab when arriving via /?join=CODE', () => {
    cy.visit('/?join=ABC123')
    cy.contains('button[type="submit"]', 'Join Group').should('be.visible')
  })

  it('pre-fills the group code input from the URL param', () => {
    cy.visit('/?join=ABC123')
    cy.get('input[placeholder="Enter 6-character code"]').should('have.value', 'ABC123')
  })

  it('uppercases the code from the URL param', () => {
    cy.visit('/?join=abc123')
    cy.get('input[placeholder="Enter 6-character code"]').should('have.value', 'ABC123')
  })

  it('clears the ?join param from the URL after load', () => {
    cy.visit('/?join=ABC123')
    cy.location('search').should('eq', '')
  })

  it('truncates an overlong URL param to 6 characters', () => {
    cy.visit('/?join=ABCDEF999')
    cy.get('input[placeholder="Enter 6-character code"]').should('have.value', 'ABCDEF')
  })

  it('stays on Create tab when there is no ?join param', () => {
    cy.visit('/')
    cy.contains('button[type="submit"]', 'Create Group').should('be.visible')
  })

  it('stays on Create tab when ?join= is empty', () => {
    cy.visit('/?join=')
    cy.contains('button[type="submit"]', 'Create Group').should('be.visible')
  })

  it('a pre-filled code can be submitted to join a real group', () => {
    cy.task('createGroupAndHold').then(code => {
      // Visit the join URL with geolocation stubbed inline
      cy.visit(`/?join=${code}`, {
        onBeforeLoad(win) {
          cy.stub(win.navigator.geolocation, 'getCurrentPosition').callsFake(success => {
            success({ coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 } })
          })
        },
      })
      cy.get('input[placeholder="Enter 6-character code"]').should('have.value', code)
      cy.get('input[placeholder="Enter your name"]').type('DeepLinker')
      cy.get('button[type="submit"]').click()
      cy.get('.leaflet-container', { timeout: 10000 }).should('exist')
      cy.task('releaseGroupSocket')
    })
  })
})

// ── Share button ──────────────────────────────────────────────────────────────

describe('Share link — share button', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.window().then(win => {
      // Headless Chrome blocks clipboard.writeText without a user gesture — stub it.
      cy.stub(win.navigator.clipboard, 'writeText').as('clipboardWrite').resolves()
      // Force clipboard fallback by removing navigator.share (it may already be absent in CI).
      try {
        Object.defineProperty(win.navigator, 'share', {
          value: undefined,
          configurable: true,
          writable: true,
        })
      } catch {
        // Not configurable in this browser; the clipboard stub still covers the assertion.
      }
    })
    cy.createGroupViaUI('Alice')
  })

  it('share button is present in the top bar', () => {
    cy.get('[aria-label="Share join link"]').should('be.visible')
  })

  it('clicking share button copies a URL containing /?join= and the group code', () => {
    // Grab the code shown in the top bar, then assert the clipboard URL matches.
    cy.contains(/^[A-F0-9]{6}$/).invoke('text').then(code => {
      cy.get('[aria-label="Share join link"]').click()
      cy.get('@clipboardWrite').should('have.been.calledOnce')
      cy.get('@clipboardWrite').then(stub => {
        expect(stub.args[0][0]).to.include(`/?join=${code}`)
      })
    })
  })

  it('the copied URL is a valid absolute URL', () => {
    cy.get('[aria-label="Share join link"]').click()
    cy.get('@clipboardWrite').then(stub => {
      expect(stub.args[0][0]).to.match(/^https?:\/\/.+\/\?join=[A-F0-9]{6}$/)
    })
  })

  it('share button shows ✓ feedback after clicking', () => {
    cy.get('[aria-label="Share join link"]').click()
    cy.get('[aria-label="Share join link"]').should('contain', '✓')
  })

  it('share button reverts to ↗ after 2 seconds', () => {
    cy.get('[aria-label="Share join link"]').click()
    cy.get('[aria-label="Share join link"]').should('contain', '✓')
    cy.wait(2100)
    cy.get('[aria-label="Share join link"]').should('contain', '↗')
  })

  it('member count is visible in the top bar', () => {
    cy.contains('1 member').should('be.visible')
  })
})
