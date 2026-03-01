/**
 * @file Deterministic mock POI generator for the foot traffic simulation.
 *
 * Used as a fallback when the real /api/pois/nearby Overpass endpoint is
 * unavailable (network error, backend not running, rate-limited, etc.).
 *
 * The offsets and weights are fixed constants so that the same coordinates
 * always produce the same POI layout — making the simulation reproducible
 * and easy to test without a live backend.
 */

/**
 * Fixed POI templates. Each entry defines:
 *  - type: Overpass category (food | retail | nightlife | parks | transit | grocery | healthcare)
 *  - name: Display name shown on hover / in layer tooltips
 *  - dLat, dLng: Coordinate offsets from the center pin (degrees)
 *  - weight: Pre-computed base weight (0–1); the engine will re-derive the
 *    time-varying weight from the Gaussian profiles, but this satisfies the
 *    SimulationPOI typedef.
 *
 * Offsets are designed so the points spread in four cardinal/diagonal
 * directions at distances of roughly 100–350 m.
 */
const POI_TEMPLATES = [
  { type: 'food',      name: 'Corner Diner',       dLat:  0.0018, dLng:  0.0010, weight: 0.7 },
  { type: 'retail',    name: 'Neighborhood Market', dLat: -0.0012, dLng:  0.0022, weight: 0.5 },
  { type: 'nightlife', name: 'Local Bar',           dLat:  0.0005, dLng: -0.0018, weight: 0.6 },
  { type: 'parks',     name: 'City Park',           dLat: -0.0020, dLng: -0.0008, weight: 0.4 },
  { type: 'transit',   name: 'Bus Stop',            dLat:  0.0024, dLng: -0.0030, weight: 0.5 },
]

/**
 * Mock census meta used to drive `computeDensityScale` when no real
 * Census data is available.  Values represent a typical mid-density
 * urban neighbourhood (~7 000 ppl/km²).
 */
const MOCK_META = {
  population: 8_500,
  aland: 1_200_000,   // ~1.2 km² in square metres
}

/**
 * Generate 5 deterministic mock POIs centred on the given coordinates.
 *
 * The response shape mirrors what `/api/pois/nearby` returns so the caller
 * can pass `mock.points` directly to `setPois` and `mock.meta` to
 * `computeDensityScale` without any transformation.
 *
 * @param {number} lat - Centre latitude (from URL ?lat=)
 * @param {number} lon - Centre longitude (from URL ?lon=)
 * @returns {{ counts: Record<string,number>, points: import('./types.js').SimulationPOI[], meta: typeof MOCK_META }}
 */
export function generateMockPois(lat, lon) {
  const points = POI_TEMPLATES.map((tpl) => ({
    type:   tpl.type,
    name:   tpl.name,
    lat:    lat + tpl.dLat,
    lng:    lon + tpl.dLng,
    weight: tpl.weight,
  }))

  const counts = points.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1
    return acc
  }, /** @type {Record<string,number>} */ ({}))

  return { counts, points, meta: MOCK_META }
}
