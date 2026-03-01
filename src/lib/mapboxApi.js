const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

/**
 * Fetch isochrone polygons from the Mapbox Isochrone API.
 *
 * @param {{ lon: number, lat: number, profile?: string, contours?: number[], signal?: AbortSignal }} opts
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
export async function fetchIsochrone({
  lon,
  lat,
  profile = 'walking',
  contours = [5, 10, 15],
  signal,
}) {
  const url = new URL(
    `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${lon},${lat}`
  )
  url.searchParams.set('contours_minutes', contours.join(','))
  url.searchParams.set('polygons', 'true')
  url.searchParams.set('access_token', accessToken)

  const response = await fetch(url.toString(), { signal })
  if (!response.ok) {
    throw new Error(`Isochrone request failed (${response.status})`)
  }
  return response.json()
}

/**
 * Fetch nearby POIs via the Mapbox Tilequery API (single point, max 50).
 */
async function fetchTilequerySingle({
  lon,
  lat,
  radius = 800,
  layers = 'poi_label',
  limit = 50,
  signal,
}) {
  const url = new URL(
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lon},${lat}.json`
  )
  url.searchParams.set('radius', String(radius))
  url.searchParams.set('layers', layers)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('access_token', accessToken)

  const response = await fetch(url.toString(), { signal })
  if (!response.ok) {
    throw new Error(`Tilequery request failed (${response.status})`)
  }
  return response.json()
}

/**
 * Convert a meter offset to approximate degree offset.
 */
function metersToDegreeLng(meters, lat) {
  return meters / (111320 * Math.cos((lat * Math.PI) / 180))
}
function metersToDegreeLat(meters) {
  return meters / 111320
}

/**
 * Build a dedup key for a POI feature so we can merge results from
 * overlapping grid queries.  Round coordinates to ~1 m precision.
 */
function poiDedupeKey(feature) {
  const [lng, lat] = feature.geometry?.coordinates ?? [0, 0]
  const name = feature.properties?.name ?? ''
  return `${lng.toFixed(5)},${lat.toFixed(5)}|${name}`
}

/**
 * Fetch nearby POIs via multiple Tilequery grid queries to overcome the
 * 50-feature-per-request API cap.
 *
 * Queries the center point plus surrounding offsets, deduplicates, and
 * returns a single merged FeatureCollection.
 *
 * @param {{ lon: number, lat: number, radius?: number, layers?: string, limit?: number, signal?: AbortSignal }} opts
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
export async function fetchTilequeryPois({
  lon,
  lat,
  radius = 800,
  layers = 'poi_label',
  limit = 50,
  signal,
}) {
  // Fixed per-query radius that gives good density (each circle returns
  // most POIs within it rather than sparse-sampling a huge area).
  const CELL_RADIUS = 800
  const spacing = CELL_RADIUS * 1.0

  // Number of rings around center: 1 → 3×3 (9 pts), 2 → 5×5 (25 pts)
  const rings = Math.max(1, Math.min(Math.ceil(radius / spacing / 2), 2))

  const queryPoints = []
  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      const ptLng = lon + dx * metersToDegreeLng(spacing, lat)
      const ptLat = lat + dy * metersToDegreeLat(spacing)
      queryPoints.push([ptLng, ptLat])
    }
  }

  const results = await Promise.allSettled(
    queryPoints.map((pt) =>
      fetchTilequerySingle({
        lon: pt[0],
        lat: pt[1],
        radius: CELL_RADIUS,
        layers,
        limit,
        signal,
      })
    )
  )

  const seen = new Set()
  const merged = []

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const feature of result.value.features ?? []) {
      const key = poiDedupeKey(feature)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(feature)
      }
    }
  }

  return { type: 'FeatureCollection', features: merged }
}
