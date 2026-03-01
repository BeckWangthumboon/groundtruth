# Simulation Engine

Pure-JavaScript foot traffic simulation for the GroundTruth Area 3D view.

## Files

| File | Purpose |
|------|---------|
| `engine.js` | `computeWeight()` and `computeDensityScale()` |
| `profiles.js` | Weekday / weekend Gaussian mixture profiles per category |
| `categories.js` | Overpass POI type → simulation category mapping and category colours |
| `layers.js` | deck.gl layer factory (`buildSimulationLayers`) |
| `types.js` | JSDoc typedefs: `SimulationPOI`, `SimState`, `CensusMetrics` |

## Gaussian model

Each POI category has a traffic profile defined as a sum of Gaussian bells:

```
weight(hour) = Σ amplitude_i × exp(-0.5 × ((hour - mu_i) / sigma_i)²)
```

### Weekday profiles

| Category | Peaks |
|----------|-------|
| `food` | Breakfast 07:00, Lunch 12:00, Dinner 18:30 |
| `retail` | Midday 12:00, Late afternoon 17:00 |
| `office` | Morning arrival 09:00, Lunch 13:00, Departure 17:00 |
| `nightlife` | Evening 21:00, Midnight 23:00 |
| `services` | Morning 10:00, Early afternoon 14:00 |
| `leisure` | Mid-morning 10:00, After-work 16:00 |

Weekend profiles shift peaks later (brunch, later nights) and nearly empty the office.

## `computeWeight(poi, hour, dayType, focusMode, densityScale)`

Computes a clamped 0–1 weight for a single POI at a given simulated time.

Pipeline:
1. Map POI `type` → simulation category via `toSimCategory()`
2. Evaluate Gaussian profile at `hour`
3. Multiply by `densityScale` (population density normalisation)
4. Apply focus-mode modifier:
   - **tenant**: Penalises nightlife (×0.3), boosts leisure (×1.5), halves late-night hours (22:00–06:00)
   - **business**: Boosts food/retail (×1.3), boosts office (×1.2)
5. Clamp to [0, 1]

## `computeDensityScale(population, tractAreaSqM)`

Normalises local population density against a reference of 5 000 ppl/km².
Returns a value in [0.1, 2.0]:
- Dense urban neighbourhoods → scale > 1 (taller hexagons, brighter heat)
- Sparse rural areas → scale < 1

## Category mapping (Overpass → simulation)

| Overpass type | Simulation category |
|---------------|---------------------|
| `food` | `food` |
| `nightlife` | `nightlife` |
| `retail` | `retail` |
| `grocery` | `retail` |
| `healthcare` | `services` |
| `parking` | `services` |
| `transit` | `services` |
| `parks` | `leisure` |

## Deck.gl layers

`buildSimulationLayers(state)` assembles up to 4 deck.gl layers filtered by `layerVisibility`:

| Layer | ID | Driven by |
|-------|----|-----------|
| `HeatmapLayer` | `sim-heatmap` | `computeWeight` per POI → `getWeight` |
| `HexagonLayer` | `sim-hexagons` | `computeWeight` per POI → `getElevationWeight`, 800 ms transition |
| `ScatterplotLayer` | `sim-scatter` | Size and alpha from `computeWeight`; colour from `CATEGORY_COLORS` |
| `GeoJsonLayer` | `sim-tract-boundary` | Translucent wireframe extrusion at fixed 150 m height |

All time-varying layers include `updateTriggers` keyed on `[currentHour, dayType, focusMode]`
so deck.gl re-evaluates accessors whenever the simulation state changes.

## How to extend

### Add a new POI category

1. Add an entry to `OVERPASS_TO_SIM_CATEGORY` in `categories.js`.
2. Add an entry to `CATEGORY_COLORS` for the ScatterplotLayer colour.
3. Add a new profile function in both `WEEKDAY_PROFILES` and `WEEKEND_PROFILES` in `profiles.js`.
4. Update `computeWeight` in `engine.js` if the new category needs focus-mode modifiers.

### Change the radius

The default fetch radius is 800 m. Pass `radiusM` to `fetchNearbyPois()` in `src/lib/api.js`, 
or change the default in `Area3DPage.jsx`.

### Add a new deck.gl layer

Add a `create*Layer()` function to `layers.js` and include it in `buildSimulationLayers()` 
with a corresponding `layerVisibility` key and a checkbox in `ControlPanel.jsx`.
