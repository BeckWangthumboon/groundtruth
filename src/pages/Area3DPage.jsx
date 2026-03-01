import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
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
import { fetchTilequeryPois } from '@/lib/mapboxApi'
import { computeWeight } from '@/lib/simulation/engine'
import { TimeSlider } from '@/components/simulation/TimeSlider'
import { CrowdChart } from '@/components/simulation/CrowdChart'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const RADIUS_OPTIONS_KM = [0.1, 0.25, 0.5, 1]
const DEFAULT_RADIUS_KM = 0.25
const CAMERA_PITCH = 60
const CAMERA_BEARING = -45
const TERRAIN_SOURCE_ID = 'area-3d-terrain-source'
const BUILDINGS_LAYER_ID = 'area-3d-buildings'

// ---------------------------------------------------------------------------
// Fast-food filtering
// ---------------------------------------------------------------------------

const FAST_FOOD_KEYWORDS = ['fast food', 'burger', 'pizza', 'fried chicken', 'sandwich']

function isFastFood(feature) {
  const props = feature?.properties ?? {}
  const rawValues = [props.category_en, props.category, props.class, props.type, props.maki]
  const tokens = rawValues
    .flatMap((v) => (typeof v === 'string' ? v.split(/[;,/|]/) : []))
    .map((v) =>
      v
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
    )
    .filter(Boolean)

  return tokens.some((token) =>
    FAST_FOOD_KEYWORDS.some((kw) => {
      const t = token.trim().toLowerCase()
      return t === kw || t.startsWith(kw + ' ') || t.endsWith(' ' + kw) || t.includes(' ' + kw + ' ')
    })
  )
}

function filterFastFood(features) {
  return features.filter(isFastFood).map((f) => ({
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    name: f.properties?.name ?? 'Fast Food',
    type: 'food',
  }))
}

// ---------------------------------------------------------------------------
// Agent generation
// ---------------------------------------------------------------------------

const MAX_AGENTS_PER_POI = 15
const SCATTER_RADIUS_DEG = 0.0003 // ~30 m

function generateAgents(pois, hour, dayType) {
  const agents = []
  for (const poi of pois) {
    const weight = computeWeight(poi, hour, dayType, 'business', 1.0)
    const count = Math.round(weight * MAX_AGENTS_PER_POI)
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * SCATTER_RADIUS_DEG
      agents.push({
        lng: poi.lng + Math.cos(angle) * dist,
        lat: poi.lat + Math.sin(angle) * dist * 0.8,
        weight,
      })
    }
  }
  return agents
}

// ---------------------------------------------------------------------------
// Helpers (unchanged from original)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function Area3DPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const selectedRadiusRef = useRef(DEFAULT_RADIUS_KM)

  const [selectedRadiusKm, setSelectedRadiusKm] = useState(DEFAULT_RADIUS_KM)

  // Simulation state
  const [fastFoodPois, setFastFoodPois] = useState([])
  const [currentHour, setCurrentHour] = useState(12)
  const [dayType, setDayType] = useState('weekday')
  const [agents, setAgents] = useState([])
  const [poisLoading, setPoisLoading] = useState(false)

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

      // deck.gl overlay
      try {
        const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
        map.addControl(overlay)
        overlayRef.current = overlay
      } catch (error) {
        console.warn('Unable to initialise deck.gl overlay.', error)
      }
    })

    const handleResize = () => applyRadiusBounds(map, selectedRadiusRef.current, 0)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      centerMarker.remove()
      if (overlayRef.current && map.hasControl(overlayRef.current)) {
        map.removeControl(overlayRef.current)
      }
      overlayRef.current = null
      map.remove()
      mapRef.current = null
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
  // Fetch & filter Fast Food POIs
  // -------------------------------------------------------------------------

  useEffect(() => {
    const controller = new AbortController()
    setPoisLoading(true)

    fetchTilequeryPois({
      lon: longitude,
      lat: latitude,
      radius: selectedRadiusKm * 1000,
      signal: controller.signal,
    })
      .then((fc) => {
        setFastFoodPois(filterFastFood(fc.features))
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.warn('POI fetch failed:', err)
      })
      .finally(() => setPoisLoading(false))

    return () => controller.abort()
  }, [latitude, longitude, selectedRadiusKm])

  // -------------------------------------------------------------------------
  // Agent generation + drift animation
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (fastFoodPois.length === 0) {
      setAgents([])
      return undefined
    }

    setAgents(generateAgents(fastFoodPois, currentHour, dayType))

    const interval = setInterval(() => {
      setAgents(generateAgents(fastFoodPois, currentHour, dayType))
    }, 2000)

    return () => clearInterval(interval)
  }, [fastFoodPois, currentHour, dayType])

  // -------------------------------------------------------------------------
  // Update deck.gl layers
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!overlayRef.current) return

    const layer = new ScatterplotLayer({
      id: 'crowd-agents',
      data: agents,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 3,
      getFillColor: [255, 140, 0, 200],
      radiusUnits: 'meters',
      radiusMinPixels: 2,
      radiusMaxPixels: 6,
      transitions: {
        getPosition: 1800,
      },
    })

    overlayRef.current.setProps({ layers: [layer] })
  }, [agents])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="app-shell app-shell--searched area3d-shell">
      <div id="map-container" ref={mapContainerRef} />

      <main className="ui-layer area3d-ui-layer">
        {/* Location info bar */}
        <section className="search-shell area3d-toolbar">
          <MapPin className="search-icon area3d-pin" size={19} />
          <div className="area3d-copy">
            <p className="area3d-title">Area 3D View</p>
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

        {/* Simulation panel */}
        <section className="area3d-sim-panel">
          <div className="area3d-sim-header">
            <p className="area3d-sim-title">Fast Food Crowd Sim</p>
            {poisLoading ? (
              <span className="area3d-sim-loading">Loading...</span>
            ) : (
              <span className="area3d-sim-count">{fastFoodPois.length} locations</span>
            )}
          </div>

          {fastFoodPois.length === 0 && !poisLoading && (
            <p className="area3d-sim-empty">No fast food locations found in this area.</p>
          )}

          {/* Day type toggle */}
          <div className="area3d-sim-day-toggle">
            {['weekday', 'weekend'].map((d) => (
              <button
                key={d}
                type="button"
                className={`area3d-sim-day-btn${dayType === d ? ' area3d-sim-day-btn--active' : ''}`}
                onClick={() => setDayType(d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <TimeSlider currentHour={currentHour} onTimeChange={setCurrentHour} />

          <CrowdChart currentHour={currentHour} dayType={dayType} />
        </section>

        {warnings.length > 0 && (
          <ul className="area3d-alerts">
            {warnings.map((warning) => (
              <li key={warning} className="area3d-alert area3d-alert--warning">
                {warning}
              </li>
            ))}
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
