export function MapOverlayControls({
  showIsochrone,
  onToggleIsochrone,
  isochroneProfile,
  onProfileChange,
  showPois,
  onTogglePois,
  isochroneLoading,
  poisLoading,
  isochroneContours = [],
}) {
  const legendContours =
    isochroneContours.length > 0
      ? [...isochroneContours].sort((a, b) => a.contour - b.contour)
      : [
          { contour: 5, outline: 'rgba(163,255,212,0.98)' },
          { contour: 10, outline: 'rgba(255,226,145,0.97)' },
          { contour: 15, outline: 'rgba(255,159,224,0.96)' },
        ]

  return (
    <div className="map-overlay-controls">
      {/* Reachability section */}
      <div className="map-overlay-section">
        <label className="map-overlay-check">
          <input
            type="checkbox"
            checked={showIsochrone}
            onChange={(e) => onToggleIsochrone(e.target.checked)}
          />
          <span className="map-overlay-check__label">
            Reachability
            {isochroneLoading && <span className="map-overlay-spinner" />}
          </span>
        </label>

        <div className="map-overlay-profile-toggle">
          <button
            type="button"
            className={`map-overlay-pill${isochroneProfile === 'walking' ? ' map-overlay-pill--active' : ''}`}
            onClick={() => onProfileChange('walking')}
          >
            Walking
          </button>
          <button
            type="button"
            className={`map-overlay-pill${isochroneProfile === 'driving' ? ' map-overlay-pill--active' : ''}`}
            onClick={() => onProfileChange('driving')}
          >
            Driving
          </button>
        </div>

        <div className="map-overlay-legend">
          {legendContours.map((item) => (
            <span key={item.contour} className="map-overlay-legend__item">
              <span className="map-overlay-swatch" style={{ background: item.outline }} />
              {item.contour} min
            </span>
          ))}
        </div>
      </div>

      {/* POI section */}
      <div className="map-overlay-section map-overlay-section--border-top">
        <label className="map-overlay-check">
          <input
            type="checkbox"
            checked={showPois}
            onChange={(e) => onTogglePois(e.target.checked)}
          />
          <span className="map-overlay-check__label">
            Nearby Places
            {poisLoading && <span className="map-overlay-spinner" />}
          </span>
        </label>
      </div>
    </div>
  )
}
