function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return 'n/a'
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
  })
}

function formatMaybeCurrency(example) {
  const title = String(example?.title || '').toLowerCase()
  if (!title.includes('income') && !title.includes('rent') && !title.includes('value')) {
    return formatNumber(example?.estimate)
  }
  if (example?.estimate == null || Number(example.estimate) < 0) {
    return 'n/a'
  }
  return `$${formatNumber(example.estimate)}`
}

function Row({ label, value }) {
  return (
    <div className="census-panel__row">
      <span className="census-panel__label">{label}</span>
      <span className="census-panel__value">{value}</span>
    </div>
  )
}

export function CensusDataPanel({ status, data, errorMessage, locationLabel }) {
  const selected = data?.selected_for_acs_data
  const tables = data?.tables
  const keyExamples = data?.data_interpreted?.key_examples || {}
  const entries = Object.values(keyExamples).filter(Boolean)

  return (
    <aside className={`census-panel census-panel--${status}`} aria-live="polite">
      <header className="census-panel__header">
        <h2>Census Data</h2>
        {locationLabel ? <p>{locationLabel}</p> : null}
      </header>

      {status === 'idle' ? (
        <p className="census-panel__hint">Search for a place to load Census data.</p>
      ) : null}

      {status === 'loading' ? (
        <div className="census-panel__loading">
          <div className="census-panel__spinner" aria-hidden="true" />
          <p>Fetching smallest available Census geography...</p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="census-panel__error">
          <p>{errorMessage || 'Failed to fetch Census data.'}</p>
          <p className="census-panel__hint">Map zoom is paused until data succeeds.</p>
        </div>
      ) : null}

      {status === 'success' ? (
        <>
          <div className="census-panel__meta">
            <Row label="Selected level" value={selected?.selected_level || 'n/a'} />
            <Row label="Reporter GEOID" value={selected?.reporter_geoid || 'n/a'} />
            <Row
              label="Tables available"
              value={`${tables?.available_count ?? 'n/a'} / ${tables?.requested_count ?? 'n/a'}`}
            />
          </div>

          <section className="census-panel__examples">
            <h3>Interpreted examples</h3>
            {entries.slice(0, 12).map((example) => (
              <div key={example.table_id} className="census-panel__example">
                <p className="census-panel__example-title">
                  {example.table_id}: {example.title || 'Unknown table'}
                </p>
                <Row label="Value" value={formatMaybeCurrency(example)} />
                <Row label="MOE" value={formatNumber(example.margin_of_error)} />
                {example.is_sentinel_negative_median ? (
                  <p className="census-panel__hint">Sentinel negative median (unavailable).</p>
                ) : null}
              </div>
            ))}
          </section>

          <details className="census-panel__raw">
            <summary>Raw payload</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </aside>
  )
}
