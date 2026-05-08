// Suite: Warm-up — ensure Render backend is awake before test suites run.
// Render free tier spins down with inactivity. The app's socket timeout is 8 s,
// so two outcomes are possible after submitting:
//
//  A) 'Connection failed. Please try again.' — Render was sleeping and is now
//     waking up. Wait 30 s for it to fully come up, then the suite is done.
//
//  B) Map + 'End Group' button — backend was already warm. End the group
//     cleanly, wait 30 s, then the suite is done.
//
// Cypress runs specs alphabetically, so this always runs first.

describe('Warm-up', { defaultCommandTimeout: 90000 }, () => {
  it('wakes the Render backend before any other spec runs', () => {
    cy.visitWithGeo()
    cy.get('input[placeholder="Enter your name"]').type('Warmup')
    cy.get('button[type="submit"]').click()

    // Wait up to 60 s for either outcome to appear in the DOM
    cy.get('body', { timeout: 60000 }).should($body => {
      expect(
        $body.text().includes('Connection failed') ||
        $body.text().includes('End Group')
      ).to.be.true
    })

    // If the group was created, end it cleanly
    cy.get('body').then($body => {
      if ($body.text().includes('End Group')) {
        cy.contains('button', 'End Group').click()
        cy.contains('End this group for everyone?').parent().contains('button', 'End Group').click()
        cy.contains('h1', 'Groupz', { timeout: 15000 }).should('be.visible')
      }
    })

    // Give Render 30 s to fully warm up regardless of which path we took
    cy.wait(30000)
  })
})
