import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { buildCensusDisplayModel } from '../lib/censusDisplayModel'

const CHART_COLORS = ['#2dd4bf', '#f59e0b', '#60a5fa', '#f97316', '#22c55e', '#a78bfa', '#f43f5e', '#38bdf8']

function formatChartPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }
  return `${value.toFixed(1)}%`
}

function formatChartCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString()
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function hasSeriesData(series) {
  return series.some((item) => typeof item?.valuePct === 'number' && Number.isFinite(item.valuePct))
}

/**
 * @param {{ active?: boolean, payload?: Array<{ payload?: { label?: string, valuePct?: number|null, count?: number|null } }> }} [props]
 */
function SeriesTooltip(props = {}) {
  const { active = false, payload = [] } = props
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0]?.payload
  if (!point) {
    return null
  }

  return (
    <div className="census-chart-tooltip">
      <p>{point.label}</p>
      <p>{formatChartPct(point.valuePct)}</p>
      <p>{formatChartCount(point.count)}</p>
    </div>
  )
}

function ChartCard({ chart }) {
  const chartData = (chart.series || []).map((entry, idx) => ({
    name: entry.label,
    label: entry.label,
    valuePct: entry.valuePct,
    count: entry.count,
    fill: CHART_COLORS[idx % CHART_COLORS.length],
  }))

  const canRender = hasSeriesData(chartData)

  return (
    <article className="census-chart-card">
      <header className="census-chart-card__header">
        <h4>{chart.label}</h4>
        {chart.universe ? <p>{chart.universe}</p> : null}
      </header>

      {!canRender ? (
        <div className="census-chart-card__empty">No data available</div>
      ) : chart.type === 'donut' ? (
        <div className="census-chart-card__donut">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="valuePct"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={78}
                isAnimationActive={false}
              >
                {chartData.map((entry, idx) => (
                  <Cell key={`${chart.id}-${entry.name}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<SeriesTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="census-chart-card__bar">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 12, right: 14, bottom: 24, left: 0 }}>
              <XAxis dataKey="label" tick={{ fill: '#9fb1d8', fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={58} />
              <YAxis tick={{ fill: '#9fb1d8', fontSize: 12 }} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
              <Tooltip content={<SeriesTooltip />} />
              <Bar dataKey="valuePct" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {chartData.map((entry, idx) => (
                  <Cell key={`${chart.id}-${entry.name}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {chart.note ? <p className="census-chart-card__note">{chart.note}</p> : null}
    </article>
  )
}

function MetricCard({ metric }) {
  return (
    <article className="census-metric-card">
      <header className="census-metric-card__header">
        <h4>{metric.label}</h4>
      </header>
      <p className="census-metric-card__estimate">{metric.estimateText}</p>
      {metric.moeText ? <p className="census-metric-card__moe">{metric.moeText}</p> : null}
      {metric.universe ? <p className="census-metric-card__universe">Universe: {metric.universe}</p> : null}

      {metric.comparisons?.length ? (
        <ul className="census-metric-card__comparisons">
          {metric.comparisons.map((line) => (
            <li key={`${metric.id}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function SectionView({ section }) {
  return (
    <div className="census-section-view">
      {section.hasHighMoe ? (
        <aside className="census-moe-warning" role="note">
          Margin of error is at least 10% for one or more metrics in this section. Take care with this statistic.
        </aside>
      ) : null}

      <div className="census-metrics-grid">
        {section.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <div className="census-charts-grid">
        {section.charts.map((chart) => (
          <ChartCard key={chart.id} chart={chart} />
        ))}
      </div>
    </div>
  )
}

export function CensusDataPanel({ status, data, errorMessage, locationLabel }) {
  const [selectorState, setSelectorState] = useState({ loadKey: null, geoid: null })
  const [activeSectionId, setActiveSectionId] = useState('demographics')
  const dataLoadKey = data?.input?.timestamp_utc || data?.tract?.reporter_geoid || null
  const selectedGeoid = selectorState.loadKey === dataLoadKey ? selectorState.geoid : null
  const displayModel = useMemo(
    () => (status === 'success' ? buildCensusDisplayModel(data, selectedGeoid) : null),
    [status, data, selectedGeoid]
  )

  const sections = displayModel?.sections || []
  const resolvedActiveSectionId = sections.some((section) => section.id === activeSectionId)
    ? activeSectionId
    : sections[0]?.id || null
  const activeSection = sections.find((section) => section.id === resolvedActiveSectionId) || null

  const profile = displayModel?.profile
  const displayLocation = profile?.tractName || locationLabel || 'Census data'

  return (
    <aside className={`census-panel census-panel--${status}`} aria-live="polite">
      <header className="census-panel__header census-panel__header--profile">
        <h2 className="census-panel__location">{displayLocation}</h2>
        {profile?.hierarchyLine ? <p className="census-panel__subtitle">{profile.hierarchyLine}</p> : null}
        <p className="census-panel__subtitle census-panel__subtitle--release">{profile?.releaseText || 'Census data: ACS 5-year estimates'}</p>

        {status === 'success' && displayModel?.selectorOptions?.length ? (
          <div className="census-geography-selector">
            <label htmlFor="census-geography-select">Geography</label>
            <select
              id="census-geography-select"
              value={displayModel.selectedGeoid || ''}
              onChange={(event) =>
                setSelectorState({
                  loadKey: dataLoadKey,
                  geoid: event.target.value,
                })
              }
              disabled={displayModel.selectorOptions.length <= 1}
            >
              {displayModel.selectorOptions.map((option) => (
                <option key={option.geoid} value={option.geoid}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {status === 'success' ? (
          <div className="census-profile-stats">
            <article>
              <h3>{profile?.populationText || 'N/A'}</h3>
              <p>Population</p>
            </article>
            <article>
              <h3>{profile?.areaText || 'N/A'}</h3>
              <p>Area</p>
            </article>
            <article>
              <h3>{profile?.densityText || 'N/A'}</h3>
              <p>Population density</p>
            </article>
          </div>
        ) : null}

        <div className="census-panel__divider" />
      </header>

      {status === 'idle' ? (
        <p className="census-panel__hint">Search for a place to load Census data.</p>
      ) : null}

      {status === 'loading' ? (
        <div className="census-panel__loading">
          <div className="census-panel__spinner" aria-hidden="true" />
          <p>Loading tract profile and contextual comparisons...</p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="census-panel__error">
          <p>{errorMessage || 'Failed to fetch Census data.'}</p>
          <p className="census-panel__hint">Map zoom completed, but the profile request failed.</p>
        </div>
      ) : null}

      {status === 'success' && activeSection ? (
        <>
          <div className="census-section-tabs" role="tablist" aria-label="Census profile sections">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={section.id === resolvedActiveSectionId}
                className={`census-section-tabs__tab${section.id === resolvedActiveSectionId ? ' is-active' : ''}`}
                onClick={() => setActiveSectionId(section.id)}
              >
                {section.title}
              </button>
            ))}
          </div>

          <SectionView section={activeSection} />
        </>
      ) : null}
    </aside>
  )
}
