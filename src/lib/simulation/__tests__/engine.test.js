import { describe, it, expect } from 'vitest'
import { gaussian } from '../profiles.js'
import { computeWeight, computeDensityScale } from '../engine.js'
import { WEEKDAY_PROFILES, WEEKEND_PROFILES } from '../profiles.js'

// ---------------------------------------------------------------------------
// gaussian()
// ---------------------------------------------------------------------------

describe('gaussian()', () => {
  it('returns the amplitude at the exact peak', () => {
    expect(gaussian(12, 12, 2, 1.0)).toBeCloseTo(1.0, 5)
  })

  it('returns 0 amplitude for zero amplitude input', () => {
    expect(gaussian(12, 12, 2, 0)).toBe(0)
  })

  it('decays away from the peak', () => {
    const atPeak = gaussian(12, 12, 2, 1.0)
    const away = gaussian(16, 12, 2, 1.0)
    expect(away).toBeLessThan(atPeak)
  })

  it('is symmetric around the peak', () => {
    const left = gaussian(10, 12, 2, 1.0)
    const right = gaussian(14, 12, 2, 1.0)
    expect(left).toBeCloseTo(right, 10)
  })

  it('approaches zero far from the peak', () => {
    expect(gaussian(0, 12, 2, 1.0)).toBeLessThan(0.01)
  })
})

// ---------------------------------------------------------------------------
// computeDensityScale()
// ---------------------------------------------------------------------------

describe('computeDensityScale()', () => {
  it('returns 1.0 for reference density (5000 ppl/km²)', () => {
    // 5000 ppl/km² = 5000 / (1_000_000 / 1_000_000) → area = 1 km² = 1_000_000 m²
    expect(computeDensityScale(5000, 1_000_000)).toBeCloseTo(1.0, 5)
  })

  it('returns > 1 for high-density areas', () => {
    expect(computeDensityScale(20000, 1_000_000)).toBeGreaterThan(1)
  })

  it('caps at MAX_DENSITY_SCALE (2.0)', () => {
    expect(computeDensityScale(1_000_000, 1_000_000)).toBe(2.0)
  })

  it('returns minimum 0.1 for very sparse areas', () => {
    expect(computeDensityScale(1, 1_000_000_000)).toBeGreaterThanOrEqual(0.1)
  })

  it('returns 1.0 as fallback for invalid inputs', () => {
    expect(computeDensityScale(0, 1_000_000)).toBe(1.0)
    expect(computeDensityScale(5000, 0)).toBe(1.0)
    expect(computeDensityScale(null, null)).toBe(1.0)
  })
})

// ---------------------------------------------------------------------------
// computeWeight() – output range
// ---------------------------------------------------------------------------

const ALL_OVERPASS_TYPES = ['food', 'retail', 'grocery', 'healthcare', 'parking', 'transit', 'nightlife', 'parks']
/** @type {Array<'weekday'|'weekend'>} */
const ALL_DAY_TYPES = ['weekday', 'weekend']
/** @type {Array<'tenant'|'business'>} */
const ALL_FOCUS_MODES = ['tenant', 'business']

describe('computeWeight() – output range', () => {
  it('always returns a value between 0 and 1 for all combos', () => {
    for (const type of ALL_OVERPASS_TYPES) {
      for (const dayType of ALL_DAY_TYPES) {
        for (const focusMode of ALL_FOCUS_MODES) {
          for (let hour = 0; hour <= 24; hour += 0.5) {
            const w = computeWeight({ type }, hour, dayType, focusMode, 1.0)
            expect(w).toBeGreaterThanOrEqual(0)
            expect(w).toBeLessThanOrEqual(1.0)
          }
        }
      }
    }
  })

  it('returns 0–1 with high density scale (2.0)', () => {
    const w = computeWeight({ type: 'food' }, 12, 'weekday', 'business', 2.0)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThanOrEqual(1.0)
  })

  it('handles missing poi.type gracefully', () => {
    const poiNoType = /** @type {any} */ ({})
    const w = computeWeight(poiNoType, 12, 'weekday', 'business', 1.0)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThanOrEqual(1.0)
  })

  it('handles null poi gracefully', () => {
    const w = computeWeight(/** @type {any} */ (null), 12, 'weekday', 'business', 1.0)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThanOrEqual(1.0)
  })
})

// ---------------------------------------------------------------------------
// computeWeight() – focus mode modifiers
// ---------------------------------------------------------------------------

describe('computeWeight() – focus mode modifiers', () => {
  it('tenant mode penalises nightlife more than business mode', () => {
    const nightPOI = { type: 'nightlife' }
    const tenant = computeWeight(nightPOI, 22, 'weekday', 'tenant', 1.0)
    const business = computeWeight(nightPOI, 22, 'weekday', 'business', 1.0)
    expect(tenant).toBeLessThan(business)
  })

  it('business mode boosts food/retail over tenant mode', () => {
    // Use hour 10 (approaching lunch but below clamping threshold) so the
    // 1.3× business multiplier produces a measurably higher value than the
    // unmodified tenant weight.
    const foodPOI = { type: 'food' }
    const tenant = computeWeight(foodPOI, 10, 'weekday', 'tenant', 1.0)
    const business = computeWeight(foodPOI, 10, 'weekday', 'business', 1.0)
    expect(business).toBeGreaterThan(tenant)
  })

  it('tenant mode applies late-night quiet bonus (reduces weight after 22:00)', () => {
    const poi = { type: 'food' }
    const w_day = computeWeight(poi, 12, 'weekday', 'tenant', 1.0)
    const w_night = computeWeight(poi, 23, 'weekday', 'tenant', 1.0)
    // Night weight reduced by both profile and quiet multiplier
    expect(w_night).toBeLessThan(w_day)
  })
})

// ---------------------------------------------------------------------------
// Profile peak timing
// ---------------------------------------------------------------------------

describe('Weekday vs weekend profile peak timing', () => {
  it('food weekend peak is later than weekday breakfast', () => {
    // Weekday has a 07:00 breakfast peak; weekend brunch peaks at 10:00
    const weekdayMorningPeak = WEEKDAY_PROFILES.food(7)
    const weekendMorningPeak = WEEKEND_PROFILES.food(7)
    // Weekend should be lower at 07:00 than weekday
    expect(weekendMorningPeak).toBeLessThan(weekdayMorningPeak)
  })

  it('office weekend profile is much lower than weekday at 09:00', () => {
    const weekday = WEEKDAY_PROFILES.office(9)
    const weekend = WEEKEND_PROFILES.office(9)
    expect(weekend).toBeLessThan(weekday * 0.5)
  })

  it('leisure weekend peak is higher than weekday at afternoon hours', () => {
    const weekday = WEEKDAY_PROFILES.leisure(15)
    const weekend = WEEKEND_PROFILES.leisure(15)
    expect(weekend).toBeGreaterThan(weekday)
  })
})
