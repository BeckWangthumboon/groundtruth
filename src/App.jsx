import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { SearchBox } from '@mapbox/search-js-react'
import { Search } from 'lucide-react'

import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const center = [-45, 30]
const secondsPerRevolution = 160
const maxSpinZoom = 3.4
const homeZoom = 1.65

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
const toFiniteNumber = (value) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

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

let _rotationPaused = false
let _mapInstance = null
let _rafId = 0
let _lastRotTime = 0
const _ROTATION_SPEED = 360 / secondsPerRevolution / 1000 // degrees per ms

export function pauseGlobeRotation() {
  _rotationPaused = true
  cancelAnimationFrame(_rafId)
}

function _rotateGlobe(now) {
  if (!_mapInstance || !_mapInstance.getContainer().parentElement) return
  if (_rotationPaused) return
  const dt = now - _lastRotTime
  _lastRotTime = now
  if (_mapInstance.getZoom() > maxSpinZoom) {
    _rafId = requestAnimationFrame(_rotateGlobe)
    return
  }
  const center = _mapInstance.getCenter()
  center.lng -= dt * _ROTATION_SPEED
  _mapInstance.jumpTo({ center })
  _rafId = requestAnimationFrame(_rotateGlobe)
}

export function resumeGlobeRotation() {
  _rotationPaused = false
  _lastRotTime = performance.now()
  cancelAnimationFrame(_rafId)
  _rafId = requestAnimationFrame(_rotateGlobe)
}

function App() {
  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)

  const [mapInstance, setMapInstance] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [isGoToPending, setIsGoToPending] = useState(false)

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
      pitch: 0,
      bearing: 0,
      style: 'mapbox://styles/mapbox/standard',
      projection: 'globe',
      config: {
        basemap: {
          theme: 'monochrome',
          lightPreset: 'night',
        },
      },
      interactive: true,
      attributionControl: false,
    })

    _mapInstance = map
    mapRef.current = map
    setMapInstance(map)

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(8, 11, 18)',
        'high-color': 'rgb(22, 26, 35)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(1, 2, 5)',
        'star-intensity': 0.45,
      })
      resumeGlobeRotation()
    })

    const stopRotation = () => {
      pauseGlobeRotation()
    }
    map.on('mousedown', stopRotation)
    map.on('touchstart', stopRotation)

    return () => {
      pauseGlobeRotation()
      _mapInstance = null
      map.remove()
      setMapInstance(null)
      mapRef.current = null
    }
  }, [])

  const flyToSearchFeature = useCallback(
    (feature) => {
      const map = mapRef.current
      if (!map || !feature) {
        return false
      }

      const coordinates = feature?.geometry?.coordinates
      let lng = Array.isArray(coordinates) ? toFiniteNumber(coordinates[0]) : null
      let lat = Array.isArray(coordinates) ? toFiniteNumber(coordinates[1]) : null

      if (lng == null || lat == null) {
        lng = toFiniteNumber(feature?.properties?.coordinates?.longitude)
        lat = toFiniteNumber(feature?.properties?.coordinates?.latitude)
      }

      const rawBounds = feature?.properties?.bbox ?? feature?.bbox
      const bounds =
        Array.isArray(rawBounds) && rawBounds.length === 4
          ? rawBounds.map((item) => toFiniteNumber(item))
          : null
      const hasBounds = Boolean(bounds?.every((value) => value != null))

      if (lng == null || lat == null) {
        if (!hasBounds) {
          return false
        }

        const [west, south, east, north] = bounds
        lng = (west + east) / 2
        lat = (south + north) / 2
      }

      const featureType = feature?.properties?.feature_type
      const targetZoom = getCloseInZoom(featureType)

      pauseGlobeRotation()
      map.stop()

      const duration = 2800

      map.once('moveend', () => {
        resumeGlobeRotation()
      })

      if (hasBounds) {
        const [west, south, east, north] = bounds
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            maxZoom: targetZoom,
            padding: 92,
            duration,
            pitch: 50,
            bearing: -20,
            essential: true,
          }
        )
      } else {
        map.flyTo({
          center: [lng, lat],
          zoom: targetZoom,
          pitch: 50,
          bearing: -20,
          duration,
          essential: true,
          easing: (t) => 1 - Math.pow(1 - t, 3),
        })
      }

      return true
    },
    []
  )

  const geocodeAndFlyToAddress = useCallback(
    async (query) => {
      const trimmedQuery = query?.trim()
      if (!trimmedQuery || !accessToken) {
        return false
      }

      try {
        const url = new URL('https://api.mapbox.com/search/geocode/v6/forward')
        url.searchParams.set('q', trimmedQuery)
        url.searchParams.set('limit', '1')
        url.searchParams.set('access_token', accessToken)

        const response = await fetch(url.toString())
        if (!response.ok) {
          return false
        }

        const payload = await response.json()
        const feature = payload?.features?.[0]
        return flyToSearchFeature(feature)
      } catch (error) {
        console.warn('Forward geocoding failed for address submit.', error)
        return false
      }
    },
    [flyToSearchFeature]
  )

  const submitGoToQuery = useCallback(
    async (rawQuery) => {
      const trimmedQuery = rawQuery?.trim()
      if (!trimmedQuery) {
        return false
      }

      setIsGoToPending(true)
      try {
        return await geocodeAndFlyToAddress(trimmedQuery)
      } finally {
        setIsGoToPending(false)
      }
    },
    [geocodeAndFlyToAddress]
  )

  const handleSearchRetrieve = useCallback(
    (response) => {
      const feature = response?.features?.[0]
      if (!feature) {
        return
      }

      const nextInputValue =
        feature?.properties?.full_address ??
        feature?.properties?.name_preferred ??
        feature?.properties?.name ??
        ''
      if (nextInputValue) {
        setInputValue(nextInputValue)
      }

      flyToSearchFeature(feature)
    },
    [flyToSearchFeature]
  )

  const handleGoToClick = useCallback(() => {
    void submitGoToQuery(inputValue)
  }, [inputValue, submitGoToQuery])

  useEffect(() => {
    let isDisposed = false
    let animationFrameId = 0
    let removeListener = () => {}

    const handleEnterSubmit = (event) => {
      if (event.key !== 'Enter' || event.isComposing) {
        return
      }

      const typedTarget = event.target
      const isTypedFromInput =
        typedTarget instanceof HTMLInputElement || typedTarget instanceof HTMLTextAreaElement
      if (!isTypedFromInput) {
        return
      }

      const query = typedTarget.value?.trim()
      if (!query) {
        return
      }

      event.preventDefault()
      void submitGoToQuery(query)
    }

    const attachListener = () => {
      if (isDisposed) {
        return
      }

      const searchElement = document.querySelector('mapbox-search-box')
      if (!searchElement) {
        animationFrameId = window.requestAnimationFrame(attachListener)
        return
      }

      searchElement.addEventListener('keydown', handleEnterSubmit)
      removeListener = () => {
        searchElement.removeEventListener('keydown', handleEnterSubmit)
      }
    }

    attachListener()

    return () => {
      isDisposed = true
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId)
      }
      removeListener()
    }
  }, [submitGoToQuery])

  return (
    <div className="app-shell">
      <div id="map-container" ref={mapContainerRef} />

      <main className="ui-layer">
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
              componentOptions={{ flyTo: false }}
              onRetrieve={handleSearchRetrieve}
              marker
              placeholder="Search city, address, or place"
              theme={searchTheme}
            />
          </div>

          <button
            className="goto-button"
            type="button"
            onClick={handleGoToClick}
            disabled={!inputValue.trim() || isGoToPending}
          >
            {isGoToPending ? 'Going...' : 'Go to'}
          </button>
        </div>
      </main>
    </div>
  )
}

export default App
