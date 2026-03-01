import { CENSUS_SECTION_ORDER, CENSUS_SECTIONS, CENSUS_TABLE_CATALOG, SNAPSHOT_TABLE_IDS } from './censusTableCatalog'
import { buildCensusChartSections } from './censusChartModel'

function toFiniteNumber(value) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function isUnavailableValue(estimate, isSentinelNegativeMedian) {
  if (estimate == null) {
    return true
  }
  if (isSentinelNegativeMedian) {
    return true
  }
  return false
}

function formatNumber(value) {
  if (value == null) {
    return 'n/a'
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  })
}

function formatEstimate(value, format) {
  if (value == null) {
    return 'n/a'
  }
  if (format === 'currency') {
    return `$${formatNumber(value)}`
  }
  return formatNumber(value)
}

function formatMarginOfError(value) {
  if (value == null) {
    return 'n/a'
  }
  return `±${formatNumber(value)}`
}

function computeConfidence(estimate, marginOfError, unavailable) {
  if (unavailable || estimate == null || marginOfError == null || estimate <= 0) {
    return {
      level: 'Low',
      ratio: null,
    }
  }

  const ratio = Math.abs(marginOfError) / Math.abs(estimate)
  if (ratio <= 0.1) {
    return { level: 'High', ratio }
  }
  if (ratio <= 0.25) {
    return { level: 'Medium', ratio }
  }
  return { level: 'Low', ratio }
}

function computeFillPct(estimate, unavailable, contextRange) {
  if (unavailable || estimate == null || !contextRange) {
    return null
  }
  const [min, max] = contextRange
  if (max === min) return null
  return Math.max(0, Math.min(1, (estimate - min) / (max - min))) * 100
}

function buildRowModel(tableId, catalogEntry, byTable) {
  const raw = byTable?.[tableId]
  const estimate = toFiniteNumber(raw?.estimate)
  const marginOfError = toFiniteNumber(raw?.margin_of_error)
  const isSentinelNegativeMedian = Boolean(raw?.is_sentinel_negative_median)
  const unavailable = isUnavailableValue(estimate, isSentinelNegativeMedian)
  const confidence = computeConfidence(estimate, marginOfError, unavailable)
  const fillPct = computeFillPct(estimate, unavailable, catalogEntry.contextRange)

  return {
    tableId,
    label: catalogEntry.label,
    section: catalogEntry.section,
    priority: catalogEntry.priority,
    estimate,
    marginOfError,
    isSentinelNegativeMedian,
    unavailable,
    estimateText: unavailable ? 'n/a' : formatEstimate(estimate, catalogEntry.format),
    marginOfErrorText: unavailable ? null : formatMarginOfError(marginOfError),
    confidence,
    fillPct,
  }
}

export function buildCensusDisplayModel(data) {
  const byTable = data?.data_interpreted?.by_table || {}

  const allRows = Object.entries(CENSUS_TABLE_CATALOG).map(([tableId, catalogEntry]) =>
    buildRowModel(tableId, catalogEntry, byTable)
  )

  const snapshotCards = SNAPSHOT_TABLE_IDS.map((tableId) => allRows.find((row) => row.tableId === tableId)).filter(
    Boolean
  )

  const sections = CENSUS_SECTION_ORDER.map((sectionId) => {
    const sectionMeta = CENSUS_SECTIONS[sectionId]
    const rows = allRows
      .filter((row) => row.section === sectionId)
      .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))

    return {
      id: sectionId,
      title: sectionMeta.title,
      shortTitle: sectionMeta.shortTitle,
      color: sectionMeta.color,
      iconName: sectionMeta.iconName,
      rows,
    }
  }).filter((section) => section.rows.length > 0)

  return {
    snapshotCards,
    sections,
    chartSections: buildCensusChartSections(data),
  }
}
