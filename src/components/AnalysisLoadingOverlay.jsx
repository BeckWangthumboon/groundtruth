export function AnalysisLoadingOverlay({ visible }) {
  if (!visible) {
    return null
  }

  return (
    <div className="analysis-overlay" aria-live="polite" aria-busy="true">
      <div className="analysis-overlay__content">
        <div className="analysis-overlay__spinner" aria-hidden="true" />
        <p className="analysis-overlay__label">Running analysis...</p>
      </div>
    </div>
  )
}
