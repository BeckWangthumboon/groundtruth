import mapboxgl from "mapbox-gl";
import { RiskGridData } from "@/lib/groundtruth/types";

const SOURCE_ID = "gt-risk-cells";
const FILL_LAYER_ID = "gt-risk-floor";
const LINE_LAYER_ID = "gt-risk-wire";
const EXTRUSION_LAYER_ID = "gt-risk-extrusions";
const HEIGHT_SCALE_STATE_KEY = "heightScale";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
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
      "fill-extrusion-height": [
        "*",
        ["get", "height"],
        ["coalesce", ["feature-state", HEIGHT_SCALE_STATE_KEY], 0],
      ],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.9,
      "fill-extrusion-vertical-gradient": true,
    },
  });
}

export function animateRiskLayers(map: mapboxgl.Map, riskGrid: RiskGridData): () => void {
  if (!map.getSource(SOURCE_ID) || !map.getLayer(EXTRUSION_LAYER_ID)) {
    return () => {};
  }

  let frameId: number | null = null;
  const startedAt = performance.now();

  const tick = (now: number) => {
    if (!map.getSource(SOURCE_ID) || !map.getLayer(EXTRUSION_LAYER_ID)) {
      frameId = null;
      return;
    }

    const elapsedSeconds = (now - startedAt) / 1000;

    riskGrid.cells.features.forEach((feature, index) => {
      const id = feature.id;
      if (id === undefined || id === null) return;

      const risk = Number(feature.properties.risk ?? 0);
      const revealDelay = index * 0.02;
      const revealProgress = clamp((elapsedSeconds - revealDelay) / 0.95, 0, 1);
      const revealed = easeOutCubic(revealProgress);

      const pulse =
        risk >= 0.68 ? 1 + Math.sin(elapsedSeconds * 3.2 + index * 0.33) * 0.06 * revealed : 1;

      map.setFeatureState(
        { source: SOURCE_ID, id },
        { [HEIGHT_SCALE_STATE_KEY]: clamp(revealed * pulse, 0, 1.2) }
      );
    });

    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
    }

    if (!map.getSource(SOURCE_ID)) return;

    riskGrid.cells.features.forEach((feature) => {
      const id = feature.id;
      if (id === undefined || id === null) return;
      map.removeFeatureState({ source: SOURCE_ID, id }, HEIGHT_SCALE_STATE_KEY);
    });
  };
}
