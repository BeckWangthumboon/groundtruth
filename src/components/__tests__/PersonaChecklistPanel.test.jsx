import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { PersonaChecklistPanel } from '../PersonaChecklistPanel'

const sampleItems = [
  { id: 'transit_access', label: 'Transit access' },
  { id: 'parking_access', label: 'Parking access' },
]

describe('PersonaChecklistPanel', () => {
  it('renders checklist items with compact header copy', () => {
    render(
      <PersonaChecklistPanel
        items={sampleItems}
        checkedState={{ transit_access: false, parking_access: false }}
        onToggleItem={vi.fn()}
      />
    )

    expect(screen.getByText('Key Points')).toBeInTheDocument()
    expect(screen.queryByText('Small Biz')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Transit access')).toBeInTheDocument()
    expect(screen.getByLabelText('Parking access')).toBeInTheDocument()
  })

  it('applies controlled checked state to checkboxes', () => {
    render(
      <PersonaChecklistPanel
        items={sampleItems}
        checkedState={{ transit_access: true, parking_access: false }}
        onToggleItem={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Transit access')).toBeChecked()
    expect(screen.getByLabelText('Parking access')).not.toBeChecked()
  })

  it('calls onToggleItem with the clicked item id', () => {
    const onToggleItem = vi.fn()

    render(
      <PersonaChecklistPanel
        items={sampleItems}
        checkedState={{ transit_access: false, parking_access: false }}
        onToggleItem={onToggleItem}
      />
    )

    fireEvent.click(screen.getByLabelText('Parking access'))
    expect(onToggleItem).toHaveBeenCalledWith('parking_access')
  })
})
