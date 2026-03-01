import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Format a fractional hour (0–24) as a human-readable 12-h time string.
 * e.g. 13.5 → "1:30 PM", 0 → "12:00 AM"
 *
 * @param {number} hour
 * @returns {string}
 */
function formatHour(hour) {
  const totalMinutes = Math.round(hour * 60) % (24 * 60)
  const h24 = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mins).padStart(2, '0')} ${ampm}`
}

/**
 * TimeSlider controls the current simulated hour.
 *
 * Props:
 *   currentHour   {number}           0–24 (fractional, 0.25 step)
 *   onTimeChange  {(hour) => void}   called on slider move or auto-play tick
 */
export function TimeSlider({ currentHour, onTimeChange }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)

  const stopPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const startPlay = useCallback(() => {
    setIsPlaying(true)
    // Advance 1 simulated hour every 2 seconds
    intervalRef.current = setInterval(() => {
      onTimeChange((prev) => {
        const next = (prev + 1) % 24
        return next
      })
    }, 2000)
  }, [onTimeChange])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlay()
    } else {
      startPlay()
    }
  }, [isPlaying, startPlay, stopPlay])

  // Cleanup on unmount
  useEffect(() => () => stopPlay(), [stopPlay])

  const handleSlider = (e) => {
    stopPlay()
    onTimeChange(Number(e.target.value))
  }

  return (
    <div className="sim-time-slider" role="group" aria-label="Simulation time controls">
      <div className="sim-time-header">
        <span className="sim-time-label">Time</span>
        <span className="sim-time-display" aria-live="polite">
          {formatHour(currentHour)}
        </span>
      </div>

      <div className="sim-time-track">
        <span className="sim-time-tick">12 AM</span>
        <input
          type="range"
          className="sim-time-range"
          min={0}
          max={24}
          step={0.25}
          value={currentHour}
          onChange={handleSlider}
          aria-label="Hour of day"
          aria-valuetext={formatHour(currentHour)}
        />
        <span className="sim-time-tick">11 PM</span>
      </div>

      <button
        type="button"
        className={`sim-play-button${isPlaying ? ' sim-play-button--active' : ''}`}
        onClick={togglePlay}
        aria-pressed={isPlaying}
        aria-label={isPlaying ? 'Pause time animation' : 'Play time animation'}
      >
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>
    </div>
  )
}
