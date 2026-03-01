import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

import { WEEKDAY_PROFILES, WEEKEND_PROFILES } from '@/lib/simulation/profiles'

function formatHourLabel(hour) {
  const h24 = Math.floor(hour) % 24
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12} ${ampm}`
}

function generateChartData(dayType) {
  const profile = dayType === 'weekend' ? WEEKEND_PROFILES.food : WEEKDAY_PROFILES.food
  const data = []
  for (let h = 0; h <= 24; h += 0.5) {
    data.push({
      hour: h,
      crowd: Math.round(profile(h) * 100),
    })
  }
  return data
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null
  const { hour, crowd } = payload[0].payload
  return (
    <div className="crowd-chart-tooltip">
      <p>{formatHourLabel(hour)}</p>
      <p>Activity: {crowd}%</p>
    </div>
  )
}

export function CrowdChart({ currentHour, dayType }) {
  const data = useMemo(() => generateChartData(dayType), [dayType])

  return (
    <div className="crowd-chart-wrap">
      <p className="crowd-chart-title">Ambient Crowd Level</p>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <defs>
            <linearGradient id="crowdGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(255,140,0)" stopOpacity={0.6} />
              <stop offset="100%" stopColor="rgb(255,140,0)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="hour"
            type="number"
            domain={[0, 24]}
            ticks={[0, 6, 12, 18, 24]}
            tickFormatter={formatHourLabel}
            tick={{ fill: 'rgba(200,215,240,0.7)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, 100]} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="crowd"
            stroke="rgb(255,140,0)"
            strokeWidth={2}
            fill="url(#crowdGrad)"
            isAnimationActive={false}
          />
          <ReferenceLine
            x={currentHour}
            stroke="rgba(255,255,255,0.8)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
