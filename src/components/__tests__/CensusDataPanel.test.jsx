import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CensusDataPanel } from '../CensusDataPanel'

const SAMPLE_DATA = {
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
            id: 'demographics',
            title: 'Demographics',
            metrics: [
              {
                id: 'median_age',
                label: 'Median age',
                estimate: 20.5,
                moe: 3.4,
                moe_ratio: 0.16,
                high_moe: true,
                format: 'number',
                universe: 'Total population',
                comparisons: [{ line: 'about two-thirds of the figure in Madison city, WI: 31.8' }],
              },
            ],
            charts: [
              {
                id: 'age_ranges',
                label: 'Population by age range',
                type: 'bar',
                series: [{ label: '20-29', value_pct: 50, count: 4200 }],
              },
            ],
          },
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
                type: 'donut',
                series: [{ label: 'Under $50K', value_pct: 74, count: 1500 }],
              },
            ],
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
            id: 'demographics',
            title: 'Demographics',
            metrics: [
              {
                id: 'median_age',
                label: 'Median age',
                estimate: 38.4,
                moe: 1.2,
                moe_ratio: 0.03,
                high_moe: false,
                format: 'number',
                universe: 'Total population',
                comparisons: [{ line: 'about the same as the figure in Wisconsin: 39.1' }],
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

describe('CensusDataPanel', () => {
  it('renders profile header with summary stats', () => {
    render(<CensusDataPanel status="success" data={SAMPLE_DATA} errorMessage="" locationLabel="" />)

    expect(screen.getByText('Census Tract 17.04, Dane, WI')).toBeInTheDocument()
    expect(screen.getByLabelText('Geography')).toBeInTheDocument()
    expect(screen.getByText('Population')).toBeInTheDocument()
    expect(screen.getByText(/people \/ sq mi/i)).toBeInTheDocument()
  })

  it('shows section tabs and switches content', () => {
    render(<CensusDataPanel status="success" data={SAMPLE_DATA} errorMessage="" locationLabel="" />)

    expect(screen.getByRole('tab', { name: 'Demographics' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Median age')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Economics' }))

    expect(screen.getByRole('tab', { name: 'Economics' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Median household income')).toBeInTheDocument()
  })

  it('shows MOE warning when high-MOE metrics exist', () => {
    render(<CensusDataPanel status="success" data={SAMPLE_DATA} errorMessage="" locationLabel="" />)

    expect(screen.getByText(/Margin of error is at least 10%/i)).toBeInTheDocument()
  })

  it('switches geography and updates cards and section metrics', () => {
    render(<CensusDataPanel status="success" data={SAMPLE_DATA} errorMessage="" locationLabel="" />)

    fireEvent.change(screen.getByLabelText('Geography'), { target: { value: '05000US55025' } })

    expect(screen.getByText('Dane County, WI')).toBeInTheDocument()
    expect(screen.getByText('585,000')).toBeInTheDocument()
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
    expect(screen.getByText('38.4')).toBeInTheDocument()
  })
})
