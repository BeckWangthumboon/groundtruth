const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function buildApiUrl(path, params = {}) {
  const url = new URL(path, API_BASE || window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) {
      return
    }
    url.searchParams.set(key, String(value))
  })
  return API_BASE ? url.toString() : `${url.pathname}${url.search}`
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.error || `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

export async function fetchCensusByPoint({ lat, lon, acs = 'latest', includeParents = true, signal }) {
  const url = buildApiUrl('/api/census/by-point', {
    lat,
    lon,
    acs,
    include_parents: includeParents,
  })
  return fetchJson(url, signal)
}

/**
 * Fetch nearby POIs from the Overpass-backed endpoint.
 *
 * @param {{ lat: number, lon: number, radiusM?: number, signal?: AbortSignal }} opts
 * @returns {Promise<{ counts: Record<string,number>, points: Array<object>, meta: object }>}
 */
export async function fetchNearbyPois({ lat, lon, radiusM = 800, signal }) {
  const url = buildApiUrl('/api/pois/nearby', { lat, lon, radius_m: radiusM })
  return fetchJson(url, signal)
}

/**
 * Fetch dynamic POIs from the preference-driven endpoint.
 *
 * @param {{
 *   lat: number,
 *   lon: number,
 *   selectedLabels: string[],
 *   radiusM?: number,
 *   businessType?: string,
 *   includeNodes?: boolean,
 *   signal?: AbortSignal
 * }} opts
 * @returns {Promise<{ countsByLabel: Record<string,number>, points: Array<object>|null, meta: object }>}
 */
export async function fetchDynamicPois({
  lat,
  lon,
  selectedLabels,
  radiusM = 1200,
  businessType,
  includeNodes = true,
  signal,
}) {
  const selectedLabelsParam = Array.isArray(selectedLabels)
    ? selectedLabels.filter(Boolean).join(',')
    : ''
  const url = buildApiUrl('/api/pois/dynamic', {
    lat,
    lon,
    radius_m: radiusM,
    selected_labels: selectedLabelsParam,
    business_type: businessType,
    include_nodes: includeNodes,
  })
  return fetchJson(url, signal)
}

/**
 * Fetch the Census tract boundary GeoJSON for a coordinate.
 *
 * @param {{ lat: number, lon: number, signal?: AbortSignal }} opts
 * @returns {Promise<GeoJSON.Feature>}
 */
export async function fetchTractGeo({ lat, lon, signal }) {
  const url = buildApiUrl('/api/census/tract-geo', { lat, lon })
  return fetchJson(url, signal)
}
