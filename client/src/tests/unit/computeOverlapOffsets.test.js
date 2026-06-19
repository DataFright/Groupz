import { describe, it, expect } from 'vitest'
import { computeOverlapOffsets } from '../../utils/computeOverlapOffsets.js'

// The mock map treats lat/lng directly as pixel x/y.
// This lets tests express precise pixel distances without any Leaflet dependency.
const map = { latLngToLayerPoint: ([lat, lng]) => ({ x: lat, y: lng }) }

// Shorthand: member object with just the fields computeOverlapOffsets needs.
function m(socketId, lat, lng) {
  return { socketId, lat, lng }
}

// Euclidean distance between two [x, y] offsets.
function dist([x1, y1], [x2, y2]) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

// ─── Guards ──────────────────────────────────────────────────────────────────

describe('computeOverlapOffsets — guards', () => {
  it('returns empty object when map is null', () => {
    expect(computeOverlapOffsets([m('a', 0, 0)], null)).toEqual({})
  })

  it('returns empty object when map is undefined', () => {
    expect(computeOverlapOffsets([m('a', 0, 0)], undefined)).toEqual({})
  })

  it('returns empty object for an empty member list', () => {
    expect(computeOverlapOffsets([], map)).toEqual({})
  })

  it('returns { socketId: [0,0] } for a single member', () => {
    expect(computeOverlapOffsets([m('a', 0, 0)], map)).toEqual({ a: [0, 0] })
  })
})

// ─── Pixel-distance clustering ────────────────────────────────────────────────

describe('computeOverlapOffsets — clustering threshold', () => {
  it('two members at exactly the same pixel position are spread (distance 0 < 44)', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 0, 0)], map)
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
  })

  it('two members 43 px apart are spread (within threshold)', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 43, 0)], map)
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
  })

  it('two members exactly 44 px apart are NOT spread (at threshold boundary)', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 44, 0)], map)
    expect(r.a).toEqual([0, 0])
    expect(r.b).toEqual([0, 0])
  })

  it('two members 100 px apart are NOT spread (well outside threshold)', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 100, 0)], map)
    expect(r.a).toEqual([0, 0])
    expect(r.b).toEqual([0, 0])
  })

  it('diagonal overlap: two members sqrt(30²+30²) ≈ 42 px apart are spread', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 30, 30)], map)
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
  })
})

// ─── Transitive (BFS) grouping ────────────────────────────────────────────────

describe('computeOverlapOffsets — transitive grouping', () => {
  it('A≈B and B≈C but A not directly close to C → all three in one cluster', () => {
    // |A-B| = 30 < 44, |B-C| = 30 < 44, |A-C| = 60 ≥ 44
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 30, 0), m('c', 60, 0)], map)
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
    expect(r.c).not.toEqual([0, 0])
  })

  it('a chain of 4 close members are all in one cluster', () => {
    // Each adjacent pair is 20px apart (<44), but first and last are 60px apart
    const r = computeOverlapOffsets([
      m('a', 0, 0), m('b', 20, 0), m('c', 40, 0), m('d', 60, 0),
    ], map)
    // All should be spread (non-zero), since they form one transitive cluster
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
    expect(r.c).not.toEqual([0, 0])
    expect(r.d).not.toEqual([0, 0])
  })
})

// ─── Independent clusters ────────────────────────────────────────────────────

describe('computeOverlapOffsets — independent clusters', () => {
  it('two solo members 100 px apart each get [0, 0]', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 100, 0)], map)
    expect(r.a).toEqual([0, 0])
    expect(r.b).toEqual([0, 0])
  })

  it('two separate overlapping pairs spread independently', () => {
    // Cluster 1: A and B at same spot; Cluster 2: C and D at (100,0)
    const r = computeOverlapOffsets([
      m('a', 0, 0), m('b', 0, 0),
      m('c', 100, 0), m('d', 100, 0),
    ], map)
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
    expect(r.c).not.toEqual([0, 0])
    expect(r.d).not.toEqual([0, 0])
    expect(dist(r.a, r.b)).toBeGreaterThanOrEqual(44)
    expect(dist(r.c, r.d)).toBeGreaterThanOrEqual(44)
  })

  it('one overlapping pair and one solo member spread independently', () => {
    // A and B overlap; C is far away and stays at [0,0]
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 0, 0), m('c', 100, 0)], map)
    expect(r.a).not.toEqual([0, 0])
    expect(r.b).not.toEqual([0, 0])
    expect(r.c).toEqual([0, 0])
  })
})

// ─── Spread radius and non-overlap guarantee ──────────────────────────────────

describe('computeOverlapOffsets — spread radius correctness', () => {
  it('N=2: spread icons are ≥ 44 px apart from each other', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 0, 0)], map)
    expect(dist(r.a, r.b)).toBeGreaterThanOrEqual(44)
  })

  it('N=3: all spread icons are ≥ 44 px apart from each adjacent partner', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 0, 0), m('c', 0, 0)], map)
    expect(dist(r.a, r.b)).toBeGreaterThanOrEqual(44)
    expect(dist(r.b, r.c)).toBeGreaterThanOrEqual(44)
    expect(dist(r.a, r.c)).toBeGreaterThanOrEqual(44)
  })

  it('N=4: minimum pairwise distance between spread icons is ≥ 44 px', () => {
    const members = [m('a', 0, 0), m('b', 0, 0), m('c', 0, 0), m('d', 0, 0)]
    const r = computeOverlapOffsets(members, map)
    const ids = ['a', 'b', 'c', 'd']
    const dists = ids.flatMap((id, i) => ids.slice(i + 1).map(jd => dist(r[id], r[jd])))
    expect(Math.min(...dists)).toBeGreaterThanOrEqual(44)
  })

  it('N=6: minimum pairwise distance between spread icons is ≥ 44 px', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const r = computeOverlapOffsets(ids.map(id => m(id, 0, 0)), map)
    const dists = ids.flatMap((id, i) => ids.slice(i + 1).map(jd => dist(r[id], r[jd])))
    expect(Math.min(...dists)).toBeGreaterThanOrEqual(44)
  })

  it('N=3: all three offsets are distinct', () => {
    const r = computeOverlapOffsets([m('a', 0, 0), m('b', 0, 0), m('c', 0, 0)], map)
    const keys = ['a', 'b', 'c'].map(id => `${r[id][0]},${r[id][1]}`)
    expect(new Set(keys).size).toBe(3)
  })

  it('radius grows with cluster size so icons never overlap each other', () => {
    // N=2 vs N=6: N=6 must use a larger radius to maintain the 44px gap
    const r2 = computeOverlapOffsets([m('a', 0, 0), m('b', 0, 0)], map)
    const r6 = computeOverlapOffsets(['a','b','c','d','e','f'].map(id => m(id, 0, 0)), map)
    const R2 = dist(r2.a, [0, 0])  // radius is distance from origin to any spread offset
    const R6 = dist(r6.a, [0, 0])
    expect(R6).toBeGreaterThan(R2)
  })
})
