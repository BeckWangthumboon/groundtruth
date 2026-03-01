import { describe, expect, it } from 'vitest'

import { buildPoiReportCardRequest, REPORT_CARD_DIMENSIONS } from './poiReportCard'

describe('buildPoiReportCardRequest', () => {
  it('sorts groups by count desc and label asc while normalizing reachability', () => {
    const payload = buildPoiReportCardRequest({
      locationLabel: 'Madison',
      isochroneProfile: 'driving',
      totalPlaces: 40,
      groups: [
        { key: 'shopping', label: 'Shopping', count: 8 },
        { key: 'transit-b', label: 'Transit B', count: 12 },
        { key: 'transit-a', label: 'Transit A', count: 12 },
      ],
      reachability: { '5': 5, '10': 11, '15': -2 },
    })

    expect(payload.location_label).toBe('Madison')
    expect(payload.total_places).toBe(40)
    expect(payload.groups.map((group) => group.label)).toEqual([
      'Transit A',
      'Transit B',
      'Shopping',
    ])
    expect(payload.reachability).toEqual({ '5': 5, '10': 11, '15': 0 })
  })
})

describe('REPORT_CARD_DIMENSIONS', () => {
  it('exposes the fixed report-card dimension order', () => {
    expect(REPORT_CARD_DIMENSIONS.map((dimension) => dimension.key)).toEqual([
      'food_availability',
      'nightlife',
      'stores',
      'walkability',
      'public_services',
      'transit_access',
      'recreation',
      'healthcare_access',
    ])
  })
})
