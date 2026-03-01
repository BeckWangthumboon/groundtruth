import { describe, expect, it } from 'vitest'

import {
  createInitialChecklistState,
  getChecklistItemsForUserType,
  POI_CHECKLIST_ITEMS_BY_USER_TYPE,
} from '../poiChecklistCatalog'
import { USER_TYPES } from '../../providers/userTypeContext'

describe('poiChecklistCatalog', () => {
  it('exposes checklist arrays for each user type', () => {
    expect(POI_CHECKLIST_ITEMS_BY_USER_TYPE[USER_TYPES.INDIVIDUAL].length).toBeGreaterThan(0)
    expect(POI_CHECKLIST_ITEMS_BY_USER_TYPE[USER_TYPES.SMALL_BIZ].length).toBeGreaterThan(0)
  })

  it('omits optional and irrelevant POI points from rendered checklists', () => {
    const allLabels = [
      ...POI_CHECKLIST_ITEMS_BY_USER_TYPE[USER_TYPES.INDIVIDUAL].map((item) => item.label),
      ...POI_CHECKLIST_ITEMS_BY_USER_TYPE[USER_TYPES.SMALL_BIZ].map((item) => item.label),
    ]

    expect(allLabels.some((label) => label.includes('Family-friendly amenities'))).toBe(false)
    expect(allLabels.some((label) => label.includes('Anchors nearby'))).toBe(false)
  })

  it('only includes ids backed by the dynamic POI endpoint', () => {
    const supportedIds = new Set([
      'anchors_nearby',
      'auto_services',
      'direct_competition',
      'education_anchors',
      'entertainment_events',
      'essentials_nearby',
      'family_friendly',
      'finance_services',
      'fitness_recreation',
      'food_corridor_density',
      'foot_traffic_proxy',
      'green_space',
      'healthcare_access',
      'lodging_tourism',
      'nightlife_density',
      'noise_nightlife_density',
      'parking_access',
      'parking_availability',
      'personal_care',
      'professional_services',
      'retail_density',
      'transit_access',
    ])

    for (const userType of [USER_TYPES.INDIVIDUAL, USER_TYPES.SMALL_BIZ]) {
      for (const item of POI_CHECKLIST_ITEMS_BY_USER_TYPE[userType]) {
        expect(supportedIds.has(item.id)).toBe(true)
      }
    }
  })

  it('uses foot_traffic_proxy for small biz to match backend ids', () => {
    const smallBizIds = POI_CHECKLIST_ITEMS_BY_USER_TYPE[USER_TYPES.SMALL_BIZ].map((item) => item.id)
    expect(smallBizIds.includes('foot_traffic_proxy')).toBe(true)
    expect(smallBizIds.includes('foot_traffic_activity_proxy')).toBe(false)
  })

  it('creates initial unchecked state for every item ID', () => {
    const initialState = createInitialChecklistState()

    for (const userType of [USER_TYPES.INDIVIDUAL, USER_TYPES.SMALL_BIZ]) {
      const itemIds = getChecklistItemsForUserType(userType).map((item) => item.id)
      expect(Object.keys(initialState[userType]).sort()).toEqual(itemIds.sort())
      for (const itemId of itemIds) {
        expect(initialState[userType][itemId]).toBe(false)
      }
    }
  })
})
