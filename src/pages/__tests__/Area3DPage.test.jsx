/**
 * Component tests for Area3DPage simulation features.
 *
 * mapbox-gl and @deck.gl/mapbox are mocked to avoid WebGL / DOM environment
 * requirements.  The API client is mocked to return deterministic fixture
 * data without network calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Area3DPage from '../Area3DPage.jsx'

// ---------------------------------------------------------------------------
// Mock mapbox-gl
// ---------------------------------------------------------------------------

const mockMap = {
  on: vi.fn(),
  addControl: vi.fn(),
  remove: vi.fn(),
  isStyleLoaded: vi.fn(() => false),
  fitBounds: vi.fn(),
  easeTo: vi.fn(),
  getStyle: vi.fn(() => ({ layers: [] })),
  setFog: vi.fn(),
  setTerrain: vi.fn(),
  addSource: vi.fn(),
  getSource: vi.fn(() => null),
  addLayer: vi.fn(),
  getLayer: vi.fn(() => null),
}

vi.mock('mapbox-gl', () => {
  const MarkerInstance = {
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }

  function MapConstructor() {
    return mockMap
  }
  function MarkerConstructor() {
    return MarkerInstance
  }

  return {
    default: {
      accessToken: '',
      Map: MapConstructor,
      Marker: MarkerConstructor,
    },
  }
})

// ---------------------------------------------------------------------------
// Mock @deck.gl/mapbox MapboxOverlay
// ---------------------------------------------------------------------------

const mockOverlay = {
  setProps: vi.fn(),
  finalize: vi.fn(),
}

vi.mock('@deck.gl/mapbox', () => {
  function OverlayConstructor() {
    return mockOverlay
  }
  return { MapboxOverlay: OverlayConstructor }
})

// ---------------------------------------------------------------------------
// Mock API client (no network calls)
// ---------------------------------------------------------------------------

const MOCK_POIS_RESPONSE = {
  counts: { food: 3, transit: 2, retail: 1, nightlife: 0, grocery: 0, healthcare: 0, parking: 0, parks: 0 },
  points: [
    { type: 'food',    lat: 43.074, lng: -89.384, weight: 0.6, name: 'Cafe A' },
    { type: 'transit', lat: 43.075, lng: -89.385, weight: 0.9 },
  ],
  meta: { radius_m: 800, total_elements: 5, returned_points: 2, cached: false, ts: 1700000000 },
}

const MOCK_TRACT_GEOJSON = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-89.40, 43.07], [-89.38, 43.07], [-89.38, 43.08], [-89.40, 43.07]]] },
  properties: { geoid: '14000US55025001704' },
}

vi.mock('@/lib/api', () => ({
  fetchNearbyPois: vi.fn(() => Promise.resolve(MOCK_POIS_RESPONSE)),
  fetchTractGeo: vi.fn(() => Promise.resolve(MOCK_TRACT_GEOJSON)),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(search = '?lat=43.074&lon=-89.384') {
  // Rewrite the URL search params for each test
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
  })
  return render(<Area3DPage />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Area3DPage – renders without crashing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the title "Foot Traffic Simulation"', async () => {
    await act(async () => {
      renderPage()
    })
    expect(screen.getByText('Foot Traffic Simulation')).toBeInTheDocument()
  })

  it('shows coordinates in the subtitle', async () => {
    await act(async () => {
      renderPage()
    })
    // Should display lat/lon values
    expect(screen.getByText(/43\.074/)).toBeInTheDocument()
  })

  it('renders the time slider', async () => {
    await act(async () => {
      renderPage()
    })
    const slider = screen.getByRole('slider', { name: /hour/i })
    expect(slider).toBeInTheDocument()
  })

  it('renders radius buttons', async () => {
    await act(async () => {
      renderPage()
    })
    expect(screen.getByText('0.1 km')).toBeInTheDocument()
    expect(screen.getByText('0.25 km')).toBeInTheDocument()
  })

  it('renders day type toggle buttons', async () => {
    await act(async () => {
      renderPage()
    })
    expect(screen.getByRole('button', { name: /weekday/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /weekend/i })).toBeInTheDocument()
  })

  it('renders focus mode toggle buttons', async () => {
    await act(async () => {
      renderPage()
    })
    expect(screen.getByRole('button', { name: /tenant/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /business/i })).toBeInTheDocument()
  })

  it('renders layer visibility checkboxes', async () => {
    await act(async () => {
      renderPage()
    })
    expect(screen.getByRole('checkbox', { name: /heatmap/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /hexagon/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /poi dots/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /tract boundary/i })).toBeInTheDocument()
  })
})

describe('Area3DPage – time slider interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('time slider defaults to value 12', async () => {
    await act(async () => {
      renderPage()
    })
    const slider = /** @type {HTMLInputElement} */ (screen.getByRole('slider', { name: /hour/i }))
    expect(slider.value).toBe('12')
  })

  it('updates displayed time when slider moves', async () => {
    await act(async () => {
      renderPage()
    })
    const slider = screen.getByRole('slider', { name: /hour/i })
    // Midday → 12:00 PM is the initial display
    expect(screen.getByText(/12:00 PM/)).toBeInTheDocument()

    // Move to 9:00 AM
    await act(async () => {
      fireEvent.change(slider, { target: { value: '9' } })
    })
    expect(screen.getByText(/9:00 AM/)).toBeInTheDocument()
  })

  it('play button toggles to paused state on second press', async () => {
    await act(async () => {
      renderPage()
    })
    const playBtn = screen.getByRole('button', { name: /play time animation/i })
    await act(async () => {
      fireEvent.click(playBtn)
    })
    expect(screen.getByRole('button', { name: /pause time animation/i })).toBeInTheDocument()
  })
})

describe('Area3DPage – day type and focus mode toggles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('weekend button becomes active after click', async () => {
    await act(async () => {
      renderPage()
    })
    const weekendBtn = screen.getByRole('button', { name: /weekend/i })
    await act(async () => {
      fireEvent.click(weekendBtn)
    })
    expect(weekendBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('weekday button loses active state after weekend is selected', async () => {
    await act(async () => {
      renderPage()
    })
    const weekdayBtn = screen.getByRole('button', { name: /weekday/i })
    const weekendBtn = screen.getByRole('button', { name: /weekend/i })

    // Initially weekday is pressed
    expect(weekdayBtn).toHaveAttribute('aria-pressed', 'true')

    // Click weekend
    await act(async () => {
      fireEvent.click(weekendBtn)
    })
    expect(weekdayBtn).toHaveAttribute('aria-pressed', 'false')
    expect(weekendBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('tenant button becomes active after click', async () => {
    await act(async () => {
      renderPage()
    })
    const tenantBtn = screen.getByRole('button', { name: /^Tenant$/i })
    await act(async () => {
      fireEvent.click(tenantBtn)
    })
    expect(tenantBtn).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Area3DPage – layer visibility toggles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tract boundary checkbox starts unchecked', async () => {
    await act(async () => {
      renderPage()
    })
    const tractCheckbox = screen.getByRole('checkbox', { name: /tract boundary/i })
    expect(tractCheckbox).not.toBeChecked()
  })

  it('heatmap checkbox starts checked', async () => {
    await act(async () => {
      renderPage()
    })
    const heatmapCheckbox = screen.getByRole('checkbox', { name: /heatmap/i })
    expect(heatmapCheckbox).toBeChecked()
  })

  it('toggling a checkbox changes its checked state', async () => {
    await act(async () => {
      renderPage()
    })
    const heatmapCheckbox = screen.getByRole('checkbox', { name: /heatmap/i })
    await act(async () => {
      fireEvent.click(heatmapCheckbox)
    })
    expect(heatmapCheckbox).not.toBeChecked()
  })
})
