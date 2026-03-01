const LEVEL_LABELS = {
  census_block: 'Block',
  census_block_group: 'Block group',
  census_tract: 'Tract',
}

const AGE_BAND_GROUPS = [
  {
    name: '0-9',
    ids: ['B01001003', 'B01001004', 'B01001027', 'B01001028'],
  },
  {
    name: '10-19',
    ids: ['B01001005', 'B01001006', 'B01001007', 'B01001029', 'B01001030', 'B01001031'],
  },
  {
    name: '20-29',
    ids: ['B01001008', 'B01001009', 'B01001010', 'B01001011', 'B01001032', 'B01001033', 'B01001034', 'B01001035'],
  },
  {
    name: '30-39',
    ids: ['B01001012', 'B01001013', 'B01001036', 'B01001037'],
  },
  {
    name: '40-49',
    ids: ['B01001014', 'B01001015', 'B01001038', 'B01001039'],
  },
  {
    name: '50-59',
    ids: ['B01001016', 'B01001017', 'B01001040', 'B01001041'],
  },
  {
    name: '60-69',
    ids: ['B01001018', 'B01001019', 'B01001020', 'B01001021', 'B01001042', 'B01001043', 'B01001044', 'B01001045'],
  },
  {
    name: '70-79',
    ids: ['B01001022', 'B01001023', 'B01001046', 'B01001047'],
  },
  {
    name: '80+',
    ids: ['B01001024', 'B01001025', 'B01001048', 'B01001049'],
  },
]

const AGE_CATEGORY_GROUPS = [
  {
    name: 'Under 18',
    ids: ['B01001003', 'B01001004', 'B01001005', 'B01001006', 'B01001027', 'B01001028', 'B01001029', 'B01001030'],
  },
  {
    name: '18 to 64',
    ids: [
      'B01001007',
      'B01001008',
      'B01001009',
      'B01001010',
      'B01001011',
      'B01001012',
      'B01001013',
      'B01001014',
      'B01001015',
      'B01001016',
      'B01001017',
      'B01001018',
      'B01001019',
      'B01001031',
      'B01001032',
      'B01001033',
      'B01001034',
      'B01001035',
      'B01001036',
      'B01001037',
      'B01001038',
      'B01001039',
      'B01001040',
      'B01001041',
      'B01001042',
      'B01001043',
    ],
  },
  {
    name: '65 and over',
    ids: ['B01001020', 'B01001021', 'B01001022', 'B01001023', 'B01001024', 'B01001025', 'B01001044', 'B01001045', 'B01001046', 'B01001047', 'B01001048', 'B01001049'],
  },
]

const RACE_GROUPS = [
  { name: 'White', id: 'B03002003' },
  { name: 'Black', id: 'B03002004' },
  { name: 'Native', id: 'B03002005' },
  { name: 'Asian', id: 'B03002006' },
  { name: 'Islander', id: 'B03002007' },
  { name: 'Other', id: 'B03002008' },
  { name: 'Two+', id: 'B03002009' },
  { name: 'Hispanic', id: 'B03002012' },
]

function toFiniteNumber(value) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function prettyLabel(rawLabel) {
  if (!rawLabel) {
    return ''
  }

  return rawLabel
    .replace(/:\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactLabel(rawLabel) {
  return prettyLabel(rawLabel)
    .replace(/Less than\s+/i, '< ')
    .replace(/\s+to\s+/gi, '-')
    .replace(/\s+or more$/i, '+')
    .replace(/\s+and\s+over$/i, '+')
}

function makeUnavailableChart({ id, sectionId, title, chartType = 'bar', reason, sourceLevel = null }) {
  return {
    id,
    sectionId,
    title,
    chartType,
    unavailable: true,
    reason,
    sourceLevel,
    data: [],
  }
}

function normalizeRow(name, value, total) {
  const pct = total > 0 ? (value / total) * 100 : null
  return {
    name,
    shortName: compactLabel(name),
    value,
    pct,
  }
}

function getTableSourceLevel(payload, tableId) {
  return payload?.data_effective?.table_sources?.[tableId]?.level ?? payload?.selected_for_acs_data?.selected_level ?? null
}

function getEstimateMap(payload, tableId) {
  const effectiveEstimate = payload?.data_effective?.by_table?.[tableId]?.estimate
  if (effectiveEstimate && typeof effectiveEstimate === 'object') {
    return effectiveEstimate
  }

  const selectedGeoid = payload?.selected_for_acs_data?.reporter_geoid
  const fallbackEstimate = payload?.data_raw?.data?.[selectedGeoid]?.[tableId]?.estimate
  if (fallbackEstimate && typeof fallbackEstimate === 'object') {
    return fallbackEstimate
  }

  return null
}

function getColumnMetaMap(payload, tableId) {
  const glossaryColumns = payload?.table_glossary?.[tableId]?.columns
  if (glossaryColumns && typeof glossaryColumns === 'object' && Object.keys(glossaryColumns).length > 0) {
    return glossaryColumns
  }

  const effectiveColumns = payload?.data_effective?.tables?.[tableId]?.columns
  if (effectiveColumns && typeof effectiveColumns === 'object' && Object.keys(effectiveColumns).length > 0) {
    return effectiveColumns
  }

  const selectedColumns = payload?.data_raw?.tables?.[tableId]?.columns
  if (selectedColumns && typeof selectedColumns === 'object' && Object.keys(selectedColumns).length > 0) {
    return selectedColumns
  }

  return null
}

function getDenominatorColumnId(payload, tableId) {
  return (
    payload?.table_glossary?.[tableId]?.denominator_column_id ??
    payload?.data_effective?.tables?.[tableId]?.denominator_column_id ??
    payload?.data_raw?.tables?.[tableId]?.denominator_column_id ??
    null
  )
}

function getUniverseText(payload, tableId) {
  return payload?.table_glossary?.[tableId]?.universe ?? payload?.data_raw?.tables?.[tableId]?.universe ?? null
}

function buildTableContext(payload, tableId) {
  const estimateMap = getEstimateMap(payload, tableId)
  if (!estimateMap || Object.keys(estimateMap).length === 0) {
    return null
  }

  const columnMeta = getColumnMetaMap(payload, tableId)
  if (!columnMeta || Object.keys(columnMeta).length === 0) {
    return null
  }

  return {
    tableId,
    estimateMap,
    columnMeta,
    denominatorColumnId: getDenominatorColumnId(payload, tableId),
    sourceLevel: getTableSourceLevel(payload, tableId),
    universe: getUniverseText(payload, tableId),
  }
}

function sumColumnsStrict(estimateMap, columnIds) {
  let total = 0
  for (const columnId of columnIds) {
    const value = toFiniteNumber(estimateMap?.[columnId])
    if (value == null) {
      return null
    }
    total += value
  }
  return total
}

function buildTopLevelDistributionChart(payload, { id, sectionId, tableId, title, chartType = 'bar' }) {
  const context = buildTableContext(payload, tableId)
  if (!context) {
    return makeUnavailableChart({
      id,
      sectionId,
      title,
      chartType,
      reason: `${tableId} data unavailable.`,
      sourceLevel: getTableSourceLevel(payload, tableId),
    })
  }

  const entries = Object.entries(context.columnMeta)
    .filter(([, meta]) => Number(meta?.indent ?? 99) <= 1)
    .filter(([, meta]) => prettyLabel(meta?.name).toLowerCase() !== 'total')

  if (entries.length < 2) {
    return makeUnavailableChart({
      id,
      sectionId,
      title,
      chartType,
      reason: `${tableId} has no category breakdown.`,
      sourceLevel: context.sourceLevel,
    })
  }

  const rows = []
  for (const [columnId, meta] of entries) {
    const value = toFiniteNumber(context.estimateMap?.[columnId])
    if (value == null) {
      return makeUnavailableChart({
        id,
        sectionId,
        title,
        chartType,
        reason: `${tableId} has incomplete category values.`,
        sourceLevel: context.sourceLevel,
      })
    }

    rows.push({
      columnId,
      label: prettyLabel(meta?.name),
      value,
    })
  }

  const denominatorValue = toFiniteNumber(context.estimateMap?.[context.denominatorColumnId])
  const total = denominatorValue != null ? denominatorValue : rows.reduce((sum, row) => sum + row.value, 0)

  if (!(total > 0)) {
    return makeUnavailableChart({
      id,
      sectionId,
      title,
      chartType,
      reason: `${tableId} total is unavailable.`,
      sourceLevel: context.sourceLevel,
    })
  }

  return {
    id,
    sectionId,
    title,
    chartType,
    unavailable: false,
    sourceLevel: context.sourceLevel,
    tableId,
    universe: context.universe,
    total,
    data: rows.map((row) => normalizeRow(row.label, row.value, total)),
  }
}

function buildAgeCharts(payload) {
  const tableId = 'B01001'
  const context = buildTableContext(payload, tableId)

  if (!context) {
    return [
      makeUnavailableChart({
        id: 'age-bands',
        sectionId: 'demographics',
        title: 'Population by age range',
        reason: `${tableId} data unavailable.`,
        sourceLevel: getTableSourceLevel(payload, tableId),
      }),
      makeUnavailableChart({
        id: 'age-category',
        sectionId: 'demographics',
        title: 'Population by age category',
        chartType: 'pie',
        reason: `${tableId} data unavailable.`,
        sourceLevel: getTableSourceLevel(payload, tableId),
      }),
      makeUnavailableChart({
        id: 'sex-share',
        sectionId: 'demographics',
        title: 'Sex',
        chartType: 'pie',
        reason: `${tableId} data unavailable.`,
        sourceLevel: getTableSourceLevel(payload, tableId),
      }),
    ]
  }

  const total = toFiniteNumber(context.estimateMap?.[context.denominatorColumnId])
  if (!(total > 0)) {
    const reason = `${tableId} total is unavailable.`
    return [
      makeUnavailableChart({ id: 'age-bands', sectionId: 'demographics', title: 'Population by age range', reason, sourceLevel: context.sourceLevel }),
      makeUnavailableChart({ id: 'age-category', sectionId: 'demographics', title: 'Population by age category', chartType: 'pie', reason, sourceLevel: context.sourceLevel }),
      makeUnavailableChart({ id: 'sex-share', sectionId: 'demographics', title: 'Sex', chartType: 'pie', reason, sourceLevel: context.sourceLevel }),
    ]
  }

  const ageBandRows = []
  for (const group of AGE_BAND_GROUPS) {
    const value = sumColumnsStrict(context.estimateMap, group.ids)
    if (value == null) {
      return [
        makeUnavailableChart({
          id: 'age-bands',
          sectionId: 'demographics',
          title: 'Population by age range',
          reason: `${tableId} age bins are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
        makeUnavailableChart({
          id: 'age-category',
          sectionId: 'demographics',
          title: 'Population by age category',
          chartType: 'pie',
          reason: `${tableId} age bins are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
        makeUnavailableChart({
          id: 'sex-share',
          sectionId: 'demographics',
          title: 'Sex',
          chartType: 'pie',
          reason: `${tableId} age bins are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
      ]
    }
    ageBandRows.push(normalizeRow(group.name, value, total))
  }

  const ageCategoryRows = []
  for (const group of AGE_CATEGORY_GROUPS) {
    const value = sumColumnsStrict(context.estimateMap, group.ids)
    if (value == null) {
      return [
        makeUnavailableChart({
          id: 'age-bands',
          sectionId: 'demographics',
          title: 'Population by age range',
          reason: `${tableId} age categories are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
        makeUnavailableChart({
          id: 'age-category',
          sectionId: 'demographics',
          title: 'Population by age category',
          chartType: 'pie',
          reason: `${tableId} age categories are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
        makeUnavailableChart({
          id: 'sex-share',
          sectionId: 'demographics',
          title: 'Sex',
          chartType: 'pie',
          reason: `${tableId} age categories are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
      ]
    }
    ageCategoryRows.push(normalizeRow(group.name, value, total))
  }

  const male = toFiniteNumber(context.estimateMap?.B01001002)
  const female = toFiniteNumber(context.estimateMap?.B01001026)

  const sexRows =
    male == null || female == null
      ? null
      : [
          normalizeRow('Male', male, total),
          normalizeRow('Female', female, total),
        ]

  return [
    {
      id: 'age-bands',
      sectionId: 'demographics',
      title: 'Population by age range',
      chartType: 'bar',
      unavailable: false,
      sourceLevel: context.sourceLevel,
      tableId,
      universe: context.universe,
      total,
      data: ageBandRows,
    },
    {
      id: 'age-category',
      sectionId: 'demographics',
      title: 'Population by age category',
      chartType: 'pie',
      unavailable: false,
      sourceLevel: context.sourceLevel,
      tableId,
      universe: context.universe,
      total,
      data: ageCategoryRows,
    },
    sexRows
      ? {
          id: 'sex-share',
          sectionId: 'demographics',
          title: 'Sex',
          chartType: 'pie',
          unavailable: false,
          sourceLevel: context.sourceLevel,
          tableId,
          universe: context.universe,
          total,
          data: sexRows,
        }
      : makeUnavailableChart({
          id: 'sex-share',
          sectionId: 'demographics',
          title: 'Sex',
          chartType: 'pie',
          reason: `${tableId} sex totals are incomplete.`,
          sourceLevel: context.sourceLevel,
        }),
  ]
}

function buildRaceChart(payload) {
  const tableId = 'B03002'
  const context = buildTableContext(payload, tableId)
  if (!context) {
    return makeUnavailableChart({
      id: 'race-ethnicity',
      sectionId: 'demographics',
      title: 'Race & ethnicity',
      reason: `${tableId} data unavailable.`,
      sourceLevel: getTableSourceLevel(payload, tableId),
    })
  }

  const total = toFiniteNumber(context.estimateMap?.[context.denominatorColumnId])
  if (!(total > 0)) {
    return makeUnavailableChart({
      id: 'race-ethnicity',
      sectionId: 'demographics',
      title: 'Race & ethnicity',
      reason: `${tableId} total is unavailable.`,
      sourceLevel: context.sourceLevel,
    })
  }

  const rows = []
  for (const group of RACE_GROUPS) {
    const value = toFiniteNumber(context.estimateMap?.[group.id])
    if (value == null) {
      return makeUnavailableChart({
        id: 'race-ethnicity',
        sectionId: 'demographics',
        title: 'Race & ethnicity',
        reason: `${tableId} race categories are incomplete.`,
        sourceLevel: context.sourceLevel,
      })
    }

    rows.push(normalizeRow(group.name, value, total))
  }

  return {
    id: 'race-ethnicity',
    sectionId: 'demographics',
    title: 'Race & ethnicity',
    chartType: 'bar',
    unavailable: false,
    sourceLevel: context.sourceLevel,
    tableId,
    universe: context.universe,
    total,
    data: rows,
  }
}

function buildPovertyChart(payload) {
  const tableId = 'B17001'
  const context = buildTableContext(payload, tableId)
  if (!context) {
    return makeUnavailableChart({
      id: 'poverty-status',
      sectionId: 'economy',
      title: 'Poverty status',
      chartType: 'pie',
      reason: `${tableId} data unavailable.`,
      sourceLevel: getTableSourceLevel(payload, tableId),
    })
  }

  const total = toFiniteNumber(context.estimateMap?.B17001001)
  const below = toFiniteNumber(context.estimateMap?.B17001002)

  if (!(total > 0) || below == null) {
    return makeUnavailableChart({
      id: 'poverty-status',
      sectionId: 'economy',
      title: 'Poverty status',
      chartType: 'pie',
      reason: `${tableId} poverty totals are incomplete.`,
      sourceLevel: context.sourceLevel,
    })
  }

  const atOrAbove = total - below
  if (atOrAbove < 0) {
    return makeUnavailableChart({
      id: 'poverty-status',
      sectionId: 'economy',
      title: 'Poverty status',
      chartType: 'pie',
      reason: `${tableId} totals are inconsistent.`,
      sourceLevel: context.sourceLevel,
    })
  }

  return {
    id: 'poverty-status',
    sectionId: 'economy',
    title: 'Poverty status',
    chartType: 'pie',
    unavailable: false,
    sourceLevel: context.sourceLevel,
    tableId,
    universe: context.universe,
    total,
    data: [normalizeRow('Below poverty', below, total), normalizeRow('At or above poverty', atOrAbove, total)],
  }
}

function buildSection(id, title, charts) {
  return {
    id,
    title,
    charts,
  }
}

function sortByLargestShare(rows) {
  return [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
}

function withSortedData(chart) {
  if (!chart || chart.unavailable || !Array.isArray(chart.data)) {
    return chart
  }
  return {
    ...chart,
    data: sortByLargestShare(chart.data),
  }
}

export function buildCensusChartSections(payload) {
  if (!payload) {
    return []
  }

  const demographicsCharts = [...buildAgeCharts(payload), buildRaceChart(payload)]

  const economyCharts = [
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'income-distribution',
        sectionId: 'economy',
        tableId: 'B19001',
        title: 'Household income distribution',
        chartType: 'bar',
      })
    ),
    buildPovertyChart(payload),
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'employment-status',
        sectionId: 'economy',
        tableId: 'B23025',
        title: 'Employment status',
        chartType: 'pie',
      })
    ),
  ]

  const housingCharts = [
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'occupancy-status',
        sectionId: 'housing',
        tableId: 'B25002',
        title: 'Units by occupancy',
        chartType: 'pie',
      })
    ),
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'tenure',
        sectionId: 'housing',
        tableId: 'B25003',
        title: 'Owner vs renter',
        chartType: 'pie',
      })
    ),
    buildTopLevelDistributionChart(payload, {
      id: 'units-in-structure',
      sectionId: 'housing',
      tableId: 'B25024',
      title: 'Units by structure type',
      chartType: 'bar',
    }),
    buildTopLevelDistributionChart(payload, {
      id: 'home-value-distribution',
      sectionId: 'housing',
      tableId: 'B25075',
      title: 'Home value distribution',
      chartType: 'bar',
    }),
  ]

  const socialMobilityCharts = [
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'household-type',
        sectionId: 'social_mobility',
        tableId: 'B11001',
        title: 'Household type',
        chartType: 'pie',
      })
    ),
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'commute-mode',
        sectionId: 'social_mobility',
        tableId: 'B08301',
        title: 'Commute mode',
        chartType: 'pie',
      })
    ),
    buildTopLevelDistributionChart(payload, {
      id: 'travel-time',
      sectionId: 'social_mobility',
      tableId: 'B08303',
      title: 'Travel time to work',
      chartType: 'bar',
    }),
    buildTopLevelDistributionChart(payload, {
      id: 'education-attainment',
      sectionId: 'social_mobility',
      tableId: 'B15003',
      title: 'Educational attainment',
      chartType: 'bar',
    }),
    withSortedData(
      buildTopLevelDistributionChart(payload, {
        id: 'veteran-status',
        sectionId: 'social_mobility',
        tableId: 'B21001',
        title: 'Veteran status',
        chartType: 'pie',
      })
    ),
  ]

  return [
    buildSection('demographics', 'Demographics', demographicsCharts),
    buildSection('economy', 'Economy & Poverty', economyCharts),
    buildSection('housing', 'Housing', housingCharts),
    buildSection('social_mobility', 'Social & Mobility', socialMobilityCharts),
  ].map((section) => ({
    ...section,
    charts: section.charts.map((chart) => ({
      ...chart,
      sourceLabel: chart?.sourceLevel ? LEVEL_LABELS[chart.sourceLevel] ?? chart.sourceLevel : null,
    })),
  }))
}
