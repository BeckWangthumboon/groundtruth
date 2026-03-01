/**
 * @file Gaussian mixture traffic profiles by category and day type.
 *
 * Each profile is a function `(hour: number) => number` that returns the
 * *base* foot-traffic weight (0–1) for a given simulated hour.  The value is
 * later scaled by population density and modulated by the focus mode in
 * engine.js.
 *
 * Profiles are defined as sums of Gaussian bells:
 *   amplitude * exp(-0.5 * ((hour - mu) / sigma)^2)
 *
 * Weekday profiles model typical Mon–Fri patterns.
 * Weekend profiles shift peaks later and flatten the office signal.
 */

/**
 * Single Gaussian bell centred at `mu` with spread `sigma`.
 *
 * @param {number} hour
 * @param {number} mu        - Peak hour
 * @param {number} sigma     - Standard deviation in hours
 * @param {number} amplitude - Peak amplitude (0–1)
 * @returns {number}
 */
export function gaussian(hour, mu, sigma, amplitude) {
  return amplitude * Math.exp(-0.5 * ((hour - mu) / sigma) ** 2)
}

// ---------------------------------------------------------------------------
// Weekday profiles (Monday – Friday)
// ---------------------------------------------------------------------------

/** @type {Record<string, (hour: number) => number>} */
export const WEEKDAY_PROFILES = {
  /** Breakfast rush 07:00, lunch peak 12:00, dinner rush 18:30 */
  food: (h) =>
    gaussian(h, 7, 1.5, 0.3) +
    gaussian(h, 12, 1.0, 1.0) +
    gaussian(h, 18.5, 1.5, 0.9),

  /** Mid-day and late-afternoon shopping */
  retail: (h) =>
    gaussian(h, 12, 2.0, 0.6) +
    gaussian(h, 17, 2.0, 0.8),

  /** Morning arrival 09:00, lunch dip 13:00, early-evening departure 17:00 */
  office: (h) =>
    gaussian(h, 9, 1.0, 0.9) +
    gaussian(h, 13, 1.0, 0.5) +
    gaussian(h, 17, 1.0, 0.3),

  /** Evening activity starts at 21:00, peaks at midnight */
  nightlife: (h) =>
    gaussian(h, 21, 2.0, 0.7) +
    gaussian(h, 23, 1.5, 1.0),

  /** Morning service peak 10:00, early-afternoon secondary 14:00 */
  services: (h) =>
    gaussian(h, 10, 2.0, 0.7) +
    gaussian(h, 14, 2.0, 0.5),

  /** Mid-morning 10:00 and after-work 16:00 leisure */
  leisure: (h) =>
    gaussian(h, 10, 3.0, 0.4) +
    gaussian(h, 16, 2.0, 0.6),
}

// ---------------------------------------------------------------------------
// Weekend profiles (Saturday – Sunday)
// Weekend peaks shift ~1–2 h later; offices are nearly empty; nightlife
// extends; leisure and food see broader, higher peaks.
// ---------------------------------------------------------------------------

/** @type {Record<string, (hour: number) => number>} */
export const WEEKEND_PROFILES = {
  /** Brunch peak 10:00, lunch 13:00, dinner 19:00 */
  food: (h) =>
    gaussian(h, 10, 2.0, 0.6) +
    gaussian(h, 13, 1.5, 0.8) +
    gaussian(h, 19, 2.0, 1.0),

  /** Broad afternoon shopping 13:00 */
  retail: (h) =>
    gaussian(h, 13, 3.0, 0.9),

  /** Nearly empty – skeleton staff only */
  office: (h) =>
    gaussian(h, 12, 4.0, 0.15),

  /** Late night peak 22:00, after-midnight 00:30 */
  nightlife: (h) =>
    gaussian(h, 22, 2.0, 0.9) +
    gaussian(h, 0.5, 1.5, 1.0),

  /** Reduced service hours – mid-morning only */
  services: (h) =>
    gaussian(h, 11, 2.0, 0.3),

  /** Broad morning–afternoon leisure window */
  leisure: (h) =>
    gaussian(h, 11, 3.0, 0.8) +
    gaussian(h, 15, 3.0, 0.7),
}
