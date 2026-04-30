// Suite: Group code overlay — copy button
// Covers the copy-to-clipboard interaction on the map top bar.
// Requires both servers.

describe('Group code overlay — copy button', () => {
  beforeEach(() => {
    cy.visitWithGeo()
    cy.window().then(win => {
      // Headless Chrome blocks clipboard.writeText() without a user gesture,
      // causing it to reject silently and preventing showCopied() from firing.
      cy.stub(win.navigator.clipboard, 'writeText').resolves()
    })
    cy.createGroupViaUI('Alice')
  })

  it('clicking the copy button switches the icon to the copied state', () => {
    cy.get('[aria-label="Copy group code"]').click()
    cy.get('[aria-label="Copy group code"]').should('contain', '✓')
  })

  it('the copy button reverts to the default state after 2 seconds', () => {
    cy.get('[aria-label="Copy group code"]').click()
    cy.get('[aria-label="Copy group code"]').should('contain', '✓')
    cy.wait(2100)
    cy.get('[aria-label="Copy group code"]').should('contain', '⎘')
  })
})
