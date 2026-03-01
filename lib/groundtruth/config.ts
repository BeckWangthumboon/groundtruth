export const MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

export const MAP_STYLE_HERO = "mapbox://styles/mapbox/satellite-streets-v12";
export const MAP_STYLE_GRID = "mapbox://styles/mapbox/dark-v11";

export function hasMapboxToken(): boolean {
  return MAPBOX_TOKEN.trim().length > 0;
}
