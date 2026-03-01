# Building Coloring by Type

This document describes how to add **building coloring by use type** (e.g. restaurants, banking, small business, tech companies, schools, higher education) using the same techniques the project already uses: Overpass API for data, categorization, and deck.gl for visualization. For **roads and sidewalks**, segmentation and coloring can be done with Mapbox’s built-in vector tiles (see [§7](#7-related-roads-and-sidewalks)).

---

## 1. Feasibility with current techniques

**Yes, you can add building-by-type coloring** without introducing new stacks:

| Current technique | Reuse for building types |
|-------------------|---------------------------|
| **Overpass API** (`scripts_sumedh/overpass_pois.py`) | New (or extended) Overpass query for **ways** with `building`, `amenity`, `shop`, `office` etc., returning **full polygon geometry** instead of only centroids. |
| **Category → color mapping** (`src/lib/simulation/categories.js` `CATEGORY_COLORS`) | New mapping: building type → RGB (e.g. restaurant → orange, school → blue). |
| **deck.gl GeoJsonLayer** (`src/lib/simulation/layers.js` tract boundary) | New layer: GeoJSON polygons with a `buildingType` property, `getFillColor` (and optionally `getElevation`) by type. |
| **Mapbox 3D buildings** (`Area3DPage.jsx` `add3DBuildings`) | Mapbox’s `composite` building layer has **no use-type** in the tiles (only height). So “color by type” must come from **custom data** (Overpass) as a separate layer; you can keep Mapbox buildings as a grey base and draw colored polygons on top, or hide Mapbox buildings when the building-type layer is on. |

So: same data source pattern (Overpass), same “category + color” pattern, same deck.gl layer pattern. The only new piece is an Overpass query that returns **building footprints (polygons)** plus tags you can map to display types. Mapbox’s `composite` building layer only exposes `height` and `min_height` in the tiles—no use-type—so building-by-type coloring **must** come from custom data (Overpass + GeoJSON layer).

---

## 2. Data: building types from OpenStreetMap

OSM represents use via tags on **ways** (and sometimes nodes). Many buildings are closed ways with tags such as:

- **amenity** — restaurant, cafe, bank, school, university, college, pharmacy, hospital, etc.
- **shop** — supermarket, mall, clothes, etc. (retail / small business)
- **office** — company, it, government, etc. (tech / office)
- **building** — commercial, retail, school, university, etc. (generic form; use when amenity/shop/office are missing)

To get **polygons**, you need **ways** with **full geometry** (node coordinates). Overpass can return that with `out geom` (or `out body geom`).

### 2.1 Suggested display taxonomy

Map OSM tags to a small set of display categories suitable for “color by type”:

| Display type | OSM tags (examples) | Typical color idea |
|--------------|---------------------|--------------------|
| **restaurant** | `amenity` ∈ restaurant, cafe, fast_food | Orange / warm |
| **banking** | `amenity` = bank | Dark green / teal |
| **retail** | `shop` = * (except supermarket, convenience → grocery) | Green |
| **grocery** | `shop` ∈ supermarket, convenience | Light green |
| **office** | `office` = * (generic offices, small business) | Blue |
| **tech** | `office` = it, software_company; or name/description hints | Purple / blue |
| **school** | `amenity` = school; `building` = school | Light blue |
| **higher_education** | `amenity` ∈ university, college | Dark blue |
| **healthcare** | `amenity` ∈ hospital, clinic, doctors, dentist, pharmacy | Red / pink |
| **government** | `office` = government; `amenity` = townhall, etc. | Grey / navy |
| **other** | Everything else with building=yes (or no type tag) | Neutral grey |

You can merge or split (e.g. separate “small business” vs “tech”) by refining the tag rules.

### 2.2 Overpass query shape for building polygons

Conceptually:

- **Input:** lat, lon, radius_m (same as existing POI fetch).
- **Query:** In the bbox/radius, select **ways** that have:
  - `building=*` or
  - `amenity=*` or
  - `shop=*` or
  - `office=*`
- **Output:** `out geom` so each way has its node coordinates and forms a polygon.
- **Post-process:** For each way, read tags → assign one display type (e.g. “restaurant”, “school”) using a deterministic priority (e.g. amenity over shop over office over building). Build GeoJSON FeatureCollection: each Feature = one polygon + properties `{ buildingType, name? }`.

Existing code uses `out center tags` for POIs (points). For buildings you need **full way geometry**, so the query and response handling differ: you must resolve way nodes to coordinates (Overpass returns node refs and, with `geom`, lat/lon for nodes, or you use `out geom` so geometry is included).

---

## 3. Backend: new or extended endpoint

**Option A — New module and endpoint (recommended)**  
Keep POI logic unchanged; add a separate path for “buildings with geometry”:

- **New script** (e.g. `scripts_sumedh/overpass_buildings.py`):
  - Build Overpass query for ways (building/amenity/shop/office) in radius, with `out geom`.
  - Parse elements, resolve way geometry to coordinates, build polygons.
  - Categorize each way into one of the display types (restaurant, banking, school, etc.) via a tag→type function.
  - Return `{ "type": "FeatureCollection", "features": [ { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [...] }, "properties": { "buildingType": "restaurant", "name": "..." } } ] }`.
- **New route** in `backend/app/main.py`, e.g. `GET /api/buildings/nearby?lat=&lon=&radius_m=`, calling that script (with same caching pattern as POIs if desired).

**Option B — Extend existing Overpass module**  
- Add a second query (or a mode) in `overpass_pois.py` that requests building ways with geometry and a separate categorizer for building types.  
- Either return buildings in the same response (e.g. `buildings` key) or expose a separate endpoint that reuses the same HTTP/cache helpers.

Data contract for the frontend: **GeoJSON FeatureCollection** where each feature has:

- `geometry`: Polygon (or MultiPolygon if you merge multipolygon relations).
- `properties.buildingType`: one of your display types (e.g. `restaurant`, `banking`, `school`, `higher_education`, `office`, `tech`, `retail`, `grocery`, `healthcare`, `government`, `other`).
- Optional: `properties.name`.

---

## 4. Frontend: building-type layer

**4.1 Color map**  
Add a small module or section (e.g. in `src/lib/simulation/categories.js` or `src/lib/buildingTypes.js`) that maps `buildingType` → RGB, similar to `CATEGORY_COLORS`:

```js
export const BUILDING_TYPE_COLORS = {
  restaurant:        [255, 152,  0],   // orange
  banking:           [ 76, 175, 80],   // green
  retail:            [  0, 200,  83],
  grocery:           [129, 199, 132],
  office:            [ 66, 133, 244],  // blue
  tech:              [142,  68, 173],  // purple
  school:            [ 33, 150, 243],
  higher_education:  [ 25, 118, 210],
  healthcare:        [233,  30,  99],
  government:        [ 97,  97,  97],
  other:             [158, 158, 158],
}
```

**4.2 Fetch buildings**  
In `src/lib/api.js`, add something like:

- `fetchNearbyBuildings({ lat, lon, radiusM, signal })` → returns the GeoJSON FeatureCollection.

**4.3 deck.gl layer**  
Add a layer factory (e.g. in `layers.js` or a new `buildingLayers.js`) that takes the buildings GeoJSON and optional visibility flag:

- **GeoJsonLayer** (or **SolidPolygonLayer** with the same data):
  - `data`: buildings FeatureCollection.
  - `getFillColor`: `f => BUILDING_TYPE_COLORS[f.properties?.buildingType] ?? DEFAULT` (add alpha, e.g. 200, if you want slight transparency).
  - Optional: `getElevation`: e.g. from `properties.levels * 3` (meters) or a constant so buildings appear slightly extruded; or leave flat for a 2D “footprint” look.
  - `id`: e.g. `building-by-type`.
  - Draw **below** the simulation heatmap/hexagons so POI layers stay on top, or make order configurable.

**4.4 Where to show it**  
- **Area 3D page:** Add a “Building types” (or “Color buildings”) toggle; when on, fetch buildings for current lat/lon/radius and add the layer. You can re-use the same radius as POIs.
- **Main map (App.jsx):** If you want building coloring in the main globe/search view, add the same layer and fetch when a location is selected (same pattern as census/POI fetch).

**4.5 Layer order**  
Suggested order (bottom → top): Mapbox base → Mapbox 3D buildings (optional) → **Building-by-type layer** (colored polygons) → tract boundary (if any) → heatmap / hexagons / scatter. That way colored buildings sit under the simulation layers.

---

## 5. Implementation checklist

- [ ] **Backend:** Overpass query for ways (building/amenity/shop/office) with `out geom` in radius.
- [ ] **Backend:** Resolve way geometry to polygons; categorize each way into a single `buildingType`; return GeoJSON FeatureCollection.
- [ ] **Backend:** New endpoint `GET /api/buildings/nearby?lat=&lon=&radius_m=` (and optional caching).
- [ ] **Frontend:** `BUILDING_TYPE_COLORS` (and default) for each display type.
- [ ] **Frontend:** `fetchNearbyBuildings()` in `api.js`.
- [ ] **Frontend:** Layer factory (e.g. `createBuildingTypeLayer(geojson)`) using GeoJsonLayer with `getFillColor` by `buildingType`.
- [ ] **Frontend:** In Area3D (and optionally main app), fetch buildings when location/radius is set; add layer when “Building types” is on; pass buildings into the deck.gl overlay.

---

## 6. Caveats and options

- **Coverage:** Not every building in OSM has `amenity`/`shop`/`office`; many are only `building=yes` or `building=commercial`. Those will fall into `other` unless you add heuristics (e.g. area, shape) or leave them grey.
- **Performance:** Dense areas can have many polygons. Cap the number of buildings or simplify geometries if needed; same idea as POI downsampling.
- **3D:** Mapbox’s built-in 3D buildings don’t support “color by type”. Your colored layer can be 2D footprints, or extruded with a constant/default height, or by `building:levels` from OSM if you include it in the Overpass output and in `properties`.
- **Legend:** Add a small legend (e.g. in the control panel or a collapsible block) listing building types and their colors, so users can read the map.

This keeps the same patterns (Overpass, categorize once, one color per category, deck.gl layer) and fits cleanly next to the existing simulation and POI layers.

---

## 7. Related: roads and sidewalks

**Segmenting and coloring roads and sidewalks** is possible with the same Mapbox GL JS setup **without** custom Overpass data for basic cases. The map uses `mapbox://styles/mapbox/standard`; the underlying vector tiles (e.g. Mapbox Streets v8) include a **`road`** source-layer with a **`class`** property (e.g. motorway, primary, street, pedestrian, service). You can:

- **Option A — Style existing road layers:** After the style loads, use `map.getStyle().layers` to find road layer(s), then `setPaintProperty` and optionally `setFilter` with data-driven expressions (e.g. `['match', ['get', 'class'], 'motorway', '#color1', 'primary', '#color2', …]`) to segment and color roads by class. Use the same approach to highlight sidewalks/pedestrian segments if they share the same layer (e.g. filter or color by `class === 'pedestrian'` or the value your style uses).
- **Option B — Add a new line layer:** Add a layer with `source: 'composite'`, `source-layer: 'road'`, and your own `paint` (e.g. `line-color` via `['match', ['get', 'class'], …]`) and optional `filter`, so you control road/sidewalk segmentation and colors without editing the base style.

For the exact `class` (and other) values in the tiles, see the [Mapbox Streets v8 reference](https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/) and the road layer fields. Mapbox Standard also exposes a **`showPedestrianRoads`** config option; when enabled, pedestrian/sidewalk geometry is present in the data and can be styled as above. If you need **custom categories** or the same taxonomy as building types, you can instead fetch road/sidewalk geometry from Overpass and draw a custom line layer (GeoJSON + deck.gl or Mapbox line layer), same pattern as buildings.
