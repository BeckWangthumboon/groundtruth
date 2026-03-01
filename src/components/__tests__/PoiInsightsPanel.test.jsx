import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PoiInsightsPanel } from '../PoiInsightsPanel'

function TestHarness() {
  const [activeTab, setActiveTab] = useState(/** @type {'nearby' | 'report'} */ ('nearby'))

  return (
    <PoiInsightsPanel
      activeTab={activeTab}
      onTabChange={setActiveTab}
      nearbyContent={<p>Nearby panel content</p>}
      reportContent={<p>Report panel content</p>}
    />
  )
}

describe('PoiInsightsPanel', () => {
  it('renders with nearby tab selected by default', () => {
    render(<TestHarness />)

    expect(screen.getByRole('tab', { name: 'Nearby Places Found' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'POI Report Card' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.getByText('Nearby panel content')).toBeVisible()
    expect(screen.getByText('Report panel content')).not.toBeVisible()
  })

  it('switches tab content and aria-selected state when clicked', () => {
    render(<TestHarness />)

    fireEvent.click(screen.getByRole('tab', { name: 'POI Report Card' }))

    expect(screen.getByRole('tab', { name: 'Nearby Places Found' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.getByRole('tab', { name: 'POI Report Card' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nearby panel content')).not.toBeVisible()
    expect(screen.getByText('Report panel content')).toBeVisible()
  })
})
