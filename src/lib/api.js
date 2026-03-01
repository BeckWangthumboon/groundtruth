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

export async function fetchCensusByPoint({ lat, lon, acs = 'latest', signal }) {
  const url = buildApiUrl('/api/census/by-point', { lat, lon, acs })
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
