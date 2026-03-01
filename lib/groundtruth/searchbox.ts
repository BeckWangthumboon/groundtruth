import type { SearchBoxRetrieveResponse } from "@mapbox/search-js-core";
import { LocationSelection } from "@/lib/groundtruth/types";

export function toLocationFromSearchBoxRetrieve(response: SearchBoxRetrieveResponse): LocationSelection | null {
  const feature = response.features[0];
  if (!feature) return null;

  const coordinates = feature.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const [lng, lat] = coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const label =
    feature.properties?.full_address?.trim() ||
    feature.properties?.name?.trim() ||
    `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  return {
    label,
    coordinates: [lng, lat],
  };
}
