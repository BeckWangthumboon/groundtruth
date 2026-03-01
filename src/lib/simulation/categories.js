/**
 * @file POI category mapping.
 *
 * The Overpass backend (scripts_sumedh/overpass_pois.py) returns POIs with
 * one of these `type` values:
 *   food | retail | grocery | healthcare | parking | transit | nightlife | parks
 *
 * The Gaussian simulation profiles use a slightly different set of categories
 * that better represent human temporal behaviour:
 *   food | retail | office | nightlife | services | leisure
 *
 * This module provides the mapping between the two sets.
 */

/** @type {Record<string, string>} */
export const OVERPASS_TO_SIM_CATEGORY = {
  food:       'food',
  nightlife:  'nightlife',
  retail:     'retail',
  grocery:    'retail',    // Grocery stores follow general retail patterns
  healthcare: 'services',
  parking:    'services',
  transit:    'services',  // Transit hubs behave like service nodes
  parks:      'leisure',
}

/** Fallback simulation category when the POI type is unmapped. */
export const DEFAULT_SIM_CATEGORY = 'services'

/**
 * Map an Overpass POI type to its simulation category.
 *
 * @param {string} overpassType
 * @returns {string} Simulation category
 */
export function toSimCategory(overpassType) {
  return OVERPASS_TO_SIM_CATEGORY[overpassType] ?? DEFAULT_SIM_CATEGORY
}

/**
 * RGB colours for each simulation category used by the ScatterplotLayer.
 * Values are [R, G, B] in 0-255 range.
 *
 * @type {Record<string, [number, number, number]>}
 */
export const CATEGORY_COLORS = {
  food:      [255, 140,   0],  // orange
  retail:    [  0, 200,  83],  // green
  office:    [ 66, 133, 244],  // blue
  nightlife: [156,  39, 176],  // purple
  services:  [121, 134, 203],  // indigo
  leisure:   [ 38, 198, 218],  // cyan
}

/** Default colour for unrecognised categories [R, G, B]. */
export const DEFAULT_COLOR = [158, 158, 158]
