import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDynamicPois } from '../api'

describe('api.fetchDynamicPois', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes selected labels and optional business type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({
        ok: true,
        json: async () => ({ countsByLabel: {}, points: [], meta: {} }),
      })
    )

    await fetchDynamicPois({
      lat: 43.074,
      lon: -89.384,
      radiusM: 1200,
      selectedLabels: ['retail_density', 'direct_competition'],
      businessType: 'cafe',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url] = fetchSpy.mock.calls[0]
    const calledUrl = new URL(String(url), 'http://localhost')
    expect(calledUrl.pathname).toBe('/api/pois/dynamic')
    expect(calledUrl.searchParams.get('selected_labels')).toBe('retail_density,direct_competition')
    expect(calledUrl.searchParams.get('business_type')).toBe('cafe')
    expect(calledUrl.searchParams.get('radius_m')).toBe('1200')
  })
})
