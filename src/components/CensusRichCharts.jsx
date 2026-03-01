import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

const PIE_COLORS = ['#3bc5be', '#f59a84', '#7da8db', '#87d38d', '#d0a6ff', '#f6d36d', '#9cd1ff', '#f2b4e2']

function formatPercent(value) {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a'
  }
  return `${Math.round(value)}%`
}

function formatCount(value) {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a'
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function renderTooltip(value, _name, item) {
  const row = item?.payload
  return [`${formatPercent(row?.pct)} (${formatCount(row?.value)})`, 'Share']
}

function sectionStyle(sectionId) {
  const colorMap = {
    demographics: '#67b1ff',
    economy: '#c798ff',
    housing: '#ffa968',
    social_mobility: '#57dca1',
  }

  const style = { '--chart-section-color': colorMap[sectionId] ?? '#67b1ff' }
  return /** @type {React.CSSProperties} */ (style)
}

function PieChartCard({ chart }) {
  return (
    <div className="census-chart-card__plot" style={{ height: 208 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chart.data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="48%"
            outerRadius={74}
            innerRadius={46}
            paddingAngle={1.3}
            isAnimationActive={false}
          >
            {chart.data.map((row, index) => (
              <Cell key={`${chart.id}-${row.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={renderTooltip} />
        </PieChart>
      </ResponsiveContainer>

      <div className="census-chart-card__legend">
        {chart.data.map((row, index) => (
          <div className="census-chart-card__legend-row" key={`${chart.id}-legend-${row.name}`}>
            <span className="census-chart-card__swatch" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
            <span className="census-chart-card__legend-label">{row.name}</span>
            <span className="census-chart-card__legend-value">{formatPercent(row.pct)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BarChartCard({ chart }) {
  const innerHeight = Math.max(188, chart.data.length * 23)
  const frameHeight = Math.min(318, innerHeight)

  return (
    <div className="census-chart-card__plot-scroll" style={{ height: frameHeight }}>
      <div style={{ height: innerHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart.data} layout="vertical" margin={{ top: 6, right: 10, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(228, 238, 255, 0.11)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value) => `${Math.round(value)}%`}
              tick={{ fill: 'rgba(206, 220, 245, 0.85)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(221, 233, 250, 0.16)' }}
              tickLine={false}
              domain={[0, 100]}
            />
            <YAxis
              type="category"
              dataKey="shortName"
              width={128}
              tick={{ fill: 'rgba(232, 241, 255, 0.92)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip formatter={renderTooltip} />
            <Bar dataKey="pct" fill="rgba(93, 212, 190, 0.92)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartCard({ chart, sectionId }) {
  return (
    <article className="census-chart-card" style={sectionStyle(sectionId)}>
      <header className="census-chart-card__header">
        <h4 className="census-chart-card__title">{chart.title}</h4>
        {chart.sourceLabel ? <p className="census-chart-card__meta">Source level: {chart.sourceLabel}</p> : null}
      </header>

      {chart.unavailable ? (
        <div className="census-chart-card__na-wrap">
          <p className="census-chart-card__na">N/A</p>
          <p className="census-chart-card__reason">{chart.reason || 'This table is currently unavailable for this location.'}</p>
        </div>
      ) : chart.chartType === 'pie' ? (
        <PieChartCard chart={chart} />
      ) : (
        <BarChartCard chart={chart} />
      )}
    </article>
  )
}

export function CensusRichCharts({ sections }) {
  if (!sections?.length) {
    return null
  }

  return (
    <section className="census-rich-charts" aria-label="Detailed Census charts">
      {sections.map((section) => (
        <div className="census-chart-section" key={section.id}>
          <h3 className="census-chart-section__title" style={sectionStyle(section.id)}>
            {section.title}
          </h3>

          <div className="census-chart-grid">
            {section.charts.map((chart) => (
              <ChartCard key={chart.id} chart={chart} sectionId={section.id} />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
