"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, ChevronLeft, Layers3 } from "lucide-react";
import SearchBar from "@/components/groundtruth/SearchBar";
import { hasMapboxToken, MAPBOX_TOKEN, MAP_STYLE_GRID } from "@/lib/groundtruth/config";
import { fetchFirstGeocodeResult, fetchGeocodingSuggestions } from "@/lib/groundtruth/geocode";
import { animateRiskLayers, drawRiskLayers, GT_LAYER_IDS } from "@/lib/groundtruth/map-layers";
import { buildRiskGrid } from "@/lib/groundtruth/risk-grid";
import { GeocodeSuggestion, LocationSelection, RiskGridData } from "@/lib/groundtruth/types";

const DEMO_LOCATION: LocationSelection = {
  label: "Downtown Atlanta, Georgia",
  coordinates: [-84.38798, 33.74876],
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function parseLocation(searchParams: URLSearchParams): LocationSelection {
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

function toLocationKey(location: LocationSelection): string {
  const [lng, lat] = location.coordinates;
  return `${lat.toFixed(6)}:${lng.toFixed(6)}`;
}

function toExploreUrl(location: LocationSelection): string {
  const [lng, lat] = location.coordinates;
  const params = new URLSearchParams({
    q: location.label,
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
  });
  return `/explore?${params.toString()}`;
}

function isAuthError(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("401") || lowered.includes("403") || lowered.includes("token") || lowered.includes("unauthorized");
}

export default function ExploreScene() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasToken = hasMapboxToken();

  const urlLocation = useMemo(
    () => parseLocation(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const [query, setQuery] = useState(urlLocation.label);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection>(urlLocation);
  const [riskGrid, setRiskGrid] = useState<RiskGridData>(() => buildRiskGrid(urlLocation.coordinates));

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapLoadedRef = useRef(false);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const stopRiskAnimationRef = useRef<(() => void) | null>(null);
  const currentLocationKeyRef = useRef<string>("");
  const selectedLocationRef = useRef<LocationSelection>(selectedLocation);

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
  }, [selectedLocation]);

  const applyLocation = useCallback(
    (location: LocationSelection, syncUrl: boolean) => {
      const nextGrid = buildRiskGrid(location.coordinates);
      const map = mapRef.current;

      setSelectedLocation(location);
      setRiskGrid(nextGrid);
      setSearchError(null);
      setMapError(null);
      currentLocationKeyRef.current = toLocationKey(location);

      if (syncUrl) {
        router.replace(toExploreUrl(location), { scroll: false });
      }

      if (!map || !mapLoadedRef.current) return;

      stopRiskAnimationRef.current?.();
      stopRiskAnimationRef.current = null;
      map.stop();

      if (markerRef.current) markerRef.current.remove();
      markerRef.current = new mapboxgl.Marker({ color: "#f59e0b", scale: 1.15 })
        .setLngLat(location.coordinates)
        .addTo(map);

      const renderGrid = () => {
        drawRiskLayers(map, nextGrid);
        stopRiskAnimationRef.current = animateRiskLayers(map, nextGrid);
        map.flyTo({
          center: location.coordinates,
          zoom: 14,
          pitch: 58,
          bearing: -36,
          offset: [150, 84],
          duration: 2400,
          essential: true,
          easing: (value) => 1 - Math.pow(1 - value, 3),
        });
      };

      if (map.isStyleLoaded()) {
        renderGrid();
      } else {
        map.once("style.load", renderGrid);
      }
    },
    [router]
  );

  useEffect(() => {
    setQuery(urlLocation.label);
    const key = toLocationKey(urlLocation);
    if (key === currentLocationKeyRef.current) return;
    applyLocation(urlLocation, false);
  }, [applyLocation, urlLocation]);

  useEffect(() => {
    if (!hasToken || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_GRID,
      projection: "globe",
      center: selectedLocationRef.current.coordinates,
      zoom: 12,
      pitch: 52,
      bearing: -22,
      antialias: true,
      attributionControl: false,
    });

    map.on("style.load", () => {
      map.setProjection("globe");
      map.setFog({
        color: "#15223d",
        "high-color": "#22345f",
        "space-color": "#040916",
        "horizon-blend": 0.08,
        "star-intensity": 0.6,
      });
    });

    map.on("load", () => {
      mapLoadedRef.current = true;
      setMapError(null);
      applyLocation(selectedLocationRef.current, false);
    });

    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      if (!message) return;
      if (isAuthError(message)) {
        setMapError("Mapbox token rejected. Confirm public token scopes include Styles:Read and Geocoding:Read.");
      }
    });

    map.on("mousemove", (event) => {
      if (!map.isStyleLoaded()) return;

      const features = map.queryRenderedFeatures(event.point, {
        layers: [GT_LAYER_IDS.extrusion],
      });

      if (!features.length) {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
        return;
      }

      const feature = features[0];
      const props = feature.properties ?? {};
      const risk = Number(props.risk ?? 0);
      const height = Number(props.height ?? 0);

      map.getCanvas().style.cursor = "pointer";

      if (!popupRef.current) {
        popupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          className: "gt-popup",
        });
      }

      popupRef.current
        .setLngLat(event.lngLat)
        .setHTML(
          `<div class=\"gt-popup-content\"><p class=\"gt-popup-title\">Risk Cell ${props.id ?? "N/A"}</p><p class=\"gt-popup-sub\">Risk Index: ${formatPercent(
            risk
          )}</p><p class=\"gt-popup-sub\">Bar Height: ${Math.round(height)}m</p></div>`
        )
        .addTo(map);
    });

    map.on("mouseleave", () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    });

    mapRef.current = map;

    return () => {
      stopRiskAnimationRef.current?.();
      stopRiskAnimationRef.current = null;
      popupRef.current?.remove();
      markerRef.current?.remove();
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [applyLocation, hasToken]);

  useEffect(() => {
    if (!hasToken) return;
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const results = await fetchGeocodingSuggestions(query, MAPBOX_TOKEN, controller.signal);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      }
    }, 170);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [hasToken, query]);

  const handleSuggestionSelect = (suggestion: GeocodeSuggestion) => {
    setSuggestions([]);
    setQuery(suggestion.label);
    applyLocation(
      {
        label: suggestion.label,
        coordinates: suggestion.coordinates,
      },
      true
    );
  };

  const handleSearchSubmit = async () => {
    if (!query.trim()) return;
    if (!hasToken) {
      setSearchError("Add NEXT_PUBLIC_MAPBOX_TOKEN (or NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) to enable live search.");
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const result = await fetchFirstGeocodeResult(query, MAPBOX_TOKEN);
      if (!result) {
        setSearchError("No location results found for this query.");
        return;
      }
      handleSuggestionSelect(result);
    } catch {
      setSearchError("Search failed. Check token scope and retry.");
    } finally {
      setIsSearching(false);
    }
  };

  const summaryRows = useMemo(
    () => [
      { label: "Average risk", value: formatPercent(riskGrid.summary.averageRisk) },
      { label: "Highest risk", value: formatPercent(riskGrid.summary.highestRisk) },
      {
        label: "Low / Moderate / High",
        value: `${riskGrid.summary.lowCount} / ${riskGrid.summary.moderateCount} / ${riskGrid.summary.highCount}`,
      },
    ],
    [riskGrid]
  );

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      <div className="fixed inset-0">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {!hasToken || mapError ? <div className="gt-tokenless-backdrop" /> : null}
        <div className="gt-grid-overlay opacity-55" />
      </div>

      <header className="fixed top-0 left-0 right-0 z-40 px-5 md:px-8 pt-5">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="gt-brand-shell">
            <Layers3 className="w-4 h-4 text-cyan-300" />
            <span className="text-sm md:text-base font-semibold tracking-[0.03em]">Ground Truth</span>
          </div>
          <Link href="/" className="gt-tag inline-flex items-center gap-1.5">
            <ChevronLeft className="w-4 h-4" />
            New Search
          </Link>
        </div>
      </header>

      <main className="relative z-10 min-h-screen pt-24 pb-6 px-4 md:px-6 pointer-events-none">
        <div className="mx-auto max-w-6xl h-[calc(100vh-7rem)] md:h-[calc(100vh-7rem)] md:relative flex flex-col gap-4 overflow-y-auto md:overflow-visible">
          <section className="w-full max-w-3xl space-y-4 md:absolute md:top-0 md:left-0">
            <article className="gt-panel pointer-events-auto">
              <p className="gt-kicker mb-3">Search</p>
              <SearchBar
                query={query}
                loading={isSearching}
                suggestions={suggestions}
                onQueryChange={(value) => {
                  setQuery(value);
                  setSearchError(null);
                }}
                onSubmit={handleSearchSubmit}
                onSuggestionSelect={handleSuggestionSelect}
              />

              <div className="mt-4 min-h-6">
                {searchError ? (
                  <p className="inline-flex items-center gap-2 text-sm text-red-300 bg-red-950/60 border border-red-400/20 rounded-full px-4 py-1.5 pointer-events-auto">
                    <AlertCircle className="w-4 h-4" />
                    {searchError}
                  </p>
                ) : null}
              </div>

              {mapError ? (
                <div className="mt-2">
                  <p className="inline-flex items-center gap-2 text-sm text-amber-200 bg-amber-950/60 border border-amber-500/25 rounded-full px-4 py-1.5 pointer-events-auto">
                    <AlertCircle className="w-4 h-4" />
                    {mapError}
                  </p>
                </div>
              ) : null}

              {!hasToken ? (
                <div className="mt-3">
                  <button
                    type="button"
                    className="gt-demo-button"
                    onClick={() => applyLocation(DEMO_LOCATION, true)}
                  >
                    Show Demo Grid
                  </button>
                </div>
              ) : null}
            </article>

            <article className="gt-panel pointer-events-auto">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <p className="gt-kicker mb-2">Grid Data Viz</p>
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-100">{selectedLocation.label}</h2>
                  <p className="text-sm text-slate-300/85 mt-2 max-w-xl">
                    Deterministic risk bars rendered as animated Mapbox 3D extrusions over a wireframe-style floor.
                  </p>
                </div>
                <div className="hidden md:flex gt-chip">
                  <Layers3 className="w-4 h-4" />
                  <span>3D Bars + Grid</span>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                {summaryRows.map((item) => (
                  <div key={item.label} className="gt-metric">
                    <p className="gt-metric-label">{item.label}</p>
                    <p className="gt-metric-value">{item.value}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>

        </div>
      </main>
    </div>
  );
}
