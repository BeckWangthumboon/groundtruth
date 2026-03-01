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
