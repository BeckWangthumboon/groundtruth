import { buildCensusDisplayModel } from '../lib/censusDisplayModel'
import { CensusHeroStats } from './CensusHeroStats'
import { CensusRichCharts } from './CensusRichCharts'
import { CensusStatTabs } from './CensusStatTabs'

export function CensusDataPanel({ status, data, errorMessage, locationLabel }) {
  const displayModel = status === 'success' ? buildCensusDisplayModel(data) : null

  return (
    <aside className={`census-panel census-panel--${status}`} aria-live="polite">
      <header className="census-panel__header">
        {locationLabel ? (
          <h2 className="census-panel__location">{locationLabel}</h2>
        ) : (
          <h2 className="census-panel__location">Census Data</h2>
        )}
        <p className="census-panel__subtitle">ACS 5-Year Estimates</p>
        <div className="census-panel__divider" />
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
          <p className="census-panel__hint">Map zoom completed, but Census data failed to load.</p>
        </div>
      ) : null}

      {status === 'success' ? (
        <>
          <CensusHeroStats cards={displayModel?.snapshotCards} />
          <CensusRichCharts sections={displayModel?.chartSections} />
          <CensusStatTabs sections={displayModel?.sections} />
        </>
      ) : null}
    </aside>
  )
}
