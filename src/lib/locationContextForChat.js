/**
 * Build the "location with metrics" payload for the chat API from the left-sidebar
 * census report data. The backend injects this into the system prompt so the
 * assistant can reason about the selected location (population, income, density, etc.).
 *
 * @param {{ derived?: { profile_summary?: object, tract_highlights?: object, geography_profiles_by_geoid?: object }, tract?: { reporter_geoid?: string } } | null} censusData - Response from /api/census/by-point
 * @param {string} [locationLabel] - Display name for the location (e.g. "Madison, WI")
 * @returns {Array<{ id: string, label: string, population?: number, population_density?: number, income?: number }>}
 */
export function buildLocationContextForChat(censusData, locationLabel) {
  if (!censusData?.derived) {
    return []
  }

  const profile = censusData.derived.profile_summary || {}
  const highlights = censusData.derived.tract_highlights || {}
  const tractGeoid =
    censusData.tract?.reporter_geoid ||
    profile.tract_geoid ||
    profile.geoid
  const geographyProfiles = censusData.derived.geography_profiles_by_geoid || {}
  const tractProfile = tractGeoid ? geographyProfiles[tractGeoid] : null
  const summary = tractProfile?.summary || profile

  const id = tractGeoid || 'current'
  const label =
    (typeof locationLabel === 'string' && locationLabel.trim()) ||
    summary.tract_name ||
    summary.name ||
    profile.tract_name ||
    profile.name ||
    'Selected location'

  const population =
    summary.population ?? profile.population ?? highlights.population
  const populationDensity =
    summary.density_per_sq_mile ?? profile.density_per_sq_mile ?? null
  const income =
    highlights.median_household_income ?? highlights.per_capita_income ?? null

  const loc = {
    id,
    label,
    ...(typeof population === 'number' && Number.isFinite(population)
      ? { population }
      : {}),
    ...(typeof populationDensity === 'number' && Number.isFinite(populationDensity)
      ? { population_density: populationDensity }
      : {}),
    ...(typeof income === 'number' && Number.isFinite(income)
      ? { income }
      : {}),
  }

  return [loc]
}
