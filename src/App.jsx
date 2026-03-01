import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import mapboxgl from 'mapbox-gl'
import { SearchBox } from '@mapbox/search-js-react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

import { AnalysisLoadingOverlay } from './components/AnalysisLoadingOverlay'
import { CensusDataPanel } from './components/CensusDataPanel'
import { PersonaChecklistPanel } from './components/PersonaChecklistPanel'
import { useUserType } from './hooks/useUserType'
import { fetchCensusByPoint, fetchDynamicPois } from './lib/api'
import {
  buildPoiMarkerColorExpression,
  createEmptyPoiFeatureCollection,
  filterPoiPointsByCheckedLabels,
  POI_MARKER_RADIUS_PX,
  toPoiFeatureCollection,
} from './lib/poiDynamicMap'
import {
  createInitialChecklistState,
  getChecklistItemsForUserType,
} from './lib/poiChecklistCatalog'
import { USER_TYPES } from './providers/userTypeContext'

import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const center = /** @type {[number, number]} */ ([-45, 30])
const secondsPerRevolution = 160
const maxSpinZoom = 3.4
const homeZoom = 2.4
const streetLevelZoom = 17.5
const dynamicPoiRadiusM = 1200
const dynamicPoiSourceId = 'dynamic-poi-source'
const dynamicPoiLayerId = 'dynamic-poi-layer'
const dynamicPoiColorExpression = buildPoiMarkerColorExpression()
const enablePoiDebugLogs = import.meta.env.DEV

function syncDynamicPoiSource(map, featureCollection) {
  if (!map || !map.isStyleLoaded()) {
    return
  }

  if (!map.getSource(dynamicPoiSourceId)) {
    map.addSource(dynamicPoiSourceId, {
      type: 'geojson',
      data: createEmptyPoiFeatureCollection(),
    })
  }

  if (!map.getLayer(dynamicPoiLayerId)) {
    map.addLayer({
      id: dynamicPoiLayerId,
      type: 'circle',
      source: dynamicPoiSourceId,
      paint: {
        'circle-color': dynamicPoiColorExpression,
        'circle-radius': POI_MARKER_RADIUS_PX,
        'circle-opacity': 0.95,
        'circle-stroke-color': '#0e1522',
        'circle-stroke-width': 1.25,
      },
    })
  }

  const source = map.getSource(dynamicPoiSourceId)
  if (source && 'setData' in source) {
    source.setData(featureCollection)
    if (enablePoiDebugLogs) {
      const count = Array.isArray(featureCollection?.features) ? featureCollection.features.length : 0
      console.log('[dynamic-poi] map source updated', {
        sourceId: dynamicPoiSourceId,
        layerId: dynamicPoiLayerId,
        featureCount: count,
      })
    }
  }
}

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

const getFeatureDisplayLabel = (feature) =>
  feature?.properties?.full_address ??
  feature?.properties?.name_preferred ??
  feature?.properties?.name ??
  ''

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
  const { userType, setUserType } = useUserType()
  const queryClient = useQueryClient()
  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)
  const requestIdRef = useRef(0)
  const lookupAbortControllerRef = useRef(null)
  const dynamicPoiGeoJsonRef = useRef(createEmptyPoiFeatureCollection())

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
  const [checklistStateByType, setChecklistStateByType] = useState(() => createInitialChecklistState())
  const [dynamicPoiParams, setDynamicPoiParams] = useState(null)

  const checklistItems = useMemo(() => getChecklistItemsForUserType(userType), [userType])
  const checklistState = useMemo(
    () => checklistStateByType[userType] ?? {},
    [checklistStateByType, userType]
  )
  const checkedChecklistItemIds = useMemo(
    () =>
      Object.entries(checklistState)
        .filter(([, isChecked]) => Boolean(isChecked))
        .map(([itemId]) => itemId),
    [checklistState]
  )

  const censusMutation = useMutation({
    mutationFn: fetchCensusByPoint,
  })
  const dynamicPoiQuery = useQuery({
    queryKey: [
      'pois-dynamic',
      dynamicPoiParams?.requestId ?? null,
      dynamicPoiParams?.lat ?? null,
      dynamicPoiParams?.lon ?? null,
      dynamicPoiParams?.radiusM ?? dynamicPoiRadiusM,
      dynamicPoiParams?.selectedLabels?.join(',') ?? '',
      dynamicPoiParams?.businessType ?? '',
    ],
    enabled: Boolean(dynamicPoiParams),
    queryFn: ({ signal }) => {
      if (!dynamicPoiParams) {
        return Promise.resolve({
          countsByLabel: {},
          points: [],
          meta: {},
        })
      }
      return fetchDynamicPois({
        ...dynamicPoiParams,
        signal,
      })
    },
  })

  const fetchedDynamicPoiPoints = useMemo(
    () => (Array.isArray(dynamicPoiQuery.data?.points) ? dynamicPoiQuery.data.points : []),
    [dynamicPoiQuery.data?.points]
  )
  const visibleDynamicPoiPoints = useMemo(
    () => filterPoiPointsByCheckedLabels(fetchedDynamicPoiPoints, checkedChecklistItemIds),
    [fetchedDynamicPoiPoints, checkedChecklistItemIds]
  )
  const dynamicPoiFeatureCollection = useMemo(
    () => toPoiFeatureCollection(visibleDynamicPoiPoints),
    [visibleDynamicPoiPoints]
  )

  useEffect(() => {
    if (!enablePoiDebugLogs) {
      return
    }

    const summary = {
      searchParams: dynamicPoiParams
        ? {
            lat: dynamicPoiParams.lat,
            lon: dynamicPoiParams.lon,
            radiusM: dynamicPoiParams.radiusM,
            selectedLabels: dynamicPoiParams.selectedLabels,
            businessType: dynamicPoiParams.businessType ?? null,
          }
        : null,
      query: {
        status: dynamicPoiQuery.status,
        isFetching: dynamicPoiQuery.isFetching,
        isSuccess: dynamicPoiQuery.isSuccess,
        isError: dynamicPoiQuery.isError,
      },
      checklist: {
        userType,
        checkedLabels: checkedChecklistItemIds,
      },
      points: {
        fetched: fetchedDynamicPoiPoints.length,
        visible: visibleDynamicPoiPoints.length,
        sampleVisible: visibleDynamicPoiPoints.slice(0, 3),
      },
      meta: dynamicPoiQuery.data?.meta ?? null,
      error:
        dynamicPoiQuery.error instanceof Error
          ? dynamicPoiQuery.error.message
          : dynamicPoiQuery.error ?? null,
    }

    console.log('[dynamic-poi] state', summary)
  }, [
    checkedChecklistItemIds,
    dynamicPoiParams,
    dynamicPoiQuery.data?.meta,
    dynamicPoiQuery.error,
    dynamicPoiQuery.isError,
    dynamicPoiQuery.isFetching,
    dynamicPoiQuery.isSuccess,
    dynamicPoiQuery.status,
    fetchedDynamicPoiPoints,
    userType,
    visibleDynamicPoiPoints,
  ])

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
      syncDynamicPoiSource(map, dynamicPoiGeoJsonRef.current)
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

  useEffect(() => {
    dynamicPoiGeoJsonRef.current = dynamicPoiFeatureCollection
    const map = mapRef.current
    if (!map) {
      return
    }
    try {
      syncDynamicPoiSource(map, dynamicPoiFeatureCollection)
    } catch (error) {
      console.warn('Could not update dynamic POI map markers.', error)
    }
  }, [dynamicPoiFeatureCollection])

  useEffect(() => {
    if (dynamicPoiQuery.error) {
      console.warn('Dynamic POI request failed.', dynamicPoiQuery.error)
    }
  }, [dynamicPoiQuery.error])

  const flyToSearchFeature = useCallback((feature, onMoveEnd) => {
    const map = mapRef.current
    if (!map || !feature) {
      return false
    }

    const centerPoint = resolveFeatureCenter(feature)
    if (!centerPoint) {
      return false
    }
    pauseGlobeRotation()
    map.stop()

    const duration = 2800

    map.once('moveend', () => {
      resumeGlobeRotation()
      onMoveEnd?.()
    })

    map.flyTo({
      center: [centerPoint.lng, centerPoint.lat],
      zoom: streetLevelZoom,
      pitch: 50,
      bearing: -20,
      duration,
      essential: true,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    })

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
      setChecklistStateByType(createInitialChecklistState())
      await queryClient.cancelQueries({ queryKey: ['pois-dynamic'] })

      const labelsForUserType = checklistItems.map((item) => item.id)
      setDynamicPoiParams({
        requestId,
        lat: centerPoint.lat,
        lon: centerPoint.lng,
        selectedLabels: labelsForUserType,
        radiusM: dynamicPoiRadiusM,
        businessType: labelsForUserType.includes('direct_competition') ? 'cafe' : undefined,
        includeNodes: true,
      })

      lookupAbortControllerRef.current?.abort()
      const controller = new AbortController()
      lookupAbortControllerRef.current = controller

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
    [censusMutation, checklistItems, flyToSearchFeature, queryClient]
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

  const isLookupInProgress =
    censusStatus === 'loading' || censusMutation.isPending || dynamicPoiQuery.isFetching
  const showAnalysisOverlay = isLookupInProgress && !isZoomTransitioning
  const showCensusPanel = censusStatus === 'success' || censusStatus === 'error'

  const handleToggleChecklistItem = useCallback(
    (itemId) => {
      setChecklistStateByType((previousState) => {
        const nextStateForUserType = previousState[userType]
        if (!nextStateForUserType || !(itemId in nextStateForUserType)) {
          return previousState
        }

        return {
          ...previousState,
          [userType]: {
            ...nextStateForUserType,
            [itemId]: !nextStateForUserType[itemId],
          },
        }
      })
    },
    [userType]
  )

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
        <p className="hero-wordmark rubik-mono-one-regular">
          <span>Ground</span>
          <span>Truth</span>
        </p>
      </div>

      <main className="ui-layer">
        <AnalysisLoadingOverlay visible={showAnalysisOverlay} />

        {showCensusPanel ? (
          <div className="analysis-panels">
            <section
              className={`census-panel-anchor census-panel-anchor--left census-panel-anchor--visible${
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

            <section className="census-panel-anchor census-panel-anchor--right census-panel-anchor--visible">
              <PersonaChecklistPanel
                items={checklistItems}
                checkedState={checklistState}
                onToggleItem={handleToggleChecklistItem}
              />
            </section>
          </div>
        ) : null}

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

        {!hasStartedSearch ? (
          <div className={`persona-toggle${hasSearched ? ' persona-toggle--docked' : ''}`} role="group">
            <button
              className={`persona-toggle__button persona-toggle__button--individual${
                userType === USER_TYPES.INDIVIDUAL ? ' is-active' : ''
              }`}
              type="button"
              onClick={() => setUserType(USER_TYPES.INDIVIDUAL)}
              aria-pressed={userType === USER_TYPES.INDIVIDUAL}
            >
              Individual
            </button>

            <button
              className={`persona-toggle__button persona-toggle__button--small-biz${
                userType === USER_TYPES.SMALL_BIZ ? ' is-active' : ''
              }`}
              type="button"
              onClick={() => setUserType(USER_TYPES.SMALL_BIZ)}
              aria-pressed={userType === USER_TYPES.SMALL_BIZ}
            >
              Small Biz
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default App
