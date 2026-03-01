export const REPORT_CARD_DIMENSIONS = [
  { key: 'food_availability', label: 'Food Availability' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'stores', label: 'Stores' },
  { key: 'walkability', label: 'Walkability' },
  { key: 'public_services', label: 'Public Services' },
  { key: 'transit_access', label: 'Transit Access' },
  { key: 'recreation', label: 'Recreation' },
  { key: 'healthcare_access', label: 'Healthcare Access' },
]

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNonNegativeInt(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < 0) {
    return 0
  }
  return Math.floor(num)
}

/**
 * @param {{ key: string, label: string, count: number }[]} groups
 */
export function sortPoiGroups(groups) {
  return [...groups].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count
    }
    return left.label.localeCompare(right.label)
  })
}

/**
 * Build request payload for backend report card generation.
 *
 * @param {{
 *   locationLabel?: string,
 *   isochroneProfile: 'walking' | 'driving',
 *   totalPlaces: number,
 *   groups: { key: string, label: string, count: number }[],
 *   reachability?: Record<string, number>,
 * }} opts
 */
export function buildPoiReportCardRequest(opts) {
  const sortedGroups = sortPoiGroups(opts.groups).map((group) => ({
    key: String(group.key),
    label: String(group.label),
    count: toNonNegativeInt(group.count),
  }))

  const totalPlaces = toNonNegativeInt(opts.totalPlaces)
  const reachabilityInput = opts.reachability ?? {}

  return {
    location_label: opts.locationLabel?.trim() || 'Selected area',
    isochrone_profile: opts.isochroneProfile,
    total_places: totalPlaces,
    groups: sortedGroups,
    reachability: {
      '5': toNonNegativeInt(reachabilityInput['5']),
      '10': toNonNegativeInt(reachabilityInput['10']),
      '15': toNonNegativeInt(reachabilityInput['15']),
    },
  }
}
