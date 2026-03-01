"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, Orbit } from "lucide-react";
import SearchBar from "@/components/groundtruth/SearchBar";
import { hasMapboxToken, MAPBOX_TOKEN, MAP_STYLE_HERO } from "@/lib/groundtruth/config";
import { fetchFirstGeocodeResult, fetchGeocodingSuggestions } from "@/lib/groundtruth/geocode";
import { GeocodeSuggestion, LocationSelection } from "@/lib/groundtruth/types";

const HERO_CENTER: [number, number] = [0, 20];
const HERO_ZOOM = 0.85;
const DEMO_LOCATION: LocationSelection = {
  label: "Downtown Atlanta, Georgia",
  coordinates: [-84.38798, 33.74876],
};

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

export default function LandingHero() {
  const router = useRouter();
  const hasToken = hasMapboxToken();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const stopRotation = useCallback(() => {
    if (rotationFrameRef.current !== null) {
      cancelAnimationFrame(rotationFrameRef.current);
      rotationFrameRef.current = null;
    }
  }, []);

  const startRotation = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    stopRotation();
    lastFrameTimeRef.current = performance.now();

    const tick = (timestamp: number) => {
      const activeMap = mapRef.current;
      if (!activeMap) return;

      const dt = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      if (activeMap.getZoom() <= 2.8) {
        const center = activeMap.getCenter();
        center.lng -= dt * 0.00135;
        activeMap.jumpTo({ center });
      }

      rotationFrameRef.current = requestAnimationFrame(tick);
    };

    rotationFrameRef.current = requestAnimationFrame(tick);
  }, [stopRotation]);

  useEffect(() => {
    if (!hasToken || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_HERO,
      projection: "globe",
      center: HERO_CENTER,
      zoom: HERO_ZOOM,
      pitch: 0,
      bearing: 0,
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
      setMapError(null);
      startRotation();
    });

    map.on("mousedown", stopRotation);
    map.on("touchstart", stopRotation);

    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      if (!message) return;
      if (isAuthError(message)) {
        setMapError("Mapbox token rejected. Confirm public token scopes include Styles:Read and Geocoding:Read.");
      }
    });

    mapRef.current = map;

    return () => {
      stopRotation();
      map.remove();
      mapRef.current = null;
    };
  }, [hasToken, startRotation, stopRotation]);

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

  const handleSelect = (suggestion: GeocodeSuggestion) => {
    setSuggestions([]);
    setQuery(suggestion.label);
    router.push(
      toExploreUrl({
        label: suggestion.label,
        coordinates: suggestion.coordinates,
      })
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
      handleSelect(result);
    } catch {
      setSearchError("Search failed. Check token scope and retry.");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      <div className="fixed inset-0">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {!hasToken || mapError ? <div className="gt-tokenless-backdrop" /> : null}
        <div className="gt-globe-focus" aria-hidden />
        <div className="gt-hero-overlay opacity-100" />
      </div>

      <header className="fixed top-0 left-0 right-0 z-40 px-5 md:px-8 pt-5">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="gt-brand-shell">
            <Orbit className="w-4 h-4 text-amber-300" />
            <span className="text-sm md:text-base font-semibold tracking-[0.03em]">Ground Truth</span>
          </div>
          <span className="hidden sm:inline-flex gt-tag">Landing</span>
        </div>
      </header>

      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 pointer-events-none">
        <div className="w-full max-w-4xl text-center">
          <p className="gt-kicker mb-5">Spatial Safety Intelligence</p>
          <h1 className="text-5xl md:text-7xl font-black leading-[0.94] tracking-tight mb-5 text-slate-100">
            Know Before You Go
          </h1>
          <p className="text-base md:text-lg text-slate-300/90 max-w-2xl mx-auto mb-10">
            Search a place and transition into the Ground Truth 3D risk grid experience.
          </p>

          <SearchBar
            query={query}
            loading={isSearching}
            suggestions={suggestions}
            onQueryChange={(value) => {
              setQuery(value);
              setSearchError(null);
            }}
            onSubmit={handleSearchSubmit}
            onSuggestionSelect={handleSelect}
          />

          <div className="mt-5 min-h-6">
            {searchError ? (
              <p className="inline-flex items-center gap-2 text-sm text-red-300 bg-red-950/60 border border-red-400/20 rounded-full px-4 py-1.5 pointer-events-auto">
                <AlertCircle className="w-4 h-4" />
                {searchError}
              </p>
            ) : null}
          </div>

          {mapError ? (
            <div className="mt-1 min-h-6">
              <p className="inline-flex items-center gap-2 text-sm text-amber-200 bg-amber-950/60 border border-amber-500/25 rounded-full px-4 py-1.5 pointer-events-auto">
                <AlertCircle className="w-4 h-4" />
                {mapError}
              </p>
            </div>
          ) : null}

          <div className="mt-2 flex flex-col items-center gap-3 pointer-events-auto">
            {!hasToken ? (
              <p className="text-sm text-slate-300/80">
                Add <code className="gt-inline-code">NEXT_PUBLIC_MAPBOX_TOKEN</code> for live Mapbox rendering and search.
              </p>
            ) : (
              <p className="text-xs text-slate-400/80">Press Enter to search and open the 3D grid page.</p>
            )}
            <button
              type="button"
              className="gt-demo-button"
              onClick={() => router.push(toExploreUrl(DEMO_LOCATION))}
            >
              Launch Demo Grid Scene
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
