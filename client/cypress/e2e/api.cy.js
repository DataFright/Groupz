// Suite: REST API smoke tests
// Verifies that key backend endpoints respond correctly without a browser UI.
// Hits the backend directly via cy.request() — no frontend visit needed.

const backendUrl = () => Cypress.env('BACKEND_URL') || 'http://localhost:3001'

describe('REST API — /health', () => {
  it('returns 200 with an ok status', () => {
    cy.request(`${backendUrl()}/health`).then(res => {
      expect(res.status).to.equal(200)
      expect(res.body.status).to.equal('ok')
    })
  })

  it('response includes uptime and activeGroups fields', () => {
    cy.request(`${backendUrl()}/health`).then(res => {
      expect(res.body).to.have.property('uptime')
      expect(res.body).to.have.property('activeGroups')
    })
  })
})

describe('REST API — /api/groups/:code', () => {
  it('returns 404 with exists:false for an unknown group code', () => {
    cy.request({
      url:              `${backendUrl()}/api/groups/XXXXXX`,
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.equal(404)
      expect(res.body.exists).to.equal(false)
    })
  })
})

describe('REST API — /api/metrics', () => {
  it('endpoint exists and never returns 404 or a 5xx error', () => {
    cy.request({
      url:              `${backendUrl()}/api/metrics`,
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.not.equal(404)
      expect(res.status).to.be.lessThan(500)
    })
  })

  it('always responds with JSON', () => {
    cy.request({
      url:              `${backendUrl()}/api/metrics`,
      failOnStatusCode: false,
    }).then(res => {
      expect(res.headers['content-type']).to.include('application/json')
      expect(res.body).to.be.an('object')
    })
  })

  it('returns 401 with an Unauthorized error body when a wrong key is supplied and auth is active', () => {
    cy.request({
      url:              `${backendUrl()}/api/metrics?key=__invalid_test_key__`,
      failOnStatusCode: false,
    }).then(res => {
      // 401 → auth is active and working (production)
      // 200 → no METRICS_KEY configured (local dev) — still a valid state
      expect(res.status).to.be.oneOf([200, 401])
      if (res.status === 401) {
        expect(res.body.error).to.equal('Unauthorized')
      }
    })
  })
})
