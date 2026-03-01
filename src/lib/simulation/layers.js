/**
 * @file deck.gl layer factory for the foot traffic simulation.
 *
 * Each `create*Layer()` function returns a configured deck.gl layer instance.
 * All time-varying accessors include `updateTriggers` keyed on
 * [currentHour, dayType, focusMode] so deck.gl re-evaluates them whenever
 * the simulation state changes.
 *
 * `buildSimulationLayers(state)` is the single entry point used by
 * Area3DPage.jsx – it assembles the full layer stack and filters by
 * `layerVisibility`.
 */

import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { HexagonLayer } from '@deck.gl/aggregation-layers'
import { ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers'

import { computeWeight } from './engine.js'
import { toSimCategory, CATEGORY_COLORS, DEFAULT_COLOR } from './categories.js'

// ---------------------------------------------------------------------------
// Shared colour ramp used by Heatmap and Hexagon layers
// ---------------------------------------------------------------------------

/** Blue → teal → green → yellow → orange → red
 *  @type {import('@deck.gl/core').Color[]}
 */
const ACTIVITY_COLOR_RANGE = /** @type {import('@deck.gl/core').Color[]} */ ([
  [1, 152, 189],
  [73, 227, 206],
  [216, 254, 181],
  [254, 237, 177],
  [254, 173, 84],
  [209, 55, 78],
])

// ---------------------------------------------------------------------------
// Individual layer builders
// ---------------------------------------------------------------------------

/**
 * HeatmapLayer – continuous ambient glow showing overall activity density.
 *
 * @param {{ pois: object[], currentHour: number, dayType: 'weekday'|'weekend', focusMode: 'tenant'|'business', densityScale: number }} opts
 * @returns {HeatmapLayer}
 */
export function createHeatmapLayer({ pois, currentHour, dayType, focusMode, densityScale }) {
  const trigger = [currentHour, dayType, focusMode, densityScale]
  return new HeatmapLayer({
    id: 'sim-heatmap',
    data: pois,
    getPosition: (d) => [d.lng, d.lat],
    getWeight: (d) => computeWeight(d, currentHour, dayType, focusMode, densityScale),
    updateTriggers: {
      getWeight: trigger,
    },
    radiusPixels: 60,
    intensity: 1,
    threshold: 0.05,
    colorRange: ACTIVITY_COLOR_RANGE,
  })
}

/**
 * HexagonLayer – 3D extruded columns that grow/shrink with activity level.
 * The 800 ms transition on `elevationScale` provides the "wow" animation.
 *
 * @param {{ pois: object[], currentHour: number, dayType: 'weekday'|'weekend', focusMode: 'tenant'|'business', densityScale: number }} opts
 * @returns {HexagonLayer}
 */
export function createHexagonLayer({ pois, currentHour, dayType, focusMode, densityScale }) {
  const trigger = [currentHour, dayType, focusMode, densityScale]
  return new HexagonLayer({
    id: 'sim-hexagons',
    data: pois,
    getPosition: (d) => [d.lng, d.lat],
    getElevationWeight: (d) => computeWeight(d, currentHour, dayType, focusMode, densityScale),
    updateTriggers: {
      getElevationWeight: trigger,
    },
    elevationScale: 50,
    extruded: true,
    radius: 50,       // 50 m hexagons – tight for neighbourhood scale
    coverage: 0.8,
    colorRange: ACTIVITY_COLOR_RANGE,
    transitions: {
      elevationScale: 800,  // smooth 800 ms animation between time steps
    },
    pickable: true,
  })
}

/**
 * ScatterplotLayer – individual POI dots sized and coloured by activity.
 * Alpha scales from dim (quiet) to bright (busy).
 *
 * @param {{ pois: object[], currentHour: number, dayType: 'weekday'|'weekend', focusMode: 'tenant'|'business', densityScale: number }} opts
 * @returns {ScatterplotLayer}
 */
export function createScatterplotLayer({ pois, currentHour, dayType, focusMode, densityScale }) {
  const trigger = [currentHour, dayType, focusMode, densityScale]
  return new ScatterplotLayer({
    id: 'sim-scatter',
    data: pois,
    getPosition: (d) => [d.lng, d.lat],
    getRadius: (d) => {
      const w = computeWeight(d, currentHour, dayType, focusMode, densityScale)
      return 5 + w * 25  // 5 m min, 30 m max
    },
    getFillColor: (d) => {
      const cat = toSimCategory(d.type)
      const w = computeWeight(d, currentHour, dayType, focusMode, densityScale)
      const rgb = CATEGORY_COLORS[cat] ?? DEFAULT_COLOR
      /** @type {import('@deck.gl/core').Color} */
      const color = /** @type {any} */ ([...rgb, Math.round(80 + w * 175)])
      return color  // alpha: dim when quiet, bright when busy
    },
    updateTriggers: {
      getRadius: trigger,
      getFillColor: trigger,
    },
    radiusUnits: 'meters',
    radiusMinPixels: 3,
    radiusMaxPixels: 30,
    pickable: true,
    transitions: {
      getRadius: 600,
      getFillColor: 600,
    },
  })
}

/**
 * GeoJsonLayer – Census tract boundary as a translucent wireframe extrusion.
 * This gives spatial context: "this is the neighbourhood we're analysing."
 *
 * @param {object|null} tractGeoJson - GeoJSON Feature from /api/census/tract-geo
 * @returns {GeoJsonLayer|null}
 */
export function createTractBoundaryLayer(tractGeoJson) {
  if (!tractGeoJson) return null
  return new GeoJsonLayer({
    id: 'sim-tract-boundary',
    data: tractGeoJson,
    extruded: true,
    wireframe: true,
    getElevation: 150,
    getFillColor: [0, 180, 255, 40],
    getLineColor: [0, 180, 255, 200],
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    opacity: 0.3,
  })
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Build the complete set of simulation layers for the current state.
 * Layers excluded by `layerVisibility` flags are omitted from the array.
 *
 * @param {import('./types.js').SimState} state
 * @returns {import('@deck.gl/core').Layer[]}
 */
export function buildSimulationLayers(state) {
  const { pois, currentHour, dayType, focusMode, densityScale, layerVisibility, tractGeoJson } = state

  if (!pois || pois.length === 0) return []

  const params = { pois, currentHour, dayType, focusMode, densityScale }
  const layers = []

  if (layerVisibility.heatmap) {
    layers.push(createHeatmapLayer(params))
  }
  if (layerVisibility.hexagon) {
    layers.push(createHexagonLayer(params))
  }
  if (layerVisibility.scatter) {
    layers.push(createScatterplotLayer(params))
  }
  if (layerVisibility.tractBoundary) {
    const tractLayer = createTractBoundaryLayer(tractGeoJson)
    if (tractLayer) layers.push(tractLayer)
  }

  return layers
}
