import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PoiReportCardPanel } from '../PoiReportCardPanel'

const SAMPLE_REPORT = {
  generated_at: '2026-03-01T12:30:00.000Z',
  overall: {
    score: 8.2,
    reason: 'Strong mix of destinations and good local reachability.',
  },
  dimensions: {
    variety: { score: 9, reason: 'Diverse category mix.' },
    reachability: { score: 8, reason: 'Most places are within the 5 and 10 minute bands.' },
    amenity_depth: { score: 7, reason: 'Several categories have healthy depth.' },
    destination_quality: { score: 8, reason: 'Meaningful everyday destinations are present.' },
  },
  poi_categories: [
    {
      category: 'Transit',
      count: 78,
      share_pct: 19.5,
      reason: 'Dense transit access across the study radius.',
    },
  ],
}

describe('PoiReportCardPanel', () => {
  it('applies embedded variant class when embedded mode is enabled', () => {
    const { container } = render(
      <PoiReportCardPanel
        status="idle"
        report={null}
        errorMessage=""
        onGenerate={() => {}}
        disabled={false}
        hasGroups
        embedded
      />
    )

    const panel = container.querySelector('.poi-report-panel')
    expect(panel).toHaveClass('poi-report-panel--embedded')
  })

  it('keeps generate button label behavior for idle/loading/success states', () => {
    const { rerender } = render(
      <PoiReportCardPanel
        status="idle"
        report={null}
        errorMessage=""
        onGenerate={() => {}}
        disabled={false}
        hasGroups
      />
    )

    expect(screen.getByRole('button', { name: 'Generate Report Card' })).toBeInTheDocument()

    rerender(
      <PoiReportCardPanel
        status="loading"
        report={null}
        errorMessage=""
        onGenerate={() => {}}
        disabled={true}
        hasGroups
      />
    )
    expect(screen.getByRole('button', { name: /Generating/ })).toBeInTheDocument()

    rerender(
      <PoiReportCardPanel
        status="success"
        report={SAMPLE_REPORT}
        errorMessage=""
        onGenerate={() => {}}
        disabled={false}
        hasGroups
      />
    )
    expect(screen.getByRole('button', { name: 'Regenerate Report Card' })).toBeInTheDocument()
  })
})
