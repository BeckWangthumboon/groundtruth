import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import mapboxgl from 'mapbox-gl'
import { SearchBox } from '@mapbox/search-js-react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

import { AnalysisLoadingOverlay } from './components/AnalysisLoadingOverlay'
import { CensusDataPanel } from './components/CensusDataPanel'
import { fetchCensusByPoint } from './lib/api'
import { fetchIsochrone, fetchTilequeryPois } from './lib/mapboxApi'
import { MapOverlayControls } from './components/MapOverlayControls'

import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const center = /** @type {[number, number]} */ ([-45, 30])
const secondsPerRevolution = 160
const maxSpinZoom = 3.4
const homeZoom = 2.4
const streetLevelZoom = 17.5
const ISOCHRONE_CONTOURS = [
  { contour: 15, fill: 'rgba(255, 82, 201, 0.24)', outline: 'rgba(255, 159, 224, 0.96)' },
  { contour: 10, fill: 'rgba(255, 198, 72, 0.28)', outline: 'rgba(255, 226, 145, 0.97)' },
  { contour: 5, fill: 'rgba(69, 255, 164, 0.34)', outline: 'rgba(163, 255, 212, 0.98)' },
]
const POI_GROUP_RULES = [
  { label: 'Fast Food', keywords: ['fast food', 'burger', 'pizza', 'fried chicken', 'sandwich'] },
  { label: 'Cafe', keywords: ['cafe', 'coffee', 'tea room', 'bakery'] },
  { label: 'Restaurant', keywords: ['restaurant', 'diner', 'eatery', 'food'] },
  {
    label: 'Bar & Nightlife',
    keywords: ['bar', 'pub', 'nightclub', 'nightlife', 'brewery', 'cocktail'],
  },
  { label: 'Shopping', keywords: ['shop', 'retail', 'mall', 'store', 'market'] },
  { label: 'Transit', keywords: ['station', 'transit', 'bus', 'train', 'metro', 'parking'] },
  { label: 'Education', keywords: ['school', 'college', 'university', 'library'] },
  { label: 'Health', keywords: ['hospital', 'clinic', 'pharmacy', 'medical', 'doctor'] },
  { label: 'Lodging', keywords: ['hotel', 'motel', 'hostel'] },
  { label: 'Recreation', keywords: ['park', 'museum', 'theater', 'cinema', 'stadium'] },
]

const toFiniteNumber = (value) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

const resolveFeatureCenter = (feature) => {
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
      return null
    }

    const [west, south, east, north] = bounds
    lng = (west + east) / 2
    lat = (south + north) / 2
  }

  return { lng, lat }
}

const resolveFeatureBounds = (feature) => {
  const rawBounds = feature?.properties?.bbox ?? feature?.bbox
  const bounds =
    Array.isArray(rawBounds) && rawBounds.length === 4
      ? rawBounds.map((item) => toFiniteNumber(item))
      : null

  if (!bounds?.every((value) => value != null)) {
    return null
  }

  const [west, south, east, north] = bounds
  return [
    [west, south],
    [east, north],
  ]
}

const getFeatureDisplayLabel = (feature) =>
  feature?.properties?.full_address ??
  feature?.properties?.name_preferred ??
  feature?.properties?.name ??
  ''

const toSentenceLabel = (value, fallback = 'Place') => {
  if (typeof value !== 'string') {
    return fallback
  }

  const cleaned = value.trim()
  if (!cleaned) {
    return fallback
  }

  return cleaned
    .split(',')
    .map((item) =>
      item
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase())
    )
    .filter(Boolean)
    .join(', ')
}

const toGroupKey = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'nearby-place'

const tokenIncludesKeyword = (token, keyword) => {
  const normalizedToken = token.trim().toLowerCase()
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedToken || !normalizedKeyword) {
    return false
  }
  return (
    normalizedToken === normalizedKeyword ||
    normalizedToken.startsWith(`${normalizedKeyword} `) ||
    normalizedToken.endsWith(` ${normalizedKeyword}`) ||
    normalizedToken.includes(` ${normalizedKeyword} `)
  )
}

const extractPoiCategoryTokens = (feature) => {
  const properties = feature?.properties ?? {}
  const rawValues = [
    properties.category_en,
    properties.category,
    properties.class,
    properties.type,
    properties.maki,
    feature?.layer,
  ]

  return rawValues
    .flatMap((value) => (typeof value === 'string' ? value.split(/[;,/|]/) : []))
    .map((value) => value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '))
    .filter(Boolean)
}

const getPoiGroupLabel = (feature) => {
  const tokens = extractPoiCategoryTokens(feature)
  if (tokens.length === 0) {
    return 'Nearby Place'
  }

  for (const rule of POI_GROUP_RULES) {
    if (tokens.some((token) => rule.keywords.some((keyword) => tokenIncludesKeyword(token, keyword)))) {
      return rule.label
    }
  }

  return toSentenceLabel(tokens[0], 'Nearby Place')
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
const _ROTATION_SPEED = 360 / secondsPerRevolution / 1000

function pauseGlobeRotation() {
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
  const mapCenter = _mapInstance.getCenter()
  mapCenter.lng -= dt * _ROTATION_SPEED
  _mapInstance.jumpTo({ center: mapCenter })
  _rafId = requestAnimationFrame(_rotateGlobe)
}

function resumeGlobeRotation() {
  _rotationPaused = false
  _lastRotTime = performance.now()
  cancelAnimationFrame(_rafId)
  _rafId = requestAnimationFrame(_rotateGlobe)
}

function App() {
  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)
  const requestIdRef = useRef(0)
  const lookupAbortControllerRef = useRef(null)

  const [mapInstance, setMapInstance] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [isGoToPending, setIsGoToPending] = useState(false)
  const [isZoomTransitioning, setIsZoomTransitioning] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [hasStartedSearch, setHasStartedSearch] = useState(false)

  const [censusStatus, setCensusStatus] = useState('idle')
  const [censusData, setCensusData] = useState(null)
  const [censusErrorMessage, setCensusErrorMessage] = useState('')
  const [censusLocationLabel, setCensusLocationLabel] = useState('')
  const [isCensusPanelCollapsed, setIsCensusPanelCollapsed] = useState(false)

  const [isochroneData, setIsochroneData] = useState(null)
  const [isochroneProfile, setIsochroneProfile] = useState('walking')
  const [showIsochrone, setShowIsochrone] = useState(true)
  const [isochroneLoading, setIsochroneLoading] = useState(false)
  const [tilequeryData, setTilequeryData] = useState(null)
  const [showTilequeryPois, setShowTilequeryPois] = useState(true)
  const [poisLoading, setPoisLoading] = useState(false)
  const lastSearchCoordsRef = useRef(null)
  const overlayAbortRef = useRef(null)
  const [hoveredPoiGroupKey, setHoveredPoiGroupKey] = useState(null)

  const normalizedTilequeryData = useMemo(() => {
    const features = Array.isArray(tilequeryData?.features) ? tilequeryData.features : []
    return {
      type: 'FeatureCollection',
      features: features.map((feature) => {
        const groupLabel = getPoiGroupLabel(feature)
        return {
          ...feature,
          properties: {
            ...(feature?.properties ?? {}),
            ui_group_label: groupLabel,
            ui_group_key: toGroupKey(groupLabel),
          },
        }
      }),
    }
  }, [tilequeryData])

  const nearbyPlaceGroups = useMemo(() => {
    const groupsByKey = new Map()

    for (const feature of normalizedTilequeryData.features) {
      const key =
        typeof feature?.properties?.ui_group_key === 'string'
          ? feature.properties.ui_group_key
          : 'nearby-place'
      const label =
        typeof feature?.properties?.ui_group_label === 'string'
          ? feature.properties.ui_group_label
          : 'Nearby Place'

      const current = groupsByKey.get(key)
      if (current) {
        current.count += 1
      } else {
        groupsByKey.set(key, { key, label, count: 1 })
      }
    }

    return Array.from(groupsByKey.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }
      return left.label.localeCompare(right.label)
    })
  }, [normalizedTilequeryData])

  const totalNearbyPlaces = normalizedTilequeryData.features.length

  const applyPoiGroupHighlightPaint = useCallback((map, groupKey) => {
    if (!map.getLayer('tilequery-pois-circle')) {
      return
    }

    if (!groupKey) {
      map.setPaintProperty('tilequery-pois-circle', 'circle-radius', 5)
      map.setPaintProperty('tilequery-pois-circle', 'circle-color', '#f59e0b')
      map.setPaintProperty('tilequery-pois-circle', 'circle-stroke-width', 1)
      map.setPaintProperty('tilequery-pois-circle', 'circle-stroke-color', '#ffffff')
      map.setPaintProperty('tilequery-pois-circle', 'circle-opacity', 1)
      return
    }

    const isHighlighted = ['==', ['get', 'ui_group_key'], groupKey]

    map.setPaintProperty('tilequery-pois-circle', 'circle-radius', ['case', isHighlighted, 9, 4])
    map.setPaintProperty('tilequery-pois-circle', 'circle-color', [
      'case',
      isHighlighted,
      '#28dcff',
      'rgba(245, 158, 11, 0.45)',
    ])
    map.setPaintProperty('tilequery-pois-circle', 'circle-stroke-width', ['case', isHighlighted, 2.2, 0.9])
    map.setPaintProperty('tilequery-pois-circle', 'circle-stroke-color', [
      'case',
      isHighlighted,
      '#ebfeff',
      'rgba(255, 255, 255, 0.45)',
    ])
    map.setPaintProperty('tilequery-pois-circle', 'circle-opacity', ['case', isHighlighted, 1, 0.35])
  }, [])

  const censusMutation = useMutation({
    mutationFn: fetchCensusByPoint,
  })

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

  useEffect(
    () => () => {
      lookupAbortControllerRef.current?.abort()
    },
    []
  )

  // Set up isochrone + POI sources and layers once the map style loads
  useEffect(() => {
    if (!mapInstance) return

    const emptyGeoJson = { type: 'FeatureCollection', features: [] }

    const addOverlaySources = () => {
      if (!mapInstance.getSource('isochrone-source')) {
        mapInstance.addSource('isochrone-source', { type: 'geojson', data: emptyGeoJson })
        mapInstance.addSource('tilequery-pois-source', { type: 'geojson', data: emptyGeoJson })

        for (const { contour, fill, outline } of ISOCHRONE_CONTOURS) {
          mapInstance.addLayer({
            id: `isochrone-fill-${contour}`,
            type: 'fill',
            source: 'isochrone-source',
            filter: ['==', ['get', 'contour'], contour],
            paint: { 'fill-color': fill },
          })
          mapInstance.addLayer({
            id: `isochrone-line-${contour}`,
            type: 'line',
            source: 'isochrone-source',
            filter: ['==', ['get', 'contour'], contour],
            paint: { 'line-color': outline, 'line-width': 2 },
          })
        }

        mapInstance.addLayer({
          id: 'tilequery-pois-circle',
          type: 'circle',
          source: 'tilequery-pois-source',
          paint: {
            'circle-radius': 5,
            'circle-color': '#f59e0b',
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 1,
          },
        })
      }

      applyPoiGroupHighlightPaint(mapInstance, hoveredPoiGroupKey)
    }

    if (mapInstance.isStyleLoaded()) {
      addOverlaySources()
    } else {
      mapInstance.on('style.load', addOverlaySources)
    }

    return () => {
      mapInstance.off('style.load', addOverlaySources)
    }
  }, [mapInstance, applyPoiGroupHighlightPaint, hoveredPoiGroupKey])

  const fetchMapOverlayData = useCallback(async (lng, lat, profile, signal) => {
    lastSearchCoordsRef.current = { lng, lat }
    setIsochroneLoading(true)
    setPoisLoading(true)

    const [isoResult, poiResult] = await Promise.allSettled([
      fetchIsochrone({ lon: lng, lat, profile, signal }),
      fetchTilequeryPois({ lon: lng, lat, signal }),
    ])

    if (!signal?.aborted) {
      if (isoResult.status === 'fulfilled') {
        setIsochroneData(isoResult.value)
      } else {
        console.warn('Isochrone fetch failed:', isoResult.reason)
      }
      setIsochroneLoading(false)

      if (poiResult.status === 'fulfilled') {
        setTilequeryData(poiResult.value)
      } else {
        console.warn('Tilequery fetch failed:', poiResult.reason)
      }
      setPoisLoading(false)
    }
  }, [])

  const handleIsochroneProfileChange = useCallback(
    async (newProfile) => {
      setIsochroneProfile(newProfile)
      const coords = lastSearchCoordsRef.current
      if (!coords) return

      overlayAbortRef.current?.abort()
      const controller = new AbortController()
      overlayAbortRef.current = controller

      setIsochroneLoading(true)
      try {
        const data = await fetchIsochrone({
          lon: coords.lng,
          lat: coords.lat,
          profile: newProfile,
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setIsochroneData(data)
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn('Isochrone re-fetch failed:', err)
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsochroneLoading(false)
        }
      }
    },
    []
  )

  const flyToSearchFeature = useCallback((feature, onMoveEnd) => {
    const map = mapRef.current
    if (!map || !feature) {
      return false
    }

    const centerPoint = resolveFeatureCenter(feature)
    if (!centerPoint) {
      return false
    }
    const bounds = resolveFeatureBounds(feature)

    pauseGlobeRotation()
    map.stop()

    const duration = 2800

    map.once('moveend', () => {
      resumeGlobeRotation()
      onMoveEnd?.()
    })

    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 168, right: 168, bottom: 168, left: 168 },
        maxZoom: streetLevelZoom,
        pitch: 44,
        bearing: -14,
        duration,
        essential: true,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      })
    } else {
      map.flyTo({
        center: [centerPoint.lng, centerPoint.lat],
        zoom: streetLevelZoom,
        pitch: 50,
        bearing: -20,
        duration,
        essential: true,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      })
    }

    return true
  }, [])

  const zoomThenRunCensusLookup = useCallback(
    async (feature, labelOverride = '') => {
      const centerPoint = resolveFeatureCenter(feature)
      if (!centerPoint) {
        setCensusStatus('error')
        setCensusData(null)
        setCensusErrorMessage('Could not determine coordinates for the selected search result.')
        return false
      }

      requestIdRef.current += 1
      const requestId = requestIdRef.current

      setIsZoomTransitioning(true)
      const didMove = flyToSearchFeature(feature, () => {
        if (requestId === requestIdRef.current) {
          setIsZoomTransitioning(false)
        }
      })
      if (!didMove) {
        if (requestId === requestIdRef.current) {
          setIsZoomTransitioning(false)
        }
        setCensusStatus('error')
        setCensusData(null)
        setCensusErrorMessage('Could not zoom to the selected search result.')
        return false
      }

      setHasSearched(true)

      lookupAbortControllerRef.current?.abort()
      const controller = new AbortController()
      lookupAbortControllerRef.current = controller

      // Clear old overlay data and fire parallel fetch
      setIsochroneData(null)
      setTilequeryData(null)
      overlayAbortRef.current?.abort()
      const overlayController = new AbortController()
      overlayAbortRef.current = overlayController
      fetchMapOverlayData(centerPoint.lng, centerPoint.lat, isochroneProfile, overlayController.signal)

      setCensusStatus('loading')
      setCensusData(null)
      setCensusErrorMessage('')
      setCensusLocationLabel(labelOverride || getFeatureDisplayLabel(feature))

      try {
        const payload = await censusMutation.mutateAsync({
          lat: centerPoint.lat,
          lon: centerPoint.lng,
          signal: controller.signal,
        })

        if (requestId !== requestIdRef.current) {
          return false
        }

        setCensusData(payload)
        setCensusStatus('success')
        setCensusErrorMessage('')

        return didMove
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return false
        }

        setCensusData(null)
        setCensusStatus('error')
        setCensusErrorMessage(error instanceof Error ? error.message : 'Failed to fetch Census data.')
        return false
      } finally {
        if (requestId === requestIdRef.current && lookupAbortControllerRef.current === controller) {
          lookupAbortControllerRef.current = null
        }
      }
    },
    [censusMutation, flyToSearchFeature, fetchMapOverlayData, isochroneProfile]
  )

  const geocodeAddressToFeature = useCallback(async (query) => {
    const trimmedQuery = query?.trim()
    if (!trimmedQuery || !accessToken) {
      return null
    }

    try {
      const url = new URL('https://api.mapbox.com/search/geocode/v6/forward')
      url.searchParams.set('q', trimmedQuery)
      url.searchParams.set('limit', '1')
      url.searchParams.set('access_token', accessToken)

      const response = await fetch(url.toString())
      if (!response.ok) {
        return null
      }

      const payload = await response.json()
      return payload?.features?.[0] ?? null
    } catch (error) {
      console.warn('Forward geocoding failed for address submit.', error)
      return null
    }
  }, [])

  const submitGoToQuery = useCallback(
    async (rawQuery) => {
      const trimmedQuery = rawQuery?.trim()
      if (!trimmedQuery) {
        return false
      }

      setHasStartedSearch(true)
      setIsGoToPending(true)
      try {
        const feature = await geocodeAddressToFeature(trimmedQuery)
        if (!feature) {
          setCensusStatus('error')
          setCensusData(null)
          setCensusErrorMessage('Search did not return a place for that query.')
          return false
        }

        const nextInputValue = getFeatureDisplayLabel(feature)
        if (nextInputValue) {
          setInputValue(nextInputValue)
        }

        return await zoomThenRunCensusLookup(feature, nextInputValue || trimmedQuery)
      } finally {
        setIsGoToPending(false)
      }
    },
    [geocodeAddressToFeature, zoomThenRunCensusLookup]
  )

  const handleSearchRetrieve = useCallback(
    (response) => {
      const feature = response?.features?.[0]
      if (!feature) {
        return
      }

      setHasStartedSearch(true)
      const nextInputValue = getFeatureDisplayLabel(feature)
      if (nextInputValue) {
        setInputValue(nextInputValue)
      }

      void zoomThenRunCensusLookup(feature, nextInputValue)
    },
    [zoomThenRunCensusLookup]
  )

  const handleGoToClick = useCallback(() => {
    void submitGoToQuery(inputValue)
  }, [inputValue, submitGoToQuery])

  const searchPopoverOptions = hasSearched
    ? /** @type {const} */ ({ placement: 'top-start', flip: false, offset: 10 })
    : /** @type {const} */ ({ placement: 'bottom-start', flip: false, offset: 10 })

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

  // Sync isochrone data to map source
  useEffect(() => {
    const source = mapInstance?.getSource('isochrone-source')
    if (!source) return
    const emptyGeoJson = { type: 'FeatureCollection', features: [] }
    source.setData(showIsochrone && isochroneData ? isochroneData : emptyGeoJson)
  }, [mapInstance, isochroneData, showIsochrone])

  // Sync POI data to map source
  useEffect(() => {
    const source = mapInstance?.getSource('tilequery-pois-source')
    if (!source) return
    const emptyGeoJson = { type: 'FeatureCollection', features: [] }
    source.setData(showTilequeryPois ? normalizedTilequeryData : emptyGeoJson)
  }, [mapInstance, normalizedTilequeryData, showTilequeryPois])

  useEffect(() => {
    if (!hoveredPoiGroupKey) {
      return
    }
    if (!nearbyPlaceGroups.some((group) => group.key === hoveredPoiGroupKey)) {
      setHoveredPoiGroupKey(null)
    }
  }, [nearbyPlaceGroups, hoveredPoiGroupKey])

  useEffect(() => {
    if (!showTilequeryPois && hoveredPoiGroupKey) {
      setHoveredPoiGroupKey(null)
    }
  }, [showTilequeryPois, hoveredPoiGroupKey])

  const isLookupInProgress = censusStatus === 'loading' || censusMutation.isPending
  const showAnalysisOverlay = isLookupInProgress && !isZoomTransitioning
  const showCensusPanel = censusStatus === 'success' || censusStatus === 'error'

  useEffect(() => {
    if (!showCensusPanel) {
      setIsCensusPanelCollapsed(false)
    }
  }, [showCensusPanel])

  return (
    <div
      className={`app-shell${hasSearched ? ' app-shell--searched' : ''}${
        hasStartedSearch ? ' app-shell--hero-cleared' : ''
      }`}
    >
      <div id="map-container" ref={mapContainerRef} />
      <div className="hero-wordmark-layer" aria-hidden="true">
        <div className="hero-side-placeholders">
          <p className="hero-side-placeholder hero-side-placeholder--left rubik-scribble-regular">
            placeholder
          </p>
          <p className="hero-side-placeholder hero-side-placeholder--right rubik-scribble-regular">
            placeholder
          </p>
        </div>
        <p className="hero-wordmark rubik-mono-one-regular">
          <span>Ground</span>
          <span>Truth</span>
        </p>
      </div>

      <main className="ui-layer">
        <AnalysisLoadingOverlay visible={showAnalysisOverlay} />

        {showCensusPanel ? (
          <section
            className={`census-panel-anchor census-panel-anchor--visible${
              isCensusPanelCollapsed ? ' census-panel-anchor--collapsed' : ''
            }`}
          >
            <button
              type="button"
              className="census-panel-toggle"
              aria-label={isCensusPanelCollapsed ? 'Expand census panel' : 'Collapse census panel'}
              onClick={() => setIsCensusPanelCollapsed((prev) => !prev)}
            >
              {isCensusPanelCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>

            <div
              className={`census-panel-shell${
                isCensusPanelCollapsed ? ' census-panel-shell--hidden' : ''
              }`}
              aria-hidden={isCensusPanelCollapsed}
            >
              <CensusDataPanel
                status={censusStatus}
                data={censusData}
                errorMessage={censusErrorMessage}
                locationLabel={censusLocationLabel}
              />
            </div>
          </section>
        ) : null}

        {hasSearched && (
          <div className="map-right-rail">
            <aside className="poi-results-panel" aria-live="polite">
              <header className="poi-results-panel__header">
                <p className="poi-results-panel__title">Nearby Places Found</p>
                <p className="poi-results-panel__summary">
                  {poisLoading
                    ? 'Searching…'
                    : `${totalNearbyPlaces} places · ${nearbyPlaceGroups.length} groups`}
                </p>
              </header>

              {poisLoading ? (
                <p className="poi-results-panel__status">Loading nearby places from Mapbox…</p>
              ) : nearbyPlaceGroups.length > 0 ? (
                <ol className="poi-results-panel__list">
                  {nearbyPlaceGroups.map((group) => {
                    const isActive = hoveredPoiGroupKey === group.key
                    return (
                      <li
                        key={group.key}
                        tabIndex={0}
                        className={`poi-results-panel__item${
                          isActive ? ' poi-results-panel__item--active' : ''
                        }`}
                        onMouseEnter={() => setHoveredPoiGroupKey(group.key)}
                        onMouseLeave={() =>
                          setHoveredPoiGroupKey((current) =>
                            current === group.key ? null : current
                          )
                        }
                        onFocus={() => setHoveredPoiGroupKey(group.key)}
                        onBlur={() =>
                          setHoveredPoiGroupKey((current) =>
                            current === group.key ? null : current
                          )
                        }
                      >
                        <p className="poi-results-panel__name">{group.label}</p>
                        <p className="poi-results-panel__count">Count = {group.count}</p>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="poi-results-panel__status">
                  No places were returned near this area. Try searching another point.
                </p>
              )}
            </aside>

            <MapOverlayControls
              showIsochrone={showIsochrone}
              onToggleIsochrone={setShowIsochrone}
              isochroneProfile={isochroneProfile}
              onProfileChange={handleIsochroneProfileChange}
              showPois={showTilequeryPois}
              onTogglePois={setShowTilequeryPois}
              isochroneLoading={isochroneLoading}
              poisLoading={poisLoading}
              isochroneContours={ISOCHRONE_CONTOURS}
            />
          </div>
        )}

        <div className={`search-shell${hasSearched ? ' search-shell--docked' : ''}`}>
          <Search className="search-icon" size={19} />

          <div className="search-box-wrap">
            <SearchBox
              accessToken={accessToken}
              map={mapInstance}
              mapboxgl={mapboxgl}
              value={inputValue}
              popoverOptions={searchPopoverOptions}
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
            disabled={!inputValue.trim() || isGoToPending || isLookupInProgress}
          >
            {isGoToPending ? 'Searching...' : isLookupInProgress ? 'Loading...' : 'Go to'}
          </button>
        </div>
      </main>
    </div>
  )
}

export default App
