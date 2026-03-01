import { LocationSelection } from "@/lib/groundtruth/types";

export const DEMO_LOCATION: LocationSelection = {
  label: "Downtown Atlanta, Georgia",
  coordinates: [-84.38798, 33.74876],
};

export function toExploreUrl(location: LocationSelection): string {
  const [lng, lat] = location.coordinates;
  const params = new URLSearchParams({
    q: location.label,
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
  });
  return `/explore?${params.toString()}`;
}

export function parseLocationFromSearchParams(searchParams: URLSearchParams): LocationSelection {
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const label = searchParams.get("q");

  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return {
      label: label?.trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      coordinates: [lng, lat],
    };
  }

  return DEMO_LOCATION;
}
