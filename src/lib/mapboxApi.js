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
 * Fetch nearby POIs via the Mapbox Tilequery API.
 *
 * @param {{ lon: number, lat: number, radius?: number, layers?: string, limit?: number, signal?: AbortSignal }} opts
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
export async function fetchTilequeryPois({
  lon,
  lat,
  radius = 800,
  layers = 'poi_label,building',
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
