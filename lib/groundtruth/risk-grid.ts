import { RiskCellProperties, RiskGridData, RiskTier } from "@/lib/groundtruth/types";

interface BuildRiskGridOptions {
  rows?: number;
  cols?: number;
  cellSizeKm?: number;
}

const LAT_KM_PER_DEGREE = 110.574;

function toRiskTier(risk: number): RiskTier {
  if (risk >= 0.68) return "high";
  if (risk >= 0.4) return "moderate";
  return "low";
}

function seededNoise(value: number): number {
  const sine = Math.sin(value * 12.9898) * 43758.5453;
  return sine - Math.floor(sine);
}

function riskToHeight(risk: number): number {
  return Math.round(90 + risk * 420);
}

export function buildRiskGrid(
  center: [number, number],
  options: BuildRiskGridOptions = {}
): RiskGridData {
  const rows = options.rows ?? 7;
  const cols = options.cols ?? 7;
  const cellSizeKm = options.cellSizeKm ?? 0.65;

  const [centerLng, centerLat] = center;
  const lngKmPerDegree = 111.32 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.15);

  const latStep = cellSizeKm / LAT_KM_PER_DEGREE;
  const lngStep = cellSizeKm / lngKmPerDegree;

  const rowHalf = (rows - 1) / 2;
  const colHalf = (cols - 1) / 2;

  const features: GeoJSON.Feature<GeoJSON.Polygon, RiskCellProperties>[] = [];

  let riskSum = 0;
  let highestRisk = 0;
  let lowCount = 0;
  let moderateCount = 0;
  let highCount = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const rowOffset = row - rowHalf;
      const colOffset = col - colHalf;

      const lat = centerLat + rowOffset * latStep;
      const lng = centerLng + colOffset * lngStep;

      const radialFalloff = Math.max(0, 1 - Math.hypot(rowOffset, colOffset) / (Math.max(rows, cols) * 0.75));
      const syntheticNoise = seededNoise((lng + 180) * 0.37 + (lat + 90) * 0.73 + row * 3.11 + col * 7.17);
      const risk = Math.min(0.98, Math.max(0.08, syntheticNoise * 0.58 + radialFalloff * 0.42));

      const tier = toRiskTier(risk);
      const height = riskToHeight(risk);

      if (tier === "low") lowCount += 1;
      if (tier === "moderate") moderateCount += 1;
      if (tier === "high") highCount += 1;

      riskSum += risk;
      highestRisk = Math.max(highestRisk, risk);

      const halfLng = lngStep * 0.44;
      const halfLat = latStep * 0.44;

      const polygon: GeoJSON.Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [lng - halfLng, lat - halfLat],
            [lng + halfLng, lat - halfLat],
            [lng + halfLng, lat + halfLat],
            [lng - halfLng, lat + halfLat],
            [lng - halfLng, lat - halfLat],
          ],
        ],
      };

      const featureId = row * cols + col;

      features.push({
        type: "Feature",
        id: featureId,
        geometry: polygon,
        properties: {
          id: `${row}-${col}`,
          risk,
          height,
          tier,
        },
      });
    }
  }

  return {
    cells: {
      type: "FeatureCollection",
      features,
    },
    summary: {
      averageRisk: riskSum / (rows * cols),
      highestRisk,
      lowCount,
      moderateCount,
      highCount,
    },
  };
}
