export function CensusStatRow({ row, sectionColor }) {
  return (
    <div className={`stat-row${row.unavailable ? ' stat-row--unavailable' : ''}`}>
      <div className="stat-row__label-col">
        <span className="stat-row__label">{row.label}</span>
        {!row.unavailable && row.fillPct != null && (
          <div className="stat-row__bar-track">
            <div
              className="stat-row__bar-fill"
              style={{ width: `${row.fillPct}%`, background: `${sectionColor}99` }}
            />
          </div>
        )}
      </div>
      <div className="stat-row__value-col">
        <span className="stat-row__estimate">{row.estimateText}</span>
        {!row.unavailable && row.marginOfErrorText && (
          <span className="stat-row__moe">{row.marginOfErrorText}</span>
        )}
      </div>
    </div>
  )
}
