# use-mapbox-gl-js-with-react

This is supporting code for the Mapbox tutorial [Use Mapbox GL JS in an React app](https://docs.mapbox.com/help/tutorials/use-mapbox-gl-js-with-react/).

## Overview

This tutorial walks through how to setup [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) in an [React](https://react.dev) project.  


You'll learn how to:
- Setup a Vite JS app to use React
- How to install Mapbox GL JS and its dependencies.
- Use Mapbox GL JS to render a full screen map.
- How to add a toolbar which displays map state like `longitude`, `latitude`, and `zoom` level and is updated as the map is interacted with (showing the map to app data flow).
- How to create a UI button to reset the map to its original view (showing the app to map data flow).


## Prerequisites

- Node v18.20 or higher
- npm

## How to run

- Clone this repository and navigate to this directory
- Install dependencies with `npm install`
- Replace `YOUR_MAPBOX_ACCESS_TOKEN` in `src/App.jsx` with an access token from your [Mapbox account](https://console.mapbox.com/).
- Run the development server with `npm run dev` and open the app in your browser at [http://localhost:5173](http://localhost:5173).

## Area 3D page (0.1 km square)

This project includes a dedicated 3D area page that fits a 100m x 100m square around a coordinate.

- URL format: `http://localhost:5173/area-3d.html?lat=43.074&lon=-89.384`
- Query parameter validation:
  - `lat` range: `[-85.051129, 85.051129]`
  - `lon` range: `[-180, 180]`
  - Invalid values fall back to defaults: `lat=43.074`, `lon=-89.384`

CLI helper command:

```bash
npm run area3d -- --lat 43.074 --lon -89.384
npm run area3d -- --lat 43.074 --lon -89.384 --open
npm run area3d -- --base-url http://localhost:5173
```

The command prints the final `area-3d.html` URL and optionally opens it in your browser when `--open` is provided.

## Foot Traffic Simulation

The Area 3D page now includes a real-time foot traffic simulation powered by OpenStreetMap POI data and Gaussian mixture models.

### How it works

1. On load, the page fetches nearby POIs from `/api/pois/nearby` (up to 150 points, 800 m radius by default) and the Census tract boundary from `/api/census/tract-geo`.
2. The simulation engine (`src/lib/simulation/engine.js`) computes a 0–1 weight for each POI at every time step using Gaussian mixture profiles calibrated to POI category (food, retail, nightlife, services, leisure, office) and day type (weekday/weekend).
3. deck.gl layers (Heatmap, Hexagon, Scatter, Tract Boundary) are rendered as a `MapboxOverlay` on top of the existing Mapbox 3D scene and updated in real time as the controls change.

### Controls

| Control | What it does |
|---------|-------------|
| Time slider | Scrub through 0–24 h in 15-minute increments; auto-play advances at 2 s/hour |
| Day type | Switch between weekday and weekend Gaussian profiles |
| Focus | Tenant mode penalises nightlife, boosts leisure; Business mode amplifies foot traffic peaks |
| Layer visibility | Toggle Heatmap / 3D Hexagons / POI Dots / Tract Boundary independently |
| Camera presets | Snap to 2D (top-down), 3D Tilt (pitch 45°), or Bird's Eye (pitch 60°) |

### API endpoints added

| Endpoint | Description |
|----------|-------------|
| `GET /api/pois/nearby?lat=&lon=&radius_m=800` | OSM POIs via Overpass (categorised, downsampled to 150) |
| `GET /api/census/tract-geo?lat=&lon=` | Census tract boundary as GeoJSON Feature |

### Simulation engine documentation

See [`src/lib/simulation/README.md`](./src/lib/simulation/README.md) for a full description of the Gaussian model, category mapping, and how to extend profiles.

## Census data lookup (coordinates and address workflows)

This repository also includes a Python script for pulling Census Reporter data from coordinates and for address-to-coordinate conversion workflows.

- Script: `scripts/census_reporter_lookup.py`
- Full usage guide: [`scripts/README-census-reporter-lookup.md`](./scripts/README-census-reporter-lookup.md)
