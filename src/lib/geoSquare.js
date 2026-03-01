const METERS_PER_DEGREE_LAT = 111320
const MIN_SAFE_COSINE = 0.000001

export const LATITUDE_LIMIT = 85.051129
export const LONGITUDE_LIMIT = 180
export const DEFAULT_CENTER = {
  lat: 43.074,
  lon: -89.384,
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const clampLatitude = (lat) => clamp(lat, -LATITUDE_LIMIT, LATITUDE_LIMIT)
const clampLongitude = (lon) => clamp(lon, -LONGITUDE_LIMIT, LONGITUDE_LIMIT)

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} [sideMeters]
 * @returns {[[number, number], [number, number]]}
 */
export function squareBoundsFromCenter(lat, lon, sideMeters = 100) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new TypeError('Latitude and longitude must be finite numbers.')
  }
  if (!Number.isFinite(sideMeters) || sideMeters <= 0) {
    throw new TypeError('sideMeters must be a positive finite number.')
  }

  const safeLat = clampLatitude(lat)
  const safeLon = clampLongitude(lon)
  const halfSideMeters = sideMeters / 2

  const latDelta = halfSideMeters / METERS_PER_DEGREE_LAT
  const latitudeRadians = (safeLat * Math.PI) / 180
  const cosine = Math.max(Math.abs(Math.cos(latitudeRadians)), MIN_SAFE_COSINE)
  const lonDelta = halfSideMeters / (METERS_PER_DEGREE_LAT * cosine)

  const south = clampLatitude(safeLat - latDelta)
  const north = clampLatitude(safeLat + latDelta)
  const west = clampLongitude(safeLon - lonDelta)
  const east = clampLongitude(safeLon + lonDelta)

  return /** @type {[[number, number], [number, number]]} */ ([
    [west, south],
    [east, north],
  ])
}
