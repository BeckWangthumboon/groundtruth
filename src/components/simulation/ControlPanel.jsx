/**
 * ControlPanel provides day-type toggle, focus-mode toggle, layer visibility
 * checkboxes, and camera preset buttons.
 *
 * Props:
 *   dayType           {'weekday'|'weekend'}
 *   onDayTypeChange   {(v: string) => void}
 *
 *   focusMode         {'tenant'|'business'}
 *   onFocusModeChange {(v: string) => void}
 *
 *   layerVisibility   { heatmap, hexagon, scatter, tractBoundary: boolean }
 *   onLayerToggle     {(key: string, value: boolean) => void}
 *
 *   mapRef            {React.MutableRefObject<mapboxgl.Map>}
 */
export function ControlPanel({
  dayType,
  onDayTypeChange,
  focusMode,
  onFocusModeChange,
  layerVisibility,
  onLayerToggle,
  mapRef,
}) {
  // ---------------------------------------------------------------------------
  // Camera presets
  // ---------------------------------------------------------------------------

  const applyPreset = (pitch, bearing, zoom) => {
    const map = mapRef?.current
    if (!map) return
    map.easeTo({ pitch, bearing, zoom, duration: 600, essential: true })
  }

  const CAMERA_PRESETS = [
    { label: '2D',         pitch: 0,  bearing: 0,   zoom: null, title: 'Top-down 2D view' },
    { label: '3D Tilt',    pitch: 45, bearing: -20,  zoom: null, title: '3D tilted view' },
    { label: "Bird's Eye", pitch: 60, bearing: 30,  zoom: null, title: "Bird's eye overview" },
  ]

  // ---------------------------------------------------------------------------
  // Layer visibility rows
  // ---------------------------------------------------------------------------

  const LAYER_ROWS = [
    { key: 'heatmap',       label: 'Heatmap' },
    { key: 'hexagon',       label: '3D Hexagons' },
    { key: 'scatter',       label: 'POI Dots' },
    { key: 'tractBoundary', label: 'Tract Boundary' },
  ]

  return (
    <div className="sim-control-panel" role="group" aria-label="Simulation controls">

      {/* Day type toggle */}
      <div className="sim-section">
        <p className="sim-section-label">Day Type</p>
        <div className="sim-toggle-group" role="group" aria-label="Day type">
          {['weekday', 'weekend'].map((v) => (
            <button
              key={v}
              type="button"
              className={`sim-toggle-btn${dayType === v ? ' sim-toggle-btn--active' : ''}`}
              aria-pressed={dayType === v}
              onClick={() => onDayTypeChange(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Focus mode toggle */}
      <div className="sim-section">
        <p className="sim-section-label">Focus</p>
        <div className="sim-toggle-group" role="group" aria-label="Focus mode">
          <button
            type="button"
            className={`sim-toggle-btn${focusMode === 'tenant' ? ' sim-toggle-btn--active' : ''}`}
            aria-pressed={focusMode === 'tenant'}
            onClick={() => onFocusModeChange('tenant')}
          >
            Tenant
          </button>
          <button
            type="button"
            className={`sim-toggle-btn${focusMode === 'business' ? ' sim-toggle-btn--active' : ''}`}
            aria-pressed={focusMode === 'business'}
            onClick={() => onFocusModeChange('business')}
          >
            Business
          </button>
        </div>
      </div>

      {/* Layer visibility */}
      <div className="sim-section">
        <p className="sim-section-label">Layers</p>
        <div className="sim-layer-list">
          {LAYER_ROWS.map(({ key, label }) => (
            <label key={key} className="sim-layer-row">
              <input
                type="checkbox"
                className="sim-layer-checkbox"
                checked={layerVisibility[key]}
                onChange={(e) => onLayerToggle(key, e.target.checked)}
                aria-label={`Toggle ${label} layer`}
              />
              <span className="sim-layer-label">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Camera presets */}
      <div className="sim-section">
        <p className="sim-section-label">Camera</p>
        <div className="sim-toggle-group" role="group" aria-label="Camera preset">
          {CAMERA_PRESETS.map(({ label, pitch, bearing, zoom, title }) => (
            <button
              key={label}
              type="button"
              className="sim-toggle-btn"
              title={title}
              onClick={() => applyPreset(pitch, bearing, zoom)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
