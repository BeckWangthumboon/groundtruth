import { Tabs } from 'radix-ui'
import { Users, Home, Briefcase, DollarSign } from 'lucide-react'
import { CensusStatRow } from './CensusStatRow'

const SECTION_ICON_MAP = {
  people: Users,
  housing: Home,
  work_mobility: Briefcase,
  income_poverty: DollarSign,
}

/**
 * @param {string} color
 * @returns {React.CSSProperties}
 */
function sectionStyle(color) {
  // @ts-ignore -- CSS custom properties are valid but not in the TS type
  return { '--section-color': color }
}

export function CensusStatTabs({ sections }) {
  if (!sections?.length) {
    return null
  }

  const defaultSection = sections[0]?.id

  return (
    <Tabs.Root className="stat-tabs" defaultValue={defaultSection}>
      <Tabs.List className="stat-tabs__list" aria-label="Census data sections">
        {sections.map((section) => {
          const Icon = SECTION_ICON_MAP[section.id] ?? Users
          return (
            <Tabs.Trigger
              key={section.id}
              className="stat-tabs__trigger"
              value={section.id}
              style={sectionStyle(section.color)}
            >
              <Icon size={12} strokeWidth={2.2} />
              {section.shortTitle}
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>

      {sections.map((section) => (
        <Tabs.Content key={section.id} className="stat-tabs__content" value={section.id}>
          <div className="stat-rows">
            {section.rows.map((row) => (
              <CensusStatRow key={row.tableId} row={row} sectionColor={section.color} />
            ))}
          </div>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}
