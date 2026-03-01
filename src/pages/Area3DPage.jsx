import { useEffect, useMemo, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

import 'mapbox-gl/dist/mapbox-gl.css'
import './area3d.css'

import {
  DEFAULT_CENTER,
  LATITUDE_LIMIT,
  LONGITUDE_LIMIT,
  squareBoundsFromCenter,
} from '@/lib/geoSquare'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const AREA_SIDE_METERS = 100
const CAMERA_PITCH = 64
const CAMERA_BEARING = -36
const TERRAIN_SOURCE_ID = 'area-3d-terrain-source'
const BUILDINGS_LAYER_ID = 'area-3d-buildings'

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
          0,
          '#c9d6e2',
          40,
          '#94a6b7',
          120,
          '#5d7288',
        ],
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          14.8,
          ['coalesce', ['get', 'height'], 0],
        ],
        'fill-extrusion-base': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          14.8,
          ['coalesce', ['get', 'min_height'], 0],
        ],
        'fill-extrusion-opacity': 0.8,
      },
    },
    getLabelLayerId(map)
  )
}

function Area3DPage() {
  const mapContainerRef = useRef(null)

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

  const bounds = useMemo(
    () => squareBoundsFromCenter(latitude, longitude, AREA_SIDE_METERS),
    [latitude, longitude]
  )

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
    })

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')

    const centerMarker = new mapboxgl.Marker({ color: '#ef4444' })
      .setLngLat([longitude, latitude])
      .addTo(map)

    const applyBounds = (duration = 0) => {
      map.fitBounds(bounds, {
        padding: getFitPadding(),
        maxZoom: 19.2,
        pitch: CAMERA_PITCH,
        bearing: CAMERA_BEARING,
        duration,
        essential: true,
      })
    }

    map.on('style.load', () => {
      applyBounds(900)

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

    const handleResize = () => applyBounds(0)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      centerMarker.remove()
      map.remove()
    }
  }, [bounds, latitude, longitude])

  return (
    <div className="area3d-shell">
      <div ref={mapContainerRef} className="area3d-map" />

      <aside className="area3d-panel">
        <h1>Area 3D View</h1>
        <p>
          Center: <strong>{latitude.toFixed(6)}</strong>, <strong>{longitude.toFixed(6)}</strong>
        </p>
        <p>Extent: 0.1 km x 0.1 km square</p>
        <p className="area3d-hint">Pass coordinates as ?lat=&lt;value&gt;&amp;lon=&lt;value&gt;.</p>

        {warnings.length > 0 && (
          <ul className="area3d-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        {!accessToken && (
          <p className="area3d-error">
            Missing VITE_MAPBOX_ACCESS_TOKEN in your .env file. The map cannot be rendered.
          </p>
        )}
      </aside>
    </div>
  )
}

export default Area3DPage
