/**
 * @file Core simulation engine.
 *
 * Provides the `computeWeight` function that drives all deck.gl layer
 * accessors, and a `computeDensityScale` helper that normalises population
 * density from Census ACS data.
 *
 * All functions are pure – no side-effects, no imports of React or Mapbox.
 */

import { toSimCategory } from './categories.js'
import { WEEKDAY_PROFILES, WEEKEND_PROFILES } from './profiles.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Population per km² considered "average" for the density scale factor. */
const REFERENCE_DENSITY_PER_KM2 = 5000

/** Maximum density scale multiplier (caps at 2× for very dense areas). */
const MAX_DENSITY_SCALE = 2.0

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Compute a normalised density scale factor from Census ACS data.
 *
 * @param {number} population    - ACS total population estimate (B01003)
 * @param {number} tractAreaSqM  - Tract land area in square metres (TIGER aland)
 * @returns {number} Density scale (0.1 – 2.0)
 */
export function computeDensityScale(population, tractAreaSqM) {
  if (!population || !tractAreaSqM || tractAreaSqM <= 0) {
    return 1.0
  }
  const popDensityPerKm2 = population / (tractAreaSqM / 1_000_000)
  return Math.min(MAX_DENSITY_SCALE, Math.max(0.1, popDensityPerKm2 / REFERENCE_DENSITY_PER_KM2))
}

/**
 * Compute the normalised foot-traffic weight (0–1) for a single POI at a
 * given simulated time and context.
 *
 * The pipeline is:
 *   1. Look up the Gaussian profile for the POI's simulation category.
 *   2. Evaluate the profile at `hour` → raw weight (may exceed 1.0 from bell
 *      sums before scaling).
 *   3. Multiply by `densityScale` to account for local population density.
 *   4. Apply focus-mode modifiers (tenant vs. business perspective).
 *   5. Clamp result to [0, 1].
 *
 * @param {{ type: string }} poi       - POI object (needs `.type` field)
 * @param {number}           hour      - Simulated hour 0–24 (fractional OK)
 * @param {'weekday'|'weekend'} dayType
 * @param {'tenant'|'business'} focusMode
 * @param {number}           densityScale - From computeDensityScale()
 * @returns {number} Clamped weight 0–1
 */
export function computeWeight(poi, hour, dayType, focusMode, densityScale = 1.0) {
  const category = toSimCategory(poi?.type ?? '')
  const profiles = dayType === 'weekend' ? WEEKEND_PROFILES : WEEKDAY_PROFILES
  const profile = profiles[category] ?? profiles.services

  let weight = profile(hour)

  // Population density scaling
  weight *= densityScale

  // Focus-mode modifiers
  if (focusMode === 'tenant') {
    // Tenants value quiet neighbourhoods: penalise nightlife noise, boost
    // leisure (parks, gyms), and apply a late-night quiet bonus.
    if (category === 'nightlife') weight *= 0.3
    if (category === 'leisure') weight *= 1.5
    if (hour >= 22 || hour <= 6) weight *= 0.5
  } else {
    // Business perspective values peak foot traffic.
    if (category === 'food' || category === 'retail') weight *= 1.3
    if (category === 'office') weight *= 1.2
  }

  return Math.max(0, Math.min(weight, 1.0))
}
