import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import { Users, Home, Briefcase, DollarSign } from 'lucide-react'
import { CENSUS_SECTIONS } from '../lib/censusTableCatalog'

const SECTION_ICON_MAP = {
  people: Users,
  housing: Home,
  work_mobility: Briefcase,
  income_poverty: DollarSign,
}

function GaugeChart({ fillPct, color }) {
  const value = fillPct ?? 0
  return (
    <RadialBarChart
      width={52}
      height={52}
      cx={26}
      cy={26}
      innerRadius={14}
      outerRadius={26}
      startAngle={90}
      endAngle={-270}
      data={[{ value }]}
    >
      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
      <RadialBar
        background={{ fill: 'rgba(255,255,255,0.08)' }}
        dataKey="value"
        fill={color}
        cornerRadius={3}
        isAnimationActive={false}
      />
    </RadialBarChart>
  )
}

function HeroCard({ card, isLast }) {
  const sectionMeta = CENSUS_SECTIONS[card.section]
  const color = sectionMeta?.color ?? '#60a5fa'
  const Icon = SECTION_ICON_MAP[card.section] ?? Users

  return (
    <article className={`hero-card${isLast ? ' hero-card--full' : ''}`}>
      <div className="hero-card__top">
        <Icon size={13} color={color} strokeWidth={2.2} />
        <span className="hero-card__label">{card.label}</span>
      </div>

      <div className="hero-card__center">
        <GaugeChart fillPct={card.fillPct} color={color} />
        <div className="hero-card__number-col">
          <p className="hero-card__number">{card.estimateText}</p>
          {card.marginOfErrorText && (
            <p className="hero-card__moe">{card.marginOfErrorText}</p>
          )}
        </div>
      </div>

      {card.fillPct != null && (
        <div className="hero-card__bar-track">
          <div
            className="hero-card__bar-fill"
            style={{ width: `${card.fillPct}%`, background: color }}
          />
        </div>
      )}
    </article>
  )
}

export function CensusHeroStats({ cards }) {
  if (!cards?.length) {
    return null
  }

  return (
    <section className="hero-stats" aria-label="Census snapshot">
      {cards.map((card, i) => (
        <HeroCard key={card.tableId} card={card} isLast={i === cards.length - 1} />
      ))}
    </section>
  )
}
