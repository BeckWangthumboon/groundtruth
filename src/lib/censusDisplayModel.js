const SECTION_ORDER = ['demographics', 'economics', 'families', 'housing', 'social']

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatNumber(value, maxFractionDigits = 1) {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : maxFractionDigits,
  })
}

function formatEstimate(metric) {
  const estimate = metric?.estimate
  if (!isFiniteNumber(estimate)) {
    return 'N/A'
  }

  switch (metric?.format) {
    case 'currency':
      return `$${formatNumber(estimate, 0)}`
    case 'percent':
      return `${estimate.toFixed(1)}%`
    case 'minutes':
      return `${estimate.toFixed(1)} minutes`
    default:
      return formatNumber(estimate, 1)
  }
}

function formatMoe(metric) {
  const moe = metric?.moe
  if (!isFiniteNumber(moe)) {
    return null
  }

  if (metric?.format === 'currency') {
    return `±$${formatNumber(moe, 0)}`
  }
  if (metric?.format === 'percent') {
    return `±${moe.toFixed(1)}%`
  }
  if (metric?.format === 'minutes') {
    return `±${moe.toFixed(1)} min`
  }
  return `±${formatNumber(moe, 1)}`
}

function formatAreaSqMiles(value) {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  if (value < 0.1) {
    return `${value.toFixed(2)} sq mi`
  }
  return `${value.toFixed(1)} sq mi`
}

function formatDensity(value) {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  return `${formatNumber(value, 1)} people / sq mi`
}

function buildProfileModel(data) {
  const profileSummary = data?.derived?.profile_summary ?? {}
  const release = data?.release
  const hierarchy = Array.isArray(profileSummary?.hierarchy) ? profileSummary.hierarchy : []

  const hierarchyLine = hierarchy
    .map((entry) => entry?.name)
    .filter(Boolean)
    .join(', ')

  return {
    tractName: profileSummary?.tract_name || data?.tract?.geocoder_tract_record?.NAME || 'Census profile',
    hierarchyLine,
    populationText: formatNumber(profileSummary?.population, 0),
    areaText: formatAreaSqMiles(profileSummary?.area_sq_miles),
    densityText: formatDensity(profileSummary?.density_per_sq_mile),
    releaseText:
      release?.name || (release?.id ? `Census data: ${release.id}` : 'Census data: ACS 5-year estimates'),
  }
}

function normalizeMetric(metric) {
  const comparisons = Array.isArray(metric?.comparisons)
    ? metric.comparisons.map((line) => line?.line).filter(Boolean)
    : []

  return {
    id: metric?.id || '',
    label: metric?.label || 'Metric',
    estimate: metric?.estimate,
    format: metric?.format || 'number',
    estimateText: formatEstimate(metric),
    moeText: formatMoe(metric),
    moeRatio: isFiniteNumber(metric?.moe_ratio) ? metric.moe_ratio : null,
    highMoe: Boolean(metric?.high_moe),
    universe: metric?.universe || null,
    comparisons,
  }
}

function normalizeChart(chart) {
  const series = Array.isArray(chart?.series)
    ? chart.series.map((entry) => ({
        label: entry?.label || 'Value',
        valuePct: isFiniteNumber(entry?.value_pct) ? entry.value_pct : null,
        count: isFiniteNumber(entry?.count) ? entry.count : null,
      }))
    : []

  return {
    id: chart?.id || '',
    label: chart?.label || 'Chart',
    type: chart?.type || 'bar',
    universe: chart?.universe || null,
    note: chart?.note || null,
    series,
  }
}

export function buildCensusDisplayModel(data) {
  const sectionsRaw = Array.isArray(data?.derived?.sections) ? data.derived.sections : []

  const orderedSections = [...sectionsRaw].sort((a, b) => {
    const idxA = SECTION_ORDER.indexOf(a?.id)
    const idxB = SECTION_ORDER.indexOf(b?.id)
    const rankA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA
    const rankB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB
    return rankA - rankB
  })

  const sections = orderedSections.map((section) => {
    const metrics = (Array.isArray(section?.metrics) ? section.metrics : []).map(normalizeMetric)
    const charts = (Array.isArray(section?.charts) ? section.charts : []).map(normalizeChart)
    return {
      id: section?.id || 'section',
      title: section?.title || 'Section',
      metrics,
      charts,
      hasHighMoe: metrics.some((metric) => metric.highMoe),
    }
  })

  return {
    profile: buildProfileModel(data),
    sections,
  }
}
