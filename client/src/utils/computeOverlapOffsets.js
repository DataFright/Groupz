// Pure function — no React or Leaflet imports.
// Clusters markers whose icons would visually overlap at the current zoom level
// and spreads each cluster radially so every icon and tooltip stays readable.
//
// `map` is a Leaflet map instance. latLngToLayerPoint converts real coordinates
// to pixel positions so the overlap threshold is zoom-aware: members visually
// separated at high zoom are never grouped together.

export function computeOverlapOffsets(members, map) {
  const offsets = {}
  if (!map || members.length === 0) return offsets

  const ICON_PX = 44  // pixel width/height of each marker icon

  const pts = members.map(m => {
    const { x, y } = map.latLngToLayerPoint([m.lat, m.lng])
    return { id: m.socketId, x, y }
  })

  // BFS flood-fill: transitively group any markers whose icons would overlap.
  // Transitive grouping handles A≈B and B≈C → all three spread together even
  // if A and C are not directly within threshold of each other.
  const clusterOf = new Map()
  const clusters  = []

  for (const p of pts) {
    if (clusterOf.has(p.id)) continue
    const cluster = [p]
    clusterOf.set(p.id, clusters.length)
    for (let qi = 0; qi < cluster.length; qi++) {
      for (const q of pts) {
        if (clusterOf.has(q.id)) continue
        const dx = cluster[qi].x - q.x
        const dy = cluster[qi].y - q.y
        if (Math.sqrt(dx * dx + dy * dy) < ICON_PX) {
          clusterOf.set(q.id, clusters.length)
          cluster.push(q)
        }
      }
    }
    clusters.push(cluster)
  }

  for (const cluster of clusters) {
    const n = cluster.length
    if (n === 1) {
      offsets[cluster[0].id] = [0, 0]
    } else {
      // Radius sized so adjacent spread icons have a small gap between them.
      // Adjacent chord = 2R·sin(π/n) must be ≥ ICON_PX (44px), so R = 22/sin(π/n).
      const R = Math.ceil(22 / Math.sin(Math.PI / n)) + 4
      cluster.forEach(({ id }, i) => {
        const angle = (2 * Math.PI * i) / n
        offsets[id] = [Math.round(R * Math.cos(angle)), Math.round(R * Math.sin(angle))]
      })
    }
  }
  return offsets
}
