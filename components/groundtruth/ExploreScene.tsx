"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import type { SearchBoxRetrieveResponse } from "@mapbox/search-js-core";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, ChevronLeft, Layers3 } from "lucide-react";
import MapLoadingOverlay from "@/components/groundtruth/MapLoadingOverlay";
import { hasMapboxToken, MAPBOX_TOKEN, MAP_STYLE_GRID } from "@/lib/groundtruth/config";
import { DEMO_LOCATION, parseLocationFromSearchParams, toExploreUrl } from "@/lib/groundtruth/location";
import { animateRiskLayers, drawRiskLayers, GT_LAYER_IDS } from "@/lib/groundtruth/map-layers";
import { buildRiskGrid } from "@/lib/groundtruth/risk-grid";
import { toLocationFromSearchBoxRetrieve } from "@/lib/groundtruth/searchbox";
import { LocationSelection, RiskGridData } from "@/lib/groundtruth/types";

const SEARCH_TYPES = "country,region,postcode,district,place,locality,neighborhood,street,address";
const SearchBox = dynamic(() => import("@mapbox/search-js-react").then((mod) => mod.SearchBox), { ssr: false });
const GLOBE_START_CENTER: [number, number] = [0, 20];
const GLOBE_START_ZOOM = 1.5;

type CameraMode = "initial" | "fly";

function getGridCameraOffset(map: mapboxgl.Map): [number, number] {
  const width = map.getContainer().clientWidth;
  if (width < 900) {
    return [0, 132];
  }

  // Keep the 3D grid out from under the left-side panel.
  return [Math.round(Math.min(420, width * 0.3)), 96];
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
    () => parseLocationFromSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isLocationAnimating, setIsLocationAnimating] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection>(urlLocation);
  const [riskGrid, setRiskGrid] = useState<RiskGridData>(() => buildRiskGrid(urlLocation.coordinates));

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapLoadedRef = useRef(false);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const stopRiskAnimationRef = useRef<(() => void) | null>(null);
  const locationAnimationTimeoutRef = useRef<number | null>(null);
  const loadTimeoutRef = useRef<number | null>(null);
  const selectedLocationRef = useRef<LocationSelection>(selectedLocation);

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
  }, [selectedLocation]);

  const applyLocation = useCallback(
    (location: LocationSelection, syncUrl: boolean, cameraMode: CameraMode = "fly") => {
      const nextGrid = buildRiskGrid(location.coordinates);
      const map = mapRef.current;

      setSelectedLocation(location);
      setRiskGrid(nextGrid);
      setSearchError(null);
      setMapError(null);

      if (syncUrl) {
        router.replace(toExploreUrl(location), { scroll: false });
      }

      if (!map || !mapLoadedRef.current) return;

      if (locationAnimationTimeoutRef.current !== null) {
        window.clearTimeout(locationAnimationTimeoutRef.current);
        locationAnimationTimeoutRef.current = null;
      }

      setIsLocationAnimating(true);
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
        const offset = getGridCameraOffset(map);

        if (cameraMode === "initial") {
          map.easeTo({
            center: location.coordinates,
            zoom: 14,
            pitch: 58,
            bearing: -36,
            offset,
            duration: 0,
            essential: true,
          });
          requestAnimationFrame(() => setIsLocationAnimating(false));
          return;
        }

        const finishAnimation = () => {
          setIsLocationAnimating(false);
          if (locationAnimationTimeoutRef.current !== null) {
            window.clearTimeout(locationAnimationTimeoutRef.current);
            locationAnimationTimeoutRef.current = null;
          }
          map.off("moveend", finishAnimation);
        };

        map.on("moveend", finishAnimation);
        locationAnimationTimeoutRef.current = window.setTimeout(finishAnimation, 3000);

        map.flyTo({
          center: location.coordinates,
          zoom: 14,
          pitch: 58,
          bearing: -36,
          offset,
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

  const handleRetrieve = useCallback(
    (result: SearchBoxRetrieveResponse) => {
      const location = toLocationFromSearchBoxRetrieve(result);
      if (!location) {
        setSearchError("No location results found for this query.");
        return;
      }

      applyLocation(location, true, "fly");
    },
    [applyLocation]
  );

  useEffect(() => {
    if (!hasToken || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      accessToken: MAPBOX_TOKEN,
      container: mapContainerRef.current,
      style: MAP_STYLE_GRID,
      projection: "globe",
      center: GLOBE_START_CENTER,
      zoom: GLOBE_START_ZOOM,
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
      mapLoadedRef.current = true;
      setIsMapReady(true);
      setMapError(null);
      applyLocation(selectedLocationRef.current, false, "fly");
    });

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
    loadTimeoutRef.current = window.setTimeout(() => {
      setMapError("Map rendering timed out. Check WebGL support or blocked Mapbox requests.");
    }, 15000);

    return () => {
      stopRiskAnimationRef.current?.();
      stopRiskAnimationRef.current = null;
      popupRef.current?.remove();
      markerRef.current?.remove();
      mapLoadedRef.current = false;
      if (locationAnimationTimeoutRef.current !== null) {
        window.clearTimeout(locationAnimationTimeoutRef.current);
        locationAnimationTimeoutRef.current = null;
      }
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [applyLocation, hasToken]);

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
        <MapLoadingOverlay
          visible={hasToken && !mapError && (!isMapReady || isLocationAnimating)}
          label={!isMapReady ? "Loading map scene..." : "Rendering 3D risk grid..."}
        />
        <div className="gt-grid-overlay opacity-35" />
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

              <div className="gt-searchbox-wrap">
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
                    onClick={() => applyLocation(DEMO_LOCATION, true, "fly")}
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
