import mapboxgl from "mapbox-gl";
import { RiskGridData } from "@/lib/groundtruth/types";

const SOURCE_ID = "gt-risk-cells";
const FILL_LAYER_ID = "gt-risk-floor";
const LINE_LAYER_ID = "gt-risk-wire";
const EXTRUSION_LAYER_ID = "gt-risk-extrusions";

export const GT_LAYER_IDS = {
  source: SOURCE_ID,
  fill: FILL_LAYER_ID,
  wire: LINE_LAYER_ID,
  extrusion: EXTRUSION_LAYER_ID,
} as const;

export function clearRiskLayers(map: mapboxgl.Map) {
  [EXTRUSION_LAYER_ID, LINE_LAYER_ID, FILL_LAYER_ID].forEach((layerId) => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  });

  if (map.getSource(SOURCE_ID)) {
    map.removeSource(SOURCE_ID);
  }
}

export function drawRiskLayers(map: mapboxgl.Map, riskGrid: RiskGridData) {
  if (!map.isStyleLoaded()) return;

  clearRiskLayers(map);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: riskGrid.cells,
  });

  map.addLayer({
    id: FILL_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["get", "risk"],
        0,
        "#0c1224",
        0.4,
        "#112b3f",
        0.7,
        "#1a3f5c",
        1,
        "#205172",
      ],
      "fill-opacity": 0.18,
    },
  });

  map.addLayer({
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": "#9ca3af",
      "line-width": 1,
      "line-opacity": 0.45,
    },
  });

  map.addLayer({
    id: EXTRUSION_LAYER_ID,
    type: "fill-extrusion",
    source: SOURCE_ID,
    paint: {
      "fill-extrusion-color": [
        "interpolate",
        ["linear"],
        ["get", "risk"],
        0,
        "#22d3ee",
        0.45,
        "#60a5fa",
        0.75,
        "#f59e0b",
        1,
        "#f97316",
      ],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.9,
      "fill-extrusion-vertical-gradient": true,
    },
  });
}
