/** Max place names to include per category to avoid token overflow. */
const MAX_NAMES_PER_CATEGORY = 20

/**
 * Build the selected keypoints payload for the chat API from the Key Points checklist
 * and POI data. The backend injects this into the system prompt so the assistant
 * can refer to nearby amenities (counts and example names) based on what the user selected.
 *
 * @param {readonly { id: string, label: string }[]} checklistItems - All key point items
 * @param {Record<string, boolean>} checklistState - Which items are checked
 * @param {{ countsByLabel?: Record<string, number>, points?: Array<{ type?: string, categories?: string[], name?: string }> } | null} poiData - POI response
 * @returns {Array<{ id: string, label: string, count: number, names?: string[] }>}
 */
export function buildKeypointsContextForChat(checklistItems, checklistState, poiData) {
  if (!Array.isArray(checklistItems) || checklistItems.length === 0) {
    return []
  }

  const countsByLabel = poiData?.countsByLabel ?? {}
  const points = Array.isArray(poiData?.points) ? poiData.points : []

  const result = []
  for (const item of checklistItems) {
    const isChecked = Boolean(checklistState?.[item.id])
    if (!isChecked) {
      continue
    }

    const count = typeof countsByLabel[item.id] === 'number' && Number.isFinite(countsByLabel[item.id])
      ? countsByLabel[item.id]
      : 0

    const names = new Set()
    for (const point of points) {
      if (names.size >= MAX_NAMES_PER_CATEGORY) break
      const categories = Array.isArray(point?.categories) && point.categories.length > 0
        ? point.categories
        : point?.type ? [point.type] : []
      if (!categories.includes(item.id)) continue
      const name = typeof point?.name === 'string' ? point.name.trim() : ''
      if (name) names.add(name)
    }

    const entry = {
      id: item.id,
      label: item.label || item.id,
      count,
    }
    if (names.size > 0) {
      entry.names = [...names]
    }
    result.push(entry)
  }

  if (result.length === 0) {
    return []
  }

  return result
}
