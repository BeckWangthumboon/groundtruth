/**
 * @file JSDoc type definitions for the simulation engine.
 *
 * These are pure documentation – no runtime code.  Import them wherever you
 * need type hints in JSDoc comments.
 */

/**
 * A single POI point as returned by the /api/pois/nearby backend endpoint
 * (sourced from scripts_sumedh/overpass_pois.py).
 *
 * @typedef {object} SimulationPOI
 * @property {string}  type    - Overpass category: food | retail | grocery | healthcare | parking | transit | nightlife | parks
 * @property {number}  lat     - WGS-84 latitude
 * @property {number}  lng     - WGS-84 longitude
 * @property {number}  weight  - Pre-computed category weight from the backend (0–1)
 * @property {string} [name]   - Optional POI display name from OSM
 */

/**
 * Simulation-wide state threaded through the layer factory and engine.
 *
 * @typedef {object} SimState
 * @property {SimulationPOI[]} pois          - Array of POI points to visualise
 * @property {number}          currentHour   - Current simulated hour (0–24, step 0.25)
 * @property {'weekday'|'weekend'} dayType   - Day-of-week profile selector
 * @property {'tenant'|'business'} focusMode - Perspective modifier
 * @property {number}          densityScale  - Population-density multiplier (1.0 = average)
 * @property {object}          layerVisibility
 * @property {boolean}         layerVisibility.heatmap
 * @property {boolean}         layerVisibility.hexagon
 * @property {boolean}         layerVisibility.scatter
 * @property {boolean}         layerVisibility.tractBoundary
 * @property {object|null}    [tractGeoJson] - GeoJSON Feature for the Census tract boundary
 */

/**
 * A subset of Census ACS values used to derive simulation parameters.
 *
 * @typedef {object} CensusMetrics
 * @property {number} population    - Total population (B01003)
 * @property {number} tractAreaSqM  - Census tract land area in square metres (from TIGER aland)
 */
