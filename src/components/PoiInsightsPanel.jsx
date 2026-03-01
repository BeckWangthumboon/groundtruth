import { useId } from 'react'

/**
 * @typedef {'nearby' | 'report'} PoiInsightsTab
 */

/**
 * @param {{
 *   activeTab: PoiInsightsTab
 *   onTabChange: (tab: PoiInsightsTab) => void
 *   nearbyContent: React.ReactNode
 *   reportContent: React.ReactNode
 }} props
 */
export function PoiInsightsPanel({ activeTab, onTabChange, nearbyContent, reportContent }) {
  const tabsetId = useId()
  const nearbyTabId = `${tabsetId}-nearby-tab`
  const reportTabId = `${tabsetId}-report-tab`
  const nearbyPanelId = `${tabsetId}-nearby-panel`
  const reportPanelId = `${tabsetId}-report-panel`

  return (
    <aside className="poi-insights-panel" aria-live="polite">
      <div className="poi-insights-panel__tabs" role="tablist" aria-label="POI insight views">
        <button
          id={nearbyTabId}
          type="button"
          role="tab"
          aria-controls={nearbyPanelId}
          aria-selected={activeTab === 'nearby'}
          className={`poi-insights-panel__tab${activeTab === 'nearby' ? ' poi-insights-panel__tab--active' : ''}`}
          onClick={() => onTabChange('nearby')}
        >
          Nearby Places Found
        </button>
        <button
          id={reportTabId}
          type="button"
          role="tab"
          aria-controls={reportPanelId}
          aria-selected={activeTab === 'report'}
          className={`poi-insights-panel__tab${activeTab === 'report' ? ' poi-insights-panel__tab--active' : ''}`}
          onClick={() => onTabChange('report')}
        >
          POI Report Card
        </button>
      </div>

      <div className="poi-insights-panel__body">
        <section
          id={nearbyPanelId}
          role="tabpanel"
          aria-labelledby={nearbyTabId}
          hidden={activeTab !== 'nearby'}
          className="poi-insights-panel__tabpanel"
        >
          {nearbyContent}
        </section>
        <section
          id={reportPanelId}
          role="tabpanel"
          aria-labelledby={reportTabId}
          hidden={activeTab !== 'report'}
          className="poi-insights-panel__tabpanel"
        >
          {reportContent}
        </section>
      </div>
    </aside>
  )
}
