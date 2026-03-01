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

/**
 * POST JSON and parse response. Uses same error handling as fetchJson.
 */
async function fetchPostJson(url, body, signal) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message =
      (typeof payload?.detail === 'string' && payload.detail) ||
      payload?.error ||
      `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

/**
 * Send a message to the Location Assistant (Gemini).
 *
 * @param {{ message: string, conversationHistory: Array<{ role: string, content: string }>, focus: string, useDefaults?: boolean, weights?: Record<string,number>|null, locationsWithMetrics?: Array<object>|null, selectedKeypointsData?: Array<{ id: string, label: string, count: number }>|null, keypointsRadiusM?: number|null, signal?: AbortSignal }} opts
 * @returns {Promise<{ reply: string, supportsReasoning?: boolean, reasoning?: string, weights?: Record<string,number>, rankedIds?: string[], mapKeywords?: string[] }>}
 */
export async function postChat({
  message,
  conversationHistory,
  focus,
  useDefaults = true,
  weights = null,
  locationsWithMetrics = null,
  selectedKeypointsData = null,
  keypointsRadiusM = null,
  signal,
}) {
  const url = buildApiUrl('/api/chat')
  return fetchPostJson(
    url,
    {
      message,
      conversationHistory: conversationHistory ?? [],
      focus,
      useDefaults,
      weights,
      locationsWithMetrics,
      selectedKeypointsData,
      keypointsRadiusM,
    },
    signal
  )
}

/**
 * Synthesize speech from text via Google Cloud TTS.
 *
 * @param {{ text: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ audioBase64: string, format: string }>}
 */
export async function postTts({ text, signal }) {
  const url = buildApiUrl('/api/tts')
  return fetchPostJson(url, { text: text ?? '' }, signal)
}
