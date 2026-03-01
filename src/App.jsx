import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { SearchBox } from '@mapbox/search-js-react'
import { LocateFixed, MapPin, Search } from 'lucide-react'

import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const center = [-45, 30]
const secondsPerRevolution = 160
const maxSpinZoom = 3.4
const slowSpinZoom = 2.5
const homeZoom = 1.65
const tiltStartZoom = 1.6
const tiltEndZoom = 3.6
const minTilt = 0
const maxTilt = 62
const minBearing = 0
const maxBearing = -18

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const lerp = (start, end, amount) => start + (end - start) * amount

const getCinematicCameraForZoom = (zoom) => {
  const tiltProgress = clamp((zoom - tiltStartZoom) / (tiltEndZoom - tiltStartZoom), 0, 1)
  return {
    pitch: lerp(minTilt, maxTilt, tiltProgress),
    bearing: lerp(minBearing, maxBearing, tiltProgress),
  }
}

const homeCamera = getCinematicCameraForZoom(homeZoom)
const closeInZoomByFeatureType = {
  address: 17.2,
  poi: 16.8,
  street: 16.3,
  neighborhood: 14.8,
  locality: 13.6,
  place: 13.2,
  district: 12.5,
  region: 10.8,
  country: 5.5,
}

const getCloseInZoom = (featureType) => closeInZoomByFeatureType[featureType] ?? 16.2

const searchTheme = {
  variables: {
    colorText: 'rgba(232, 239, 252, 0.94)',
    colorPrimary: 'rgba(232, 239, 252, 0.96)',
    colorSecondary: 'rgba(160, 175, 205, 0.92)',
    colorBackground: 'rgba(10, 14, 24, 0.94)',
    colorBackgroundHover: 'rgba(28, 37, 57, 0.92)',
    colorBackgroundActive: 'rgba(40, 52, 76, 0.95)',
    border: '1px solid rgba(233, 241, 252, 0.16)',
    borderRadius: '14px',
    boxShadow: '0 16px 44px rgba(0, 0, 0, 0.5)',
    fontFamily: "'Avenir Next', 'Segoe UI', 'SF Pro Display', sans-serif",
    unit: '19px',
    lineHeight: '1.3',
    padding: '0.5em',
    paddingFooterLabel: '0.68em 0.9em',
  },
  cssText: `
    .SearchBox {
      background: transparent;
      border: none;
      box-shadow: none;
      padding: 0;
    }

    .Input {
      background: transparent !important;
      color: rgba(232, 239, 252, 0.96) !important;
      padding-left: 0;
      padding-right: 32px;
    }

    .Input::placeholder {
      color: rgba(176, 192, 219, 0.6) !important;
    }

    .Input:focus {
      border: none !important;
      box-shadow: none !important;
      color: rgba(236, 243, 253, 1) !important;
      outline: none !important;
    }

    .SearchIcon {
      display: none;
    }

    .ActionIcon {
      color: rgba(196, 208, 233, 0.82);
      right: 0.2em;
    }

    .ClearBtn {
      display: block;
    }

    .Results {
      backdrop-filter: blur(14px);
      margin-top: 10px;
      overflow: hidden;
    }

    .Suggestion {
      border-bottom: 1px solid rgba(231, 238, 252, 0.06);
    }

    .Suggestion:last-child {
      border-bottom: none;
    }

    .ResultsAttribution {
      border-top: 1px solid rgba(231, 238, 252, 0.1);
    }

    .ResultsAttribution a {
      color: rgba(171, 192, 224, 0.94);
    }
  `,
}

function App() {
  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)
  const userInteractingRef = useRef(false)
  const spinTimerRef = useRef(null)
  const interactionResumeRef = useRef(null)

  const [mapInstance, setMapInstance] = useState(null)
  const [inputValue, setInputValue] = useState('')

  const spinGlobe = useCallback(() => {
    const map = mapRef.current
    if (!map || userInteractingRef.current) {
      return
    }

    const zoom = map.getZoom()
    if (zoom >= maxSpinZoom) {
      return
    }

    let distancePerSecond = 360 / secondsPerRevolution
    if (zoom > slowSpinZoom) {
      const zoomScale = (maxSpinZoom - zoom) / (maxSpinZoom - slowSpinZoom)
      distancePerSecond *= zoomScale
    }

    const currentCenter = map.getCenter()
    currentCenter.lng -= distancePerSecond

    map.easeTo({
      center: currentCenter,
      duration: 1000,
      easing: (t) => t,
    })
  }, [])

  useEffect(() => {
    if (!accessToken) {
      console.warn('Set VITE_MAPBOX_ACCESS_TOKEN in your .env file before running this app.')
      return undefined
    }

    mapboxgl.accessToken = accessToken

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      center,
      zoom: homeZoom,
      pitch: homeCamera.pitch,
      bearing: homeCamera.bearing,
      style: 'mapbox://styles/mapbox/standard',
      projection: 'globe',
      config: {
        basemap: {
          theme: 'monochrome',
          lightPreset: 'night',
        },
      },
      dragRotate: false,
    })

    mapRef.current = map
    setMapInstance(map)

    const syncCameraToZoom = () => {
      const zoom = map.getZoom()
      const targetCamera = getCinematicCameraForZoom(zoom)

      map.setPitch(lerp(map.getPitch(), targetCamera.pitch, 0.22))
      map.setBearing(lerp(map.getBearing(), targetCamera.bearing, 0.22))
    }

    const queueSpin = () => {
      if (userInteractingRef.current) {
        return
      }

      if (spinTimerRef.current) {
        window.clearTimeout(spinTimerRef.current)
      }

      spinTimerRef.current = window.setTimeout(() => {
        spinGlobe()
      }, 260)
    }

    const beginInteraction = () => {
      userInteractingRef.current = true

      if (spinTimerRef.current) {
        window.clearTimeout(spinTimerRef.current)
      }

      if (interactionResumeRef.current) {
        window.clearTimeout(interactionResumeRef.current)
      }
    }

    const endInteraction = (resumeDelay = 900) => {
      if (interactionResumeRef.current) {
        window.clearTimeout(interactionResumeRef.current)
      }

      interactionResumeRef.current = window.setTimeout(() => {
        userInteractingRef.current = false
        spinGlobe()
      }, resumeDelay)
    }

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(8, 11, 18)',
        'high-color': 'rgb(22, 26, 35)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(1, 2, 5)',
        'star-intensity': 0.45,
      })
      syncCameraToZoom()
      spinGlobe()
    })

    map.on('moveend', queueSpin)
    map.on('zoomstart', beginInteraction)
    map.on('zoom', syncCameraToZoom)
    map.on('zoomend', () => endInteraction(950))
    map.on('dragstart', beginInteraction)
    map.on('dragend', () => endInteraction(700))

    return () => {
      if (spinTimerRef.current) {
        window.clearTimeout(spinTimerRef.current)
      }
      if (interactionResumeRef.current) {
        window.clearTimeout(interactionResumeRef.current)
      }
      map.remove()
      setMapInstance(null)
      mapRef.current = null
    }
  }, [spinGlobe])

  const focusSearch = () => {
    const searchInput =
      document.querySelector('mapbox-search-box')?.shadowRoot?.querySelector('input') ||
      document.querySelector('mapbox-search-box input')

    searchInput?.focus()
  }

  const flyHome = () => {
    const map = mapRef.current
    if (!map) {
      return
    }

    map.flyTo({
      center,
      zoom: homeZoom,
      pitch: homeCamera.pitch,
      bearing: homeCamera.bearing,
      speed: 0.5,
      curve: 1.35,
    })
  }

  const handleRetrieve = useCallback(
    (res) => {
      const map = mapRef.current
      const feature = res?.features?.[0]
      const coords = feature?.geometry?.coordinates
      if (!map || !Array.isArray(coords) || coords.length < 2) {
        return
      }

      const [lng, lat] = coords
      const featureType = feature?.properties?.feature_type
      const targetZoom = getCloseInZoom(featureType)
      const targetCamera = getCinematicCameraForZoom(targetZoom)

      userInteractingRef.current = true

      if (spinTimerRef.current) {
        window.clearTimeout(spinTimerRef.current)
      }
      if (interactionResumeRef.current) {
        window.clearTimeout(interactionResumeRef.current)
      }

      map.flyTo({
        center: [lng, lat],
        zoom: targetZoom,
        pitch: Math.max(targetCamera.pitch, 56),
        bearing: targetCamera.bearing,
        speed: 0.72,
        curve: 1.35,
        essential: true,
      })

      interactionResumeRef.current = window.setTimeout(() => {
        userInteractingRef.current = false
        spinGlobe()
      }, 2600)
    },
    [spinGlobe]
  )

  return (
    <div className="app-shell">
      <div id="map-container" ref={mapContainerRef} />

      <main className="ui-layer">
        <button className="check-button" type="button" onClick={focusSearch}>
          <MapPin size={16} strokeWidth={2.25} />
          <span>Check a Place</span>
        </button>

        <div className="search-shell">
          <Search className="search-icon" size={19} />

          <div className="search-box-wrap">
            <SearchBox
              accessToken={accessToken}
              map={mapInstance}
              mapboxgl={mapboxgl}
              value={inputValue}
              proximity={center}
              onChange={setInputValue}
              onRetrieve={handleRetrieve}
              componentOptions={{ flyTo: false }}
              marker
              placeholder="Search city, address, or place"
              theme={searchTheme}
            />
          </div>

          <button
            className="recenter-button"
            type="button"
            onClick={flyHome}
            aria-label="Recenter globe"
          >
            <LocateFixed size={18} />
          </button>
        </div>
      </main>
    </div>
  )
}

export default App
