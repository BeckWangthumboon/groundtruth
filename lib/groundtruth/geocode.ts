import { GeocodeSuggestion } from "@/lib/groundtruth/types";

interface MapboxForwardResponse {
  features?: Array<{
    id?: string;
    place_name?: string;
    geometry?: {
      coordinates?: number[];
    };
    properties?: {
      full_address?: string;
      name?: string;
      feature_type?: string;
      context?: {
        place?: { name?: string };
        region?: { name?: string };
        country?: { name?: string };
      };
    };
  }>;
}

function toSuggestion(feature: NonNullable<MapboxForwardResponse["features"]>[number]): GeocodeSuggestion | null {
  const coordinates = feature.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const [lng, lat] = coordinates;
  if (typeof lng !== "number" || typeof lat !== "number") return null;

  const contextParts = [
    feature.properties?.context?.place?.name,
    feature.properties?.context?.region?.name,
    feature.properties?.context?.country?.name,
  ].filter(Boolean);

  return {
    id: feature.id ?? `${lng}-${lat}`,
    label:
      feature.properties?.full_address ??
      feature.place_name ??
      feature.properties?.name ??
      "Unknown location",
    coordinates: [lng, lat],
    context: contextParts.join(", "),
  };
}

export async function fetchGeocodingSuggestions(
  query: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<GeocodeSuggestion[]> {
  if (!query.trim()) return [];

  const endpoint = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  endpoint.searchParams.set("q", query.trim());
  endpoint.searchParams.set("autocomplete", "true");
  endpoint.searchParams.set("limit", "6");
  endpoint.searchParams.set(
    "types",
    "country,region,postcode,district,place,locality,neighborhood,street,address,secondary_address"
  );
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("access_token", accessToken);

  const response = await fetch(endpoint.toString(), { signal });
  if (!response.ok) {
    throw new Error(`Geocoding request failed (${response.status})`);
  }

  const payload: MapboxForwardResponse = await response.json();
  return (payload.features ?? []).map(toSuggestion).filter((item): item is GeocodeSuggestion => Boolean(item));
}

export async function fetchFirstGeocodeResult(
  query: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<GeocodeSuggestion | null> {
  const results = await fetchGeocodingSuggestions(query, accessToken, signal);
  return results[0] ?? null;
}
