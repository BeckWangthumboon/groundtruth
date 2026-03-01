import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Area3DPage from '../Area3DPage.jsx'

const mockMap = {
  on: vi.fn(),
  remove: vi.fn(),
  isStyleLoaded: vi.fn(() => false),
  fitBounds: vi.fn(),
  getStyle: vi.fn(() => ({ layers: [] })),
  setFog: vi.fn(),
  setTerrain: vi.fn(),
  addSource: vi.fn(),
  getSource: vi.fn(() => null),
  addLayer: vi.fn(),
  getLayer: vi.fn(() => null),
}

vi.mock('mapbox-gl', () => {
  const markerInstance = {
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }

  function MapConstructor() {
    return mockMap
  }

  function MarkerConstructor() {
    return markerInstance
  }

  return {
    default: {
      accessToken: '',
      Map: MapConstructor,
      Marker: MarkerConstructor,
    },
  }
})

function renderPage(search = '?lat=43.074&lon=-89.384') {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
  })

  return render(<Area3DPage />)
}

describe('Area3DPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the area title', async () => {
    await act(async () => {
      renderPage()
    })

    expect(screen.getByText('Area 3D View')).toBeInTheDocument()
  })

  it('shows coordinates in the subtitle', async () => {
    await act(async () => {
      renderPage()
    })

    expect(screen.getByText(/43\.074000, -89\.384000/)).toBeInTheDocument()
  })

  it('renders radius buttons', async () => {
    await act(async () => {
      renderPage()
    })

    expect(screen.getByRole('button', { name: '0.1 km' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0.25 km' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0.5 km' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 km' })).toBeInTheDocument()
  })

  it('updates pressed state when radius selection changes', async () => {
    await act(async () => {
      renderPage()
    })

    const defaultRadiusButton = screen.getByRole('button', { name: '0.25 km' })
    const oneKmButton = screen.getByRole('button', { name: '1 km' })

    expect(defaultRadiusButton).toHaveAttribute('aria-pressed', 'true')
    expect(oneKmButton).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      fireEvent.click(oneKmButton)
    })

    expect(defaultRadiusButton).toHaveAttribute('aria-pressed', 'false')
    expect(oneKmButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not render simulation controls', async () => {
    await act(async () => {
      renderPage()
    })

    expect(screen.queryByRole('slider', { name: /hour/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /weekday/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /weekend/i })).not.toBeInTheDocument()
  })

  it('shows warning for invalid coordinates', async () => {
    await act(async () => {
      renderPage('?lat=invalid&lon=-89.384')
    })

    expect(screen.getByText(/Invalid lat "invalid"/)).toBeInTheDocument()
  })
})
