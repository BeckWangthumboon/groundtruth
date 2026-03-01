import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { MapPin } from 'lucide-react'

import 'mapbox-gl/dist/mapbox-gl.css'
import '../App.css'
import './area3d.css'

import {
  DEFAULT_CENTER,
  LATITUDE_LIMIT,
  LONGITUDE_LIMIT,
  squareBoundsFromCenter,
} from '@/lib/geoSquare'
// import { fetchNearbyPois, fetchTractGeo } from '@/lib/api'
import { generateMockPois } from '@/lib/simulation/mockPois'
import { buildSimulationLayers } from '@/lib/simulation/layers'
import { computeDensityScale } from '@/lib/simulation/engine'
import { TimeSlider } from '@/components/simulation/TimeSlider'
import { ControlPanel } from '@/components/simulation/ControlPanel'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const RADIUS_OPTIONS_KM = [0.1, 0.25, 0.5, 1]
const DEFAULT_RADIUS_KM = 0.25
const CAMERA_PITCH = 60
const CAMERA_BEARING = -45
const TERRAIN_SOURCE_ID = 'area-3d-terrain-source'
const BUILDINGS_LAYER_ID = 'area-3d-buildings'

// Default simulation state values
const DEFAULT_SIM_STATE = {
  currentHour: 12,
  dayType: 'weekday',
  focusMode: 'business',
  layerVisibility: {
    heatmap: true,
    hexagon: true,
    scatter: true,
    tractBoundary: false,
  },
}

const parseCoordinate = (rawValue, label, defaultValue, min, max) => {
  if (rawValue == null || rawValue.trim() === '') {
    return { value: defaultValue, warning: null }
  }

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) {
    return {
      value: defaultValue,
      warning: `Invalid ${label} "${rawValue}". Using default ${defaultValue}.`,
    }
  }

  if (parsed < min || parsed > max) {
    return {
      value: defaultValue,
      warning: `${label} must be between ${min} and ${max}. Using default ${defaultValue}.`,
    }
  }

  return { value: parsed, warning: null }
}

const getFitPadding = () => {
  const minDimension = Math.min(window.innerWidth, window.innerHeight)
  const value = Math.round(Math.min(140, Math.max(28, minDimension * 0.16)))
  return { top: value, right: value, bottom: value, left: value }
}

const getLabelLayerId = (map) => {
  const styleLayers = map.getStyle()?.layers ?? []
  return styleLayers.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id
}

const enableTerrain = (map) => {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    })
  }
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.25 })
}

const add3DBuildings = (map) => {
  if (map.getLayer(BUILDINGS_LAYER_ID)) {
    return
  }

  map.addLayer(
    {
      id: BUILDINGS_LAYER_ID,
      type: 'fill-extrusion',
      source: 'composite',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['get', 'height'],
          0, '#c9d6e2',
          40, '#94a6b7',
          120, '#5d7288',
        ],
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 0,
          14.8, ['coalesce', ['get', 'height'], 0],
        ],
        'fill-extrusion-base': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 0,
          14.8, ['coalesce', ['get', 'min_height'], 0],
        ],
        'fill-extrusion-opacity': 0.8,
      },
    },
    getLabelLayerId(map)
  )
}

function Area3DPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const selectedRadiusRef = useRef(DEFAULT_RADIUS_KM)

  const [selectedRadiusKm, setSelectedRadiusKm] = useState(DEFAULT_RADIUS_KM)

  // Simulation state
  const [currentHour, setCurrentHour] = useState(DEFAULT_SIM_STATE.currentHour)
  /** @type {[import('@/lib/simulation/types.js').SimState['dayType'], (v: import('@/lib/simulation/types.js').SimState['dayType']) => void]} */
  const [dayType, setDayType] = useState(/** @type {'weekday'|'weekend'} */ ('weekday'))
  /** @type {[import('@/lib/simulation/types.js').SimState['focusMode'], (v: import('@/lib/simulation/types.js').SimState['focusMode']) => void]} */
  const [focusMode, setFocusMode] = useState(/** @type {'tenant'|'business'} */ ('business'))
  const [layerVisibility, setLayerVisibility] = useState(DEFAULT_SIM_STATE.layerVisibility)

  // Data fetched from the backend
  const [pois, setPois] = useState([])
  const [tractGeoJson, setTractGeoJson] = useState(null)
  const [densityScale, setDensityScale] = useState(1.0)
  const [simLoading, setSimLoading] = useState(false)
  const [simError, setSimError] = useState(null)

  const { latitude, longitude, warnings } = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const lat = parseCoordinate(
      params.get('lat'),
      'lat',
      DEFAULT_CENTER.lat,
      -LATITUDE_LIMIT,
      LATITUDE_LIMIT
    )
    const lon = parseCoordinate(
      params.get('lon'),
      'lon',
      DEFAULT_CENTER.lon,
      -LONGITUDE_LIMIT,
      LONGITUDE_LIMIT
    )

    return {
      latitude: lat.value,
      longitude: lon.value,
      warnings: [lat.warning, lon.warning].filter(Boolean),
    }
  }, [])

  const formatRadiusLabel = useCallback(
    (radiusKm) => `${radiusKm.toString().replace(/\.0$/, '')} km`,
    []
  )

  const getBoundsForRadius = useCallback(
    (radiusKm) => squareBoundsFromCenter(latitude, longitude, radiusKm * 2000),
    [latitude, longitude]
  )

  const applyRadiusBounds = useCallback(
    (map, radiusKm, duration = 0) => {
      map.fitBounds(getBoundsForRadius(radiusKm), {
        padding: getFitPadding(),
        maxZoom: 19.2,
        pitch: CAMERA_PITCH,
        bearing: CAMERA_BEARING,
        duration,
        essential: true,
      })
    },
    [getBoundsForRadius]
  )

  useEffect(() => {
    selectedRadiusRef.current = selectedRadiusKm
  }, [selectedRadiusKm])

  // -------------------------------------------------------------------------
  // Fetch POI and tract data once coordinates are known
  // -------------------------------------------------------------------------

  useEffect(() => {
    const abortController = new AbortController()
    const signal = abortController.signal

    async function loadSimData() {
      setSimLoading(true)
      setSimError(null)
      try {
        // TODO: restore real API calls once Overpass / Census endpoints are stable
        const mock = generateMockPois(latitude, longitude)
        setPois(mock.points)
        setDensityScale(computeDensityScale(mock.meta.population, mock.meta.aland))
      } catch (err) {
        if (!signal.aborted) {
          console.error('Simulation data load error:', err)
        }
      } finally {
        if (!signal.aborted) {
          setSimLoading(false)
        }
      }
    }

    loadSimData()
    return () => abortController.abort()
  }, [latitude, longitude])

  // -------------------------------------------------------------------------
  // Map initialisation
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!accessToken || !mapContainerRef.current) {
      return undefined
    }

    mapboxgl.accessToken = accessToken

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      center: [longitude, latitude],
      zoom: 17.6,
      pitch: CAMERA_PITCH,
      bearing: CAMERA_BEARING,
      antialias: true,
      // Enable interaction so users can explore deck.gl layers
      interactive: true,
      minPitch: 0,
      maxPitch: 85,
      config: {
        basemap: {
          theme: 'monochrome',
          lightPreset: 'night',
        },
      },
      attributionControl: false,
    })
    mapRef.current = map

    // Attach deck.gl MapboxOverlay
    const overlay = new MapboxOverlay({ layers: [] })
    overlayRef.current = overlay
    map.addControl(overlay)

    const centerMarker = new mapboxgl.Marker({ color: '#eef4ff' })
      .setLngLat([longitude, latitude])
      .addTo(map)

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(8, 11, 18)',
        'high-color': 'rgb(22, 26, 35)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(1, 2, 5)',
        'star-intensity': 0.45,
      })
      applyRadiusBounds(map, selectedRadiusRef.current, 900)

      try {
        enableTerrain(map)
      } catch (error) {
        console.warn('Unable to enable terrain for area 3D view.', error)
      }

      try {
        add3DBuildings(map)
      } catch (error) {
        console.warn('Unable to add 3D buildings layer for area 3D view.', error)
      }
    })

    const handleResize = () => applyRadiusBounds(map, selectedRadiusRef.current, 0)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      centerMarker.remove()
      overlay.finalize()
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
  }, [applyRadiusBounds, latitude, longitude])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
      return
    }
    applyRadiusBounds(map, selectedRadiusKm, 600)
  }, [applyRadiusBounds, selectedRadiusKm])

  // -------------------------------------------------------------------------
  // Update deck.gl layers whenever simulation state or POI data changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    const layers = buildSimulationLayers({
      pois,
      currentHour,
      dayType,
      focusMode,
      densityScale,
      layerVisibility,
      tractGeoJson,
    })

    overlay.setProps({ layers })
  }, [pois, currentHour, dayType, focusMode, densityScale, layerVisibility, tractGeoJson])

  // -------------------------------------------------------------------------
  // State mutation helpers
  // -------------------------------------------------------------------------

  const handleLayerToggle = useCallback((key, value) => {
    setLayerVisibility((prev) => ({ ...prev, [key]: value }))
  }, [])

  return (
    <div className="app-shell app-shell--searched area3d-shell">
      <div id="map-container" ref={mapContainerRef} />

      <main className="ui-layer area3d-ui-layer">
        {/* Location info bar */}
        <section className="search-shell area3d-toolbar">
          <MapPin className="search-icon area3d-pin" size={19} />
          <div className="area3d-copy">
            <p className="area3d-title">Foot Traffic Simulation</p>
            <p className="area3d-meta">
              {latitude.toFixed(6)}, {longitude.toFixed(6)} · {formatRadiusLabel(selectedRadiusKm)} radius
            </p>
          </div>
        </section>

        {/* Radius selector */}
        <section className="search-shell area3d-radius-shell">
          {RADIUS_OPTIONS_KM.map((radiusKm) => {
            const isActive = selectedRadiusKm === radiusKm
            return (
              <button
                key={radiusKm}
                type="button"
                aria-pressed={isActive}
                className={`goto-button area3d-radius-button${isActive ? ' area3d-radius-button--active' : ''}`}
                onClick={() => setSelectedRadiusKm(radiusKm)}
              >
                {formatRadiusLabel(radiusKm)}
              </button>
            )
          })}
        </section>

        {/* Time slider */}
        <TimeSlider currentHour={currentHour} onTimeChange={setCurrentHour} />

        {/* Simulation controls */}
        <ControlPanel
          dayType={dayType}
          onDayTypeChange={setDayType}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
          layerVisibility={layerVisibility}
          onLayerToggle={handleLayerToggle}
          mapRef={mapRef}
        />

        {/* Status indicators */}
        {simLoading && (
          <p className="sim-loading" role="status">Loading nearby places…</p>
        )}

        <p className="area3d-hint">Pass coordinates as ?lat=&lt;value&gt;&amp;lon=&lt;value&gt;.</p>

        {(warnings.length > 0 || simError) && (
          <ul className="area3d-alerts">
            {warnings.map((warning) => (
              <li key={warning} className="area3d-alert area3d-alert--warning">
                {warning}
              </li>
            ))}
            {simError && (
              <li className="area3d-alert area3d-alert--warning">{simError}</li>
            )}
          </ul>
        )}

        {!accessToken && (
          <p className="area3d-alert area3d-alert--error">
            Missing VITE_MAPBOX_ACCESS_TOKEN in your .env file. The map cannot be rendered.
          </p>
        )}
      </main>
    </div>
  )
}

export default Area3DPage
