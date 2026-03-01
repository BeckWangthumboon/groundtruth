"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { SearchBoxRetrieveResponse } from "@mapbox/search-js-core";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, Orbit } from "lucide-react";
import MapLoadingOverlay from "@/components/groundtruth/MapLoadingOverlay";
import { hasMapboxToken, MAPBOX_TOKEN, MAP_STYLE_HERO } from "@/lib/groundtruth/config";
import { DEMO_LOCATION, toExploreUrl } from "@/lib/groundtruth/location";
import { toLocationFromSearchBoxRetrieve } from "@/lib/groundtruth/searchbox";
import { LocationSelection } from "@/lib/groundtruth/types";

const HERO_CENTER: [number, number] = [0, 20];
const HERO_ZOOM = 0.85;
const SEARCH_TYPES = "country,region,postcode,district,place,locality,neighborhood,street,address";
const SearchBox = dynamic(() => import("@mapbox/search-js-react").then((mod) => mod.SearchBox), { ssr: false });

function isAuthError(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("401") || lowered.includes("403") || lowered.includes("token") || lowered.includes("unauthorized");
}

export default function LandingHero() {
  const router = useRouter();
  const hasToken = hasMapboxToken();

  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const loadTimeoutRef = useRef<number | null>(null);

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

  const transitionToExplore = useCallback(
    (location: LocationSelection) => {
      if (isTransitioning) return;

      setIsTransitioning(true);
      setSearchError(null);
      stopRotation();
      mapRef.current?.stop();
      router.push(toExploreUrl(location));
    },
    [isTransitioning, router, stopRotation]
  );

  const handleRetrieve = useCallback(
    (result: SearchBoxRetrieveResponse) => {
      const location = toLocationFromSearchBoxRetrieve(result);
      if (!location) {
        setSearchError("No location results found for this query.");
        return;
      }

      transitionToExplore(location);
    },
    [transitionToExplore]
  );

  useEffect(() => {
    if (!hasToken || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      accessToken: MAPBOX_TOKEN,
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
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      setIsMapReady(true);
      setMapError(null);
      startRotation();
    });

    map.on("mousedown", stopRotation);
    map.on("touchstart", stopRotation);

    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      if (!message) return;
      if (isAuthError(message)) {
        setIsMapReady(false);
        setMapError("Mapbox token rejected. Confirm public token scopes include Styles:Read and Geocoding:Read.");
        return;
      }
      setIsMapReady(false);
      setMapError(`Map render error: ${message.slice(0, 140)}`);
    });

    mapRef.current = map;
    loadTimeoutRef.current = window.setTimeout(() => {
      setMapError("Map rendering timed out. Check WebGL support or blocked Mapbox requests.");
    }, 15000);

    return () => {
      stopRotation();
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [hasToken, startRotation, stopRotation]);

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      <div className="fixed inset-0">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {!hasToken || mapError ? <div className="gt-tokenless-backdrop" /> : null}
        <MapLoadingOverlay
          visible={hasToken && !mapError && (!isMapReady || isTransitioning)}
          label={isTransitioning ? "Opening map experience..." : "Loading interactive globe..."}
        />
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

          <div className="w-full max-w-2xl mx-auto pointer-events-auto gt-searchbox-wrap">
            {hasToken ? (
              <SearchBox
                accessToken={MAPBOX_TOKEN}
                placeholder="Search a city, address, or place..."
                options={{
                  language: "en",
                  limit: 6,
                  types: SEARCH_TYPES,
                }}
                onChange={() => {
                  setSearchError(null);
                }}
                onSuggestError={() => {
                  setSearchError("Search failed. Check token scope and retry.");
                }}
                onRetrieve={handleRetrieve}
                interceptSearch={(value) => value.trim()}
              />
            ) : null}
          </div>

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
            ) : isTransitioning ? (
              <p className="text-xs text-slate-300/85">Transitioning to map view...</p>
            ) : (
              <p className="text-xs text-slate-400/80">Pick a search result to fly into the map.</p>
            )}
            <button
              type="button"
              className="gt-demo-button"
              onClick={() => transitionToExplore(DEMO_LOCATION)}
              disabled={isTransitioning}
            >
              Launch Demo Grid Scene
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
