export interface GeocodeSuggestion {
  id: string;
  label: string;
  coordinates: [number, number];
  context?: string;
}

export interface LocationSelection {
  label: string;
  coordinates: [number, number];
}

export type RiskTier = "low" | "moderate" | "high";

export interface RiskCellProperties {
  id: string;
  risk: number;
  height: number;
  tier: RiskTier;
}

export interface RiskGridSummary {
  averageRisk: number;
  highestRisk: number;
  lowCount: number;
  moderateCount: number;
  highCount: number;
}

export interface RiskGridData {
  cells: GeoJSON.FeatureCollection<GeoJSON.Polygon, RiskCellProperties>;
  summary: RiskGridSummary;
}
