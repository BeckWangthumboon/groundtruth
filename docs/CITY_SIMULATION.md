# City Simulation and Orchestration

This document describes the **city simulation and orchestration** design in the GroundTruth project: how foot-traffic-style activity is simulated, visualized, and controlled.

---

## 1. Overview

The simulation **orchestrates perceived city activity** by:

- **Time of day** — Activity at each place varies by hour (e.g. lunch peak, evening nightlife).
- **Day type** — Weekday vs weekend change when peaks occur (e.g. offices quiet on weekends).
- **Focus** — Tenant vs business perspective adjusts which categories are emphasized.
- **Density** — Local population density scales activity up or down.

The result is a **time-varying heatmap and 3D view** of “where people are” and “how busy” places are, driven by POI data and census-derived density—without real-time traffic or movement data.

---

## 2. Goals

- **Visualize** approximate foot-traffic intensity around points of interest (POIs).
- **Animate** over a 24-hour cycle so users see how a neighbourhood behaves at different times.
- **Support two perspectives**: tenant (e.g. quiet, safe, affordable) and business (e.g. foot traffic, visibility).
- **Ground** the view in real geography: Census tract boundary and OSM POIs.

The simulation does **not** (in the current design) model:

- Actual movement along streets.
- Real-time or historical traffic counts.
- Routing or flow between POIs.

---

## 3. Architecture

### 3.1 High-level flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Backend APIs   │     │  Simulation      │     │  Visualization      │
│  POIs + Tract   │ ──► │  Engine + State  │ ──► │  deck.gl + Mapbox    │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
       │                          │                          │
       │  GET /api/pois/nearby     │  currentHour             │  HeatmapLayer
       │  GET /api/census/tract-geo│  dayType, focusMode      │  HexagonLayer
       │                          │  densityScale            │  ScatterplotLayer
       │                          │  layerVisibility         │  GeoJsonLayer
       ▼                          ▼                          ▼
  POI points + meta          computeWeight()              buildSimulationLayers()
  Tract GeoJSON              per POI → 0..1              → layers[]
```

### 3.2 Main components

| Component | Location | Role |
|-----------|----------|------|
| **Simulation engine** | `src/lib/simulation/engine.js` | `computeWeight(poi, hour, dayType, focusMode, densityScale)` → 0–1; `computeDensityScale(population, tractAreaSqM)` → 0.1–2.0 |
| **Profiles** | `src/lib/simulation/profiles.js` | Gaussian time-of-day curves per category (weekday / weekend) |
| **Categories** | `src/lib/simulation/categories.js` | Map Overpass POI type → simulation category; category colours for scatter layer |
| **Layers** | `src/lib/simulation/layers.js` | deck.gl layer factory: heatmap, hexagons, scatter, tract boundary |
| **Types** | `src/lib/simulation/types.js` | JSDoc: `SimulationPOI`, `SimState`, `CensusMetrics` |
| **Area 3D page** | `src/pages/Area3DPage.jsx` | Fetches POIs + tract, holds simulation state, mounts Mapbox + deck.gl overlay |
| **Time slider** | `src/components/simulation/TimeSlider.jsx` | Sets `currentHour` (0–24, step 0.25); optional play/pause |
| **Control panel** | `src/components/simulation/ControlPanel.jsx` | Day type, focus, layer toggles, camera presets |

---

## 4. Data sources and API

### 4.1 POIs (points of interest)

- **Endpoint:** `GET /api/pois/nearby?lat=&lon=&radius_m=`
- **Backend:** `scripts_sumedh/overpass_pois.py` — single Overpass query for amenities, shops, transit, parks, etc., then categorized and downsampled (cap 150 points).
- **Response shape:** `{ counts, points, meta }`. Each `point`: `{ type, lat, lng, weight, name? }`.
- **Overpass types:** `food`, `retail`, `grocery`, `healthcare`, `parking`, `transit`, `nightlife`, `parks`.

Used as the only “activity sources” in the simulation: each POI gets a weight from `computeWeight()` at the current simulated time.

### 4.2 Census tract boundary

- **Endpoint:** `GET /api/census/tract-geo?lat=&lon=`
- **Backend:** Census Geocoder → tract GEOID → TIGER boundary from Census Reporter.
- **Response:** Single GeoJSON Feature (polygon) for the tract containing the point.

Used to draw the **tract boundary** layer (optional wireframe extrusion) so the simulation is clearly scoped to one neighbourhood.

### 4.3 Density scale

- **Source:** Population and land area can come from the POI response `meta` (if the backend attaches census data) or from a separate census lookup. In the frontend, `computeDensityScale(population, tractAreaSqM)` produces a multiplier in [0.1, 2.0] with reference 5 000 people/km².
- **Effect:** Dense tracts get higher activity scale; sparse tracts get lower. If population/area are missing, `densityScale` defaults to 1.0.

---

## 5. Orchestration model

### 5.1 Time (hour and day type)

- **`currentHour`**: 0–24, step 0.25 (15 minutes). Controlled by the time slider; can auto-advance (e.g. +1 hour every 2 seconds).
- **`dayType`**: `weekday` | `weekend`. Selects which set of Gaussian profiles to use.

Each **simulation category** has a profile: a sum of Gaussian bells in `profiles.js`:

- **Weekday:** e.g. food (breakfast 07:00, lunch 12:00, dinner 18:30), office (09:00, 13:00, 17:00), nightlife (21:00, 23:00), retail, services, leisure.
- **Weekend:** Peaks shift later (brunch, later nights); office is nearly empty.

So the “orchestration” of the city is **time-based**: the same POIs show different activity levels at different hours and on weekday vs weekend.

### 5.2 Focus mode (tenant vs business)

- **Tenant:** Emphasizes quieter, safer, affordable areas; penalizes nightlife (×0.3), boosts leisure (×1.5), halves weight 22:00–06:00.
- **Business:** Emphasizes foot traffic and visibility; boosts food/retail (×1.3), office (×1.2).

Same POIs and same hour can therefore show different intensities depending on focus—supporting “tenant view” vs “business view” of the same neighbourhood.

### 5.3 Density scale

- **`densityScale`** multiplies the raw profile output so that dense neighbourhoods look busier and sparse ones quieter, in line with census-derived population density.

Together, **time + day type + focus + density** define a single “orchestration state” that drives all POI weights and thus the heatmap, hexagons, and scatter dots.

---

## 6. Visualization layers

All layers are built by `buildSimulationLayers(state)` in `src/lib/simulation/layers.js` and rendered by deck.gl on top of Mapbox in the Area 3D view.

| Layer | deck.gl type | ID | Data | Purpose |
|-------|----------------|----|------|--------|
| **Heatmap** | `HeatmapLayer` | `sim-heatmap` | POIs; weight from `computeWeight` | Continuous density glow of “activity” |
| **Hexagons** | `HexagonLayer` | `sim-hexagons` | POIs; elevation weight from `computeWeight` | 3D columns that grow/shrink with activity (800 ms transition) |
| **Scatter** | `ScatterplotLayer` | `sim-scatter` | POIs; radius and alpha from `computeWeight`; colour from category | Individual POI dots, size and brightness by activity |
| **Tract boundary** | `GeoJsonLayer` | `sim-tract-boundary` | Tract GeoJSON | Translucent wireframe at 150 m height for neighbourhood context |

Layer visibility is toggled in the control panel (`layerVisibility.heatmap`, `.hexagon`, `.scatter`, `.tractBoundary`). The same `SimState` (pois, currentHour, dayType, focusMode, densityScale, tractGeoJson) is passed into the layer factory so all time-varying layers stay in sync via `updateTriggers`.

---

## 7. User interface (Area 3D)

- **Entry:** Area 3D view is typically reached with query params `?lat=&lon=` (and optionally a route or link from the main app).
- **Toolbar:** Shows “Foot Traffic Simulation” and the current centre + radius.
- **Radius:** Buttons (e.g. 0.1, 0.25, 0.5, 1 km) refit the map and re-fetch POIs for the selected radius.
- **Time slider:** 0–24 with labels (e.g. 12 AM, 11 PM); play/pause advances the simulated hour.
- **Control panel:** Day type (Weekday / Weekend), Focus (Tenant / Business), layer checkboxes (Heatmap, 3D Hexagons, POI Dots, Tract Boundary), and camera presets (2D, 3D Tilt, Bird’s Eye).

The map uses Mapbox Standard style with terrain and 3D buildings; the simulation layers are drawn by a deck.gl `MapboxOverlay`.

---

## 8. Extension points

- **New POI category:** Add Overpass → simulation mapping and colour in `categories.js`, weekday/weekend profiles in `profiles.js`, and any focus modifiers in `engine.js`.
- **New layer:** Add a `create*Layer()` in `layers.js`, include it in `buildSimulationLayers()` under a `layerVisibility` flag, and add a checkbox in `ControlPanel.jsx`.
- **Radius / defaults:** Change `radiusM` in `fetchNearbyPois()` (e.g. in `Area3DPage.jsx` or `api.js`) or the radius options in the UI.
- **Profiles:** Adjust Gaussian parameters (mu, sigma, amplitude) in `profiles.js` to tune when each category peaks.

See also `src/lib/simulation/README.md` for a shorter, file-level summary.

---

## 9. Future directions (not yet implemented)

- **Street-level flow:** Fetch street centerlines (e.g. Overpass `highway` ways or Mapbox vector tiles), assign a “flow” value per segment from nearby POI weights (e.g. sum of `computeWeight` for POIs within distance). Render with a line layer (deck.gl `PathLayer` or Mapbox `line`) with width/color by flow.
- **Path-based movement:** Use POIs as origins/destinations, call Mapbox Directions or OSRM for routes, then animate “trips” (e.g. deck.gl `TripsLayer` or animated dash) to suggest movement between places.
- **Heatmap from flow:** Sample points along street segments with weight = segment flow; feed into a heatmap or line-width visualization so “busy corridors” appear as part of the orchestration.

These would extend the current “orchestration” from **point-in-time activity at POIs** to **flow along streets** and **movement along paths**, while reusing the same time/focus/density model.

---

## 10. File reference

| Concern | File(s) |
|--------|---------|
| Simulation engine and density | `src/lib/simulation/engine.js` |
| Time-of-day profiles | `src/lib/simulation/profiles.js` |
| POI categories and colours | `src/lib/simulation/categories.js` |
| Layer construction | `src/lib/simulation/layers.js` |
| State and POI types | `src/lib/simulation/types.js` |
| Area 3D page and data fetch | `src/pages/Area3DPage.jsx` |
| Time control | `src/components/simulation/TimeSlider.jsx` |
| Focus, day type, layers, camera | `src/components/simulation/ControlPanel.jsx` |
| POI and tract API client | `src/lib/api.js` (`fetchNearbyPois`, `fetchTractGeo`) |
| Backend POI endpoint | `backend/app/main.py` → `scripts_sumedh/overpass_pois.py` |
| Backend tract-geo | `backend/app/main.py` → census services |

This document reflects the project design as implemented; for implementation details and exact APIs, see the source files and `src/lib/simulation/README.md`.
