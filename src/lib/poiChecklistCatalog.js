import { normalizeUserType, USER_TYPES } from '../providers/userTypeContext'

const INDIVIDUAL_CHECKLIST_ITEMS = Object.freeze([
  { id: 'essentials_nearby', label: 'Essentials' },
  { id: 'healthcare_access', label: 'Healthcare' },
  { id: 'transit_access', label: 'Transit' },
  { id: 'parking_availability', label: 'Parking' },
  { id: 'green_space', label: 'Parks' },
  { id: 'noise_nightlife_density', label: 'Nightlife Noise' },
  { id: 'fitness_recreation', label: 'Fitness' },
  { id: 'overall_safety_level', label: 'Safety' },
  { id: 'crime_hotspots_nearby', label: 'Hotspots' },
  { id: 'top_crime_types', label: 'Crime Types' },
  { id: 'flood_risk', label: 'Flood' },
  { id: 'heat_risk', label: 'Heat' },
  { id: 'storm_wind_risk', label: 'Storm/Wind' },
  { id: 'overall_disaster_disruption_risk', label: 'Disruption' },
])

const SMALL_BIZ_CHECKLIST_ITEMS = Object.freeze([
  {
    id: 'foot_traffic_activity_proxy',
    label: 'Foot Traffic',
  },
  { id: 'retail_density', label: 'Retail' },
  { id: 'food_corridor_density', label: 'Food Corridor' },
  { id: 'nightlife_density', label: 'Nightlife' },
  { id: 'transit_access', label: 'Transit' },
  { id: 'parking_access', label: 'Parking' },
  { id: 'direct_competition', label: 'Competition' },
  { id: 'safety_level', label: 'Safety' },
  { id: 'crime_hotspots_and_types', label: 'Crime Mix' },
  { id: 'flood_risk', label: 'Flood' },
  { id: 'heat_risk', label: 'Heat' },
  { id: 'storm_wind_risk', label: 'Storm/Wind' },
  { id: 'overall_disruption_risk', label: 'Disruption' },
])

export const POI_CHECKLIST_ITEMS_BY_USER_TYPE = Object.freeze({
  [USER_TYPES.INDIVIDUAL]: INDIVIDUAL_CHECKLIST_ITEMS,
  [USER_TYPES.SMALL_BIZ]: SMALL_BIZ_CHECKLIST_ITEMS,
})

const buildInitialState = (items) => Object.fromEntries(items.map((item) => [item.id, false]))

export function createInitialChecklistState() {
  return {
    [USER_TYPES.INDIVIDUAL]: buildInitialState(INDIVIDUAL_CHECKLIST_ITEMS),
    [USER_TYPES.SMALL_BIZ]: buildInitialState(SMALL_BIZ_CHECKLIST_ITEMS),
  }
}

export function getChecklistItemsForUserType(userType) {
  const normalizedUserType = normalizeUserType(userType)
  return POI_CHECKLIST_ITEMS_BY_USER_TYPE[normalizedUserType]
}
