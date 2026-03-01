import { describe, expect, it } from 'vitest'

import {
  buildPoiMarkerColorExpression,
  createEmptyPoiFeatureCollection,
  filterPoiPointsByCheckedLabels,
  toPoiFeatureCollection,
} from '../poiDynamicMap'

describe('poiDynamicMap', () => {
  it('returns no points when nothing is checked', () => {
    const points = [
      { type: 'transit_access', categories: ['transit_access'], lat: 1, lng: 2 },
      { type: 'retail_density', categories: ['retail_density'], lat: 3, lng: 4 },
    ]
    expect(filterPoiPointsByCheckedLabels(points, [])).toEqual([])
  })

  it('matches points by any category, not just primary type', () => {
    const points = [
      {
        type: 'transit_access',
        categories: ['transit_access', 'foot_traffic_proxy'],
        lat: 43.074,
        lng: -89.384,
      },
      {
        type: 'retail_density',
        categories: ['retail_density'],
        lat: 43.075,
        lng: -89.385,
      },
    ]

    const filtered = filterPoiPointsByCheckedLabels(points, ['foot_traffic_proxy'])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].type).toBe('transit_access')
  })

  it('builds a valid feature collection from points', () => {
    const geojson = toPoiFeatureCollection([
      { type: 'transit_access', categories: ['transit_access'], lat: 43.074, lng: -89.384, name: 'Stop A' },
    ])

    expect(geojson.type).toBe('FeatureCollection')
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.coordinates).toEqual([-89.384, 43.074])
    expect(geojson.features[0].properties.type).toBe('transit_access')
  })

  it('returns an empty feature collection for invalid points', () => {
    const empty = createEmptyPoiFeatureCollection()
    const geojson = toPoiFeatureCollection([{ type: 'x', lat: 'bad', lng: null }])
    expect(geojson).toEqual(empty)
  })

  it('builds a mapbox color match expression', () => {
    const expression = buildPoiMarkerColorExpression()
    expect(expression[0]).toBe('match')
    expect(expression[1]).toEqual(['get', 'type'])
    expect(expression.length).toBeGreaterThan(4)
  })
})
