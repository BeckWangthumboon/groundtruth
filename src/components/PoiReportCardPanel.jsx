import { REPORT_CARD_DIMENSIONS } from '../lib/poiReportCard'

/**
 * @param {unknown} value
 */
function formatGeneratedAt(value) {
  if (typeof value !== 'string' || !value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * @param {unknown} value
 */
function formatShare(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return '0.0'
  }
  return num.toFixed(1)
}

export function PoiReportCardPanel({
  status,
  report,
  errorMessage,
  onGenerate,
  disabled,
  hasGroups,
  embedded = false,
}) {
  const updatedAt = formatGeneratedAt(report?.generated_at)
  const overallScore = report?.overall?.score
  const overallReason = report?.overall?.reason
  const categories = Array.isArray(report?.poi_categories) ? report.poi_categories : []
  const panelClassName = `poi-report-panel${embedded ? ' poi-report-panel--embedded' : ''}`

  return (
    <section className={panelClassName} aria-live="polite">
      <header className="poi-report-panel__header">
        <p className="poi-report-panel__title">POI Report Card</p>
        {updatedAt ? <p className="poi-report-panel__summary">Updated {updatedAt}</p> : null}
      </header>

      <button
        type="button"
        className="poi-report-panel__generate-btn"
        onClick={onGenerate}
        disabled={disabled}
      >
        {status === 'loading' ? (
          <>
            <span className="map-overlay-spinner" />
            Generating...
          </>
        ) : report ? (
          'Regenerate Report Card'
        ) : (
          'Generate Report Card'
        )}
      </button>

      {!hasGroups ? (
        <p className="poi-report-panel__status">
          Report card requires nearby places. Search for an area with POI results first.
        </p>
      ) : null}

      {status === 'idle' && !report && hasGroups ? (
        <p className="poi-report-panel__status">
          Generate a structured scorecard from nearby POI category counts.
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="poi-report-panel__status poi-report-panel__status--error">
          {errorMessage || 'Report card generation failed. Try again.'}
        </p>
      ) : null}

      {report ? (
        <div className="poi-report-panel__content">
          <section className="poi-report-panel__overall">
            <p className="poi-report-panel__overall-label">Overall Score</p>
            <p className="poi-report-panel__overall-score">{overallScore}/10</p>
            <p className="poi-report-panel__overall-reason">{overallReason}</p>
          </section>

          <section className="poi-report-panel__dimensions">
            {REPORT_CARD_DIMENSIONS.map((dimension) => {
              const scoreBlock = report?.dimensions?.[dimension.key]
              return (
                <article key={dimension.key} className="poi-report-panel__dimension-item">
                  <div className="poi-report-panel__dimension-head">
                    <p className="poi-report-panel__dimension-label">{dimension.label}</p>
                    <p className="poi-report-panel__dimension-score">
                      {typeof scoreBlock?.score === 'number' ? scoreBlock.score : '-'}
                      /10
                    </p>
                  </div>
                  <p className="poi-report-panel__dimension-reason">{scoreBlock?.reason || '—'}</p>
                </article>
              )
            })}
          </section>

          <section className="poi-report-panel__categories">
            <p className="poi-report-panel__categories-title">POI Categories</p>
            <ol className="poi-report-panel__categories-list">
              {categories.map((item) => (
                <li key={item.category} className="poi-report-panel__category-item">
                  <div className="poi-report-panel__category-head">
                    <p className="poi-report-panel__category-name">{item.category}</p>
                    <p className="poi-report-panel__category-metrics">
                      {item.count} ({formatShare(item.share_pct)}%)
                    </p>
                  </div>
                  <p className="poi-report-panel__category-reason">{item.reason}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </section>
  )
}
