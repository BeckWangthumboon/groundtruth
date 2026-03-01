export const POI_MARKER_RADIUS_PX = 6

export const DEFAULT_POI_MARKER_COLOR = '#88a1bf'

export const POI_MARKER_COLOR_BY_TYPE = Object.freeze({
  essentials_nearby: '#4f9ef8',
  healthcare_access: '#f46d75',
  transit_access: '#2ec4b6',
  parking_availability: '#8f8ff0',
  parking_access: '#8f8ff0',
  green_space: '#48b676',
  nightlife_density: '#f08cc0',
  noise_nightlife_density: '#f08cc0',
  family_friendly: '#f3bf3f',
  fitness_recreation: '#7ac55a',
  personal_care: '#f3a65f',
  foot_traffic_proxy: '#ef8a4a',
  food_corridor_density: '#ef8a4a',
  retail_density: '#4fb5e5',
  anchors_nearby: '#b394f5',
  professional_services: '#a0a0a0',
  finance_services: '#6dbbc6',
  auto_services: '#808aa0',
  lodging_tourism: '#d18ee2',
  education_anchors: '#f3d36a',
  entertainment_events: '#e1829a',
  direct_competition: '#ff5f5f',
})

export function createEmptyPoiFeatureCollection() {
  return { type: 'FeatureCollection', features: [] }
}

export function filterPoiPointsByCheckedLabels(points, checkedLabelIds) {
  if (!Array.isArray(points) || points.length === 0) {
    return []
  }
  if (!Array.isArray(checkedLabelIds) || checkedLabelIds.length === 0) {
    return []
  }

  const checkedSet = new Set(checkedLabelIds)
  return points.filter((point) => {
    if (!point || typeof point !== 'object') {
      return false
    }
    const categories = Array.isArray(point.categories) && point.categories.length > 0
      ? point.categories
      : [point.type]
    return categories.some((category) => checkedSet.has(category))
  })
}

export function toPoiFeatureCollection(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return createEmptyPoiFeatureCollection()
  }

  return {
    type: 'FeatureCollection',
    features: points
      .map((point, index) => {
        const lat = Number(point?.lat)
        const lng = Number(point?.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null
        }

        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
          properties: {
            id: `dynamic-poi-${index}`,
            type: typeof point?.type === 'string' ? point.type : '',
            name: typeof point?.name === 'string' ? point.name : '',
          },
        }
      })
      .filter(Boolean),
  }
}

export function buildPoiMarkerColorExpression() {
  const expression = ['match', ['get', 'type']]
  for (const [type, color] of Object.entries(POI_MARKER_COLOR_BY_TYPE)) {
    expression.push(type, color)
  }
  expression.push(DEFAULT_POI_MARKER_COLOR)
  return expression
}
