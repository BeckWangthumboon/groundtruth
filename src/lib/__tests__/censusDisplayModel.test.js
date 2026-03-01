import { describe, expect, it } from 'vitest'
import { buildCensusDisplayModel } from '../censusDisplayModel'

const SAMPLE_PAYLOAD = {
  release: { id: 'acs2024_5yr', name: 'ACS 2024 5-year' },
  derived: {
    profile_summary: {
      tract_name: 'Census Tract 17.04, Dane, WI',
      hierarchy: [
        { geoid: '14000US55025001704', name: 'Census Tract 17.04, Dane, WI' },
        { geoid: '16000US5548000', name: 'Madison city, WI' },
        { geoid: '05000US55025', name: 'Dane County, WI' },
      ],
      population: 8835,
      area_sq_miles: 0.2,
      density_per_sq_mile: 54266.5,
    },
    selector_options: [
      { kind: 'tract', geoid: '14000US55025001704', label: 'Census Tract', available: true },
      { kind: 'county', geoid: '05000US55025', label: 'County', available: true },
    ],
    geography_profiles_by_geoid: {
      '14000US55025001704': {
        summary: {
          geoid: '14000US55025001704',
          name: 'Census Tract 17.04, Dane, WI',
          population: 8835,
          area_sq_miles: 0.2,
          density_per_sq_mile: 54266.5,
        },
        sections: [
          {
            id: 'economics',
            title: 'Economics',
            metrics: [
              {
                id: 'median_household_income',
                label: 'Median household income',
                estimate: 30683,
                moe: 4500,
                moe_ratio: 0.146,
                high_moe: true,
                format: 'currency',
                universe: 'Households',
                comparisons: [{ line: 'about two-fifths of the figure in Madison city, WI: $78,050' }],
              },
            ],
            charts: [
              {
                id: 'household_income_distribution',
                label: 'Household income',
                type: 'bar',
                series: [
                  { label: 'Under $50K', value_pct: 74, count: 1500 },
                  { label: '$50K - $100K', value_pct: 14, count: 280 },
                ],
              },
            ],
          },
          {
            id: 'demographics',
            title: 'Demographics',
            metrics: [
              {
                id: 'median_age',
                label: 'Median age',
                estimate: 20.5,
                moe: 3.4,
                moe_ratio: 0.166,
                high_moe: true,
                format: 'number',
                comparisons: [{ line: 'about two-thirds of the figure in Madison city, WI: 31.8' }],
              },
            ],
            charts: [],
          },
        ],
      },
      '05000US55025': {
        summary: {
          geoid: '05000US55025',
          name: 'Dane County, WI',
          population: 585000,
          area_sq_miles: null,
          density_per_sq_mile: null,
        },
        sections: [
          {
            id: 'economics',
            title: 'Economics',
            metrics: [
              {
                id: 'median_household_income',
                label: 'Median household income',
                estimate: 89975,
                moe: 5100,
                moe_ratio: 0.056,
                high_moe: false,
                format: 'currency',
                universe: 'Households',
                comparisons: [{ line: 'about one-and-a-half times the figure in Wisconsin: $73,000' }],
              },
            ],
            charts: [],
          },
        ],
      },
    },
    sections: [
      {
        id: 'demographics',
        title: 'Demographics',
        metrics: [],
        charts: [],
      },
    ],
  },
}

describe('buildCensusDisplayModel', () => {
  it('builds profile summary and ordered sections for tract by default', () => {
    const model = buildCensusDisplayModel(SAMPLE_PAYLOAD)

    expect(model.selectedGeoid).toBe('14000US55025001704')
    expect(model.selectorOptions).toHaveLength(2)
    expect(model.profile.tractName).toBe('Census Tract 17.04, Dane, WI')
    expect(model.profile.populationText).toBe('8,835')
    expect(model.profile.areaText).toContain('sq mi')
    expect(model.profile.densityText).toContain('people / sq mi')

    // Demographics should come before economics due to canonical section order.
    expect(model.sections[0].id).toBe('demographics')
    expect(model.sections[1].id).toBe('economics')
  })

  it('formats metric values and preserves comparison lines', () => {
    const model = buildCensusDisplayModel(SAMPLE_PAYLOAD)
    const economics = model.sections.find((section) => section.id === 'economics')
    const metric = economics.metrics[0]

    expect(metric.estimateText).toBe('$30,683')
    expect(metric.moeText).toBe('±$4,500')
    expect(metric.highMoe).toBe(true)
    expect(metric.comparisons[0]).toContain('figure in Madison')
  })

  it('switches to selected county profile and falls back to N/A area and density', () => {
    const model = buildCensusDisplayModel(SAMPLE_PAYLOAD, '05000US55025')

    expect(model.selectedGeoid).toBe('05000US55025')
    expect(model.profile.tractName).toBe('Dane County, WI')
    expect(model.profile.populationText).toBe('585,000')
    expect(model.profile.areaText).toBe('N/A')
    expect(model.profile.densityText).toBe('N/A')
    expect(model.sections[0].id).toBe('economics')
    expect(model.sections[0].metrics[0].estimateText).toBe('$89,975')
  })

  it('falls back to tract when selected geoid is unavailable', () => {
    const model = buildCensusDisplayModel(SAMPLE_PAYLOAD, '99999US00000')
    expect(model.selectedGeoid).toBe('14000US55025001704')
  })
})
