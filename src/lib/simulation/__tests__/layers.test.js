import { describe, it, expect } from 'vitest'
import {
  createHeatmapLayer,
  createHexagonLayer,
  createScatterplotLayer,
  createTractBoundaryLayer,
  buildSimulationLayers,
} from '../layers.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_POIS = [
  { type: 'food',      lat: 43.074, lng: -89.384, weight: 0.6, name: 'Cafe A' },
  { type: 'transit',   lat: 43.075, lng: -89.385, weight: 0.9 },
  { type: 'retail',    lat: 43.073, lng: -89.383, weight: 0.55 },
  { type: 'nightlife', lat: 43.076, lng: -89.386, weight: 0.65 },
]

const SAMPLE_TRACT_GEOJSON = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[-89.40, 43.07], [-89.38, 43.07], [-89.38, 43.08], [-89.40, 43.07]]],
  },
  properties: { geoid: '14000US55025001704' },
}

/** @type {{ pois: object[], currentHour: number, dayType: 'weekday'|'weekend', focusMode: 'tenant'|'business', densityScale: number }} */
const BASE_PARAMS = {
  pois: SAMPLE_POIS,
  currentHour: 12,
  dayType: /** @type {'weekday'} */ ('weekday'),
  focusMode: /** @type {'business'} */ ('business'),
  densityScale: 1.0,
}

const ALL_VISIBLE = {
  heatmap: true,
  hexagon: true,
  scatter: true,
  tractBoundary: true,
}

const ALL_HIDDEN = {
  heatmap: false,
  hexagon: false,
  scatter: false,
  tractBoundary: false,
}

// ---------------------------------------------------------------------------
// Individual layer builders
// ---------------------------------------------------------------------------

describe('createHeatmapLayer()', () => {
  it('returns a layer with id "sim-heatmap"', () => {
    const layer = createHeatmapLayer(BASE_PARAMS)
    expect(layer.id).toBe('sim-heatmap')
  })

  it('has updateTriggers that include currentHour', () => {
    const layer = createHeatmapLayer(BASE_PARAMS)
    const triggers = layer.props.updateTriggers
    expect(triggers).toBeDefined()
    expect(triggers.getWeight).toContain(BASE_PARAMS.currentHour)
  })

  it('has updateTriggers that include dayType', () => {
    const layer = createHeatmapLayer(BASE_PARAMS)
    expect(layer.props.updateTriggers.getWeight).toContain(BASE_PARAMS.dayType)
  })

  it('has updateTriggers that include focusMode', () => {
    const layer = createHeatmapLayer(BASE_PARAMS)
    expect(layer.props.updateTriggers.getWeight).toContain(BASE_PARAMS.focusMode)
  })
})

describe('createHexagonLayer()', () => {
  it('returns a layer with id "sim-hexagons"', () => {
    const layer = createHexagonLayer(BASE_PARAMS)
    expect(layer.id).toBe('sim-hexagons')
  })

  it('has updateTriggers on getElevationWeight', () => {
    const layer = createHexagonLayer(BASE_PARAMS)
    expect(layer.props.updateTriggers.getElevationWeight).toBeDefined()
  })

  it('is extruded', () => {
    const layer = createHexagonLayer(BASE_PARAMS)
    expect(layer.props.extruded).toBe(true)
  })
})

describe('createScatterplotLayer()', () => {
  it('returns a layer with id "sim-scatter"', () => {
    const layer = createScatterplotLayer(BASE_PARAMS)
    expect(layer.id).toBe('sim-scatter')
  })

  it('has updateTriggers on getRadius', () => {
    const layer = createScatterplotLayer(BASE_PARAMS)
    expect(layer.props.updateTriggers.getRadius).toBeDefined()
    expect(layer.props.updateTriggers.getRadius).toContain(BASE_PARAMS.currentHour)
  })

  it('has updateTriggers on getFillColor', () => {
    const layer = createScatterplotLayer(BASE_PARAMS)
    expect(layer.props.updateTriggers.getFillColor).toBeDefined()
    expect(layer.props.updateTriggers.getFillColor).toContain(BASE_PARAMS.dayType)
  })

  it('is pickable', () => {
    const layer = createScatterplotLayer(BASE_PARAMS)
    expect(layer.props.pickable).toBe(true)
  })
})

describe('createTractBoundaryLayer()', () => {
  it('returns a layer with id "sim-tract-boundary" for valid GeoJSON', () => {
    const layer = createTractBoundaryLayer(SAMPLE_TRACT_GEOJSON)
    expect(layer).not.toBeNull()
    expect(layer.id).toBe('sim-tract-boundary')
  })

  it('returns null when tractGeoJson is null', () => {
    expect(createTractBoundaryLayer(null)).toBeNull()
  })

  it('returns null when tractGeoJson is undefined', () => {
    expect(createTractBoundaryLayer(undefined)).toBeNull()
  })

  it('is extruded', () => {
    const layer = createTractBoundaryLayer(SAMPLE_TRACT_GEOJSON)
    expect(layer.props.extruded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildSimulationLayers() orchestrator
// ---------------------------------------------------------------------------

describe('buildSimulationLayers()', () => {
  it('returns an empty array when pois is empty', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      pois: [],
      layerVisibility: ALL_VISIBLE,
      tractGeoJson: SAMPLE_TRACT_GEOJSON,
    })
    expect(layers).toHaveLength(0)
  })

  it('returns an empty array when pois is null', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      pois: null,
      layerVisibility: ALL_VISIBLE,
      tractGeoJson: SAMPLE_TRACT_GEOJSON,
    })
    expect(layers).toHaveLength(0)
  })

  it('returns 4 layers when all visibility flags are true and tractGeoJson present', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      layerVisibility: ALL_VISIBLE,
      tractGeoJson: SAMPLE_TRACT_GEOJSON,
    })
    expect(layers).toHaveLength(4)
  })

  it('returns 3 layers when tractBoundary is visible but no tractGeoJson', () => {
    // null tractGeoJson → createTractBoundaryLayer returns null → skipped
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      layerVisibility: ALL_VISIBLE,
      tractGeoJson: null,
    })
    expect(layers).toHaveLength(3)
  })

  it('returns 0 layers when all visibility flags are false', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      layerVisibility: ALL_HIDDEN,
      tractGeoJson: SAMPLE_TRACT_GEOJSON,
    })
    expect(layers).toHaveLength(0)
  })

  it('returns only heatmap when only heatmap is visible', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      layerVisibility: { heatmap: true, hexagon: false, scatter: false, tractBoundary: false },
      tractGeoJson: null,
    })
    expect(layers).toHaveLength(1)
    expect(layers[0].id).toBe('sim-heatmap')
  })

  it('layer IDs are unique within the returned array', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      layerVisibility: ALL_VISIBLE,
      tractGeoJson: SAMPLE_TRACT_GEOJSON,
    })
    const ids = layers.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all returned layers have an id property', () => {
    const layers = buildSimulationLayers({
      ...BASE_PARAMS,
      layerVisibility: ALL_VISIBLE,
      tractGeoJson: SAMPLE_TRACT_GEOJSON,
    })
    layers.forEach((layer) => {
      expect(typeof layer.id).toBe('string')
      expect(layer.id.length).toBeGreaterThan(0)
    })
  })
})
