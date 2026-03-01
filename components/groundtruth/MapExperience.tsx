"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, BarChart3, Layers3, Orbit, Sparkles } from "lucide-react";
import SearchBar from "@/components/groundtruth/SearchBar";
import { fetchFirstGeocodeResult, fetchGeocodingSuggestions } from "@/lib/groundtruth/geocode";
import { animateRiskLayers, drawRiskLayers, GT_LAYER_IDS } from "@/lib/groundtruth/map-layers";
import { buildRiskGrid } from "@/lib/groundtruth/risk-grid";
import { GeocodeSuggestion, LocationSelection, RiskGridData, SceneMode } from "@/lib/groundtruth/types";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const MAP_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";
const HERO_CENTER: [number, number] = [0, 20];
const HERO_ZOOM = 1.5;

const DEMO_LOCATION: LocationSelection = {
  label: "Downtown Atlanta, Georgia",
  coordinates: [-84.38798, 33.74876],
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function MapExperience() {
  const hasToken = MAPBOX_TOKEN.length > 0;

  const [scene, setScene] = useState<SceneMode>("hero");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection | null>(null);
  const [riskGrid, setRiskGrid] = useState<RiskGridData | null>(null);
  const showWireframeFallback = !hasToken || Boolean(mapError);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const gridSectionRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const riskAnimationStopRef = useRef<(() => void) | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const sceneRef = useRef<SceneMode>(scene);

  const applyHeroAtmosphere = useCallback((map: mapboxgl.Map) => {
    map.setProjection("globe");
    map.setFog({
      color: "#050c1f",
      "high-color": "#111b33",
      "space-color": "#02050e",
      "horizon-blend": 0.08,
      "star-intensity": 0.35,
    });
  }, []);

  const clearAtmosphere = useCallback((map: mapboxgl.Map) => {
    map.setFog(null);
  }, []);

  const runWhenStyleReady = useCallback((map: mapboxgl.Map, callback: () => void) => {
    if (map.isStyleLoaded()) {
      callback();
      return;
    }
    map.once("style.load", callback);
  }, []);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const stopRotation = useCallback(() => {
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const startRotation = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    stopRotation();
    lastFrameTimeRef.current = performance.now();

    const rotate = (timestamp: number) => {
      const activeMap = mapRef.current;
      if (!activeMap) return;
      if (sceneRef.current !== "hero") return;

      const dt = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      if (activeMap.getZoom() <= 2.7) {
        const center = activeMap.getCenter();
        center.lng -= dt * 0.0014;
        activeMap.jumpTo({ center });
      }

      animationFrameRef.current = requestAnimationFrame(rotate);
    };

    animationFrameRef.current = requestAnimationFrame(rotate);
  }, [stopRotation]);

  const focusGridScene = useCallback(
    (location: LocationSelection) => {
      const map = mapRef.current;
      const nextGrid = buildRiskGrid(location.coordinates);

      setSelectedLocation(location);
      setRiskGrid(nextGrid);
      setScene("grid");
      setSearchError(null);
      setMapError(null);

      if (map) {
        stopRotation();
        riskAnimationStopRef.current?.();
        riskAnimationStopRef.current = null;
        map.stop();

        if (markerRef.current) markerRef.current.remove();
        markerRef.current = new mapboxgl.Marker({ color: "#f59e0b", scale: 1.15 })
          .setLngLat(location.coordinates)
          .addTo(map);

        const enterGridMode = () => {
          if (sceneRef.current !== "grid") return;
          map.setProjection("mercator");
          clearAtmosphere(map);
          map.flyTo({
            center: location.coordinates,
            zoom: 14,
            pitch: 58,
            bearing: -36,
            offset: [0, 160],
            duration: 2500,
            essential: true,
            easing: (value) => 1 - Math.pow(1 - value, 3),
          });
          drawRiskLayers(map, nextGrid);
          riskAnimationStopRef.current = animateRiskLayers(map, nextGrid);
        };

        runWhenStyleReady(map, enterGridMode);
      }

      window.requestAnimationFrame(() => {
        gridSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [clearAtmosphere, runWhenStyleReady, stopRotation]
  );

  useEffect(() => {
    if (!hasToken || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_DARK,
      projection: "globe",
      center: HERO_CENTER,
      zoom: HERO_ZOOM,
      pitch: 0,
      bearing: 0,
      antialias: true,
      attributionControl: false,
    });

    map.on("style.load", () => {
      if (sceneRef.current === "hero") {
        applyHeroAtmosphere(map);
        return;
      }
      map.setProjection("mercator");
      clearAtmosphere(map);
    });

    map.on("load", () => {
      setMapError(null);
      if (sceneRef.current === "hero") {
        startRotation();
      }
    });

    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      if (!message) return;
      if (message.includes("401") || message.includes("403") || message.toLowerCase().includes("token")) {
        setMapError("Mapbox token rejected. Ensure public token scopes include Styles:Read and Geocoding:Read.");
        return;
      }
      setMapError(message);
    });

    map.on("mousemove", (event) => {
      if (sceneRef.current !== "grid") return;
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
      popupRef.current?.remove();
      markerRef.current?.remove();
      stopRotation();
      riskAnimationStopRef.current?.();
      riskAnimationStopRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [applyHeroAtmosphere, clearAtmosphere, hasToken, startRotation, stopRotation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (scene === "hero") {
      riskAnimationStopRef.current?.();
      riskAnimationStopRef.current = null;
      map.stop();
      runWhenStyleReady(map, () => {
        if (sceneRef.current !== "hero") return;
        applyHeroAtmosphere(map);
        map.easeTo({
          center: HERO_CENTER,
          zoom: HERO_ZOOM,
          pitch: 0,
          bearing: 0,
          duration: 1800,
        });
        startRotation();
      });
      return;
    }

    stopRotation();
    runWhenStyleReady(map, () => {
      if (sceneRef.current !== "grid") return;
      clearAtmosphere(map);
    });
  }, [applyHeroAtmosphere, clearAtmosphere, runWhenStyleReady, scene, startRotation, stopRotation]);

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
    setQuery(suggestion.label);
    setSuggestions([]);
    focusGridScene({
      label: suggestion.label,
      coordinates: suggestion.coordinates,
    });
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
      const firstResult = await fetchFirstGeocodeResult(query, MAPBOX_TOKEN);
      if (!firstResult) {
        setSearchError("No location results found for this query.");
        return;
      }

      handleSuggestionSelect(firstResult);
    } catch {
      setSearchError("Search failed. Check token scope and retry.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleDemoScene = () => {
    setQuery(DEMO_LOCATION.label);
    setSuggestions([]);
    focusGridScene(DEMO_LOCATION);
  };

  const summaryRows = useMemo(() => {
    if (!riskGrid) return [];

    return [
      { label: "Average risk", value: formatPercent(riskGrid.summary.averageRisk) },
      { label: "Highest risk", value: formatPercent(riskGrid.summary.highestRisk) },
      { label: "Low / Moderate / High", value: `${riskGrid.summary.lowCount} / ${riskGrid.summary.moderateCount} / ${riskGrid.summary.highCount}` },
    ];
  }, [riskGrid]);

  return (
    <div className="relative min-h-[215vh] bg-background text-foreground overflow-x-clip">
      <div className="fixed inset-0">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {showWireframeFallback ? <div className="gt-tokenless-backdrop" /> : null}
        {showWireframeFallback && scene === "grid" ? (
          <div className="gt-wireframe-scene" aria-hidden>
            <div className="gt-wireframe-plane" />
            <div className="gt-wireframe-platform" />
            <span className="gt-wire-bar gt-wire-bar-1" />
            <span className="gt-wire-bar gt-wire-bar-2" />
            <span className="gt-wire-bar gt-wire-bar-3" />
            <span className="gt-wire-bar gt-wire-bar-4" />
            <span className="gt-wire-bar gt-wire-bar-5" />
            <span className="gt-wire-bar gt-wire-bar-6" />
            <span className="gt-wire-bar gt-wire-bar-7" />
            <span className="gt-wire-bar gt-wire-bar-8" />
          </div>
        ) : null}
        <div className={`gt-hero-overlay ${scene === "grid" ? "opacity-0" : "opacity-100"}`} />
        <div className={`gt-grid-overlay ${scene === "grid" ? "opacity-100" : "opacity-0"}`} />
      </div>

      <header className="fixed top-0 left-0 right-0 z-40 px-5 md:px-8 pt-5">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="gt-brand-shell">
            <Orbit className="w-4 h-4 text-amber-300" />
            <span className="text-sm md:text-base font-semibold tracking-[0.03em]">Ground Truth</span>
          </div>
          <span className="hidden sm:inline-flex gt-tag">Mapbox UI Prototype</span>
        </div>
      </header>

      <section className="relative z-10 h-screen flex items-center justify-center px-6 pointer-events-none">
        <div
          className={`w-full max-w-4xl text-center transition-all duration-700 ${
            scene === "hero" ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-8"
          }`}
        >
          <p className="gt-kicker mb-5">Spatial Safety Intelligence</p>
          <h1 className="text-5xl md:text-7xl font-black leading-[0.94] tracking-tight mb-5 text-slate-100">
            Know Before You Go
          </h1>
          <p className="text-base md:text-lg text-slate-300/90 max-w-2xl mx-auto mb-10">
            Dark-mode map experience with live location search and a cinematic transition into your grid-based risk scene.
          </p>

          <SearchBar
            query={query}
            loading={isSearching}
            disabled={scene !== "hero"}
            suggestions={suggestions}
            onQueryChange={(value) => {
              setQuery(value);
              setSearchError(null);
            }}
            onSubmit={handleSearchSubmit}
            onSuggestionSelect={handleSuggestionSelect}
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
              <p className="text-xs text-slate-400/80">
                Press Enter to search and transition into the lower grid scene.
              </p>
            )}
            <button type="button" className="gt-demo-button" onClick={handleDemoScene}>
              Launch Demo Grid Scene
            </button>
          </div>
        </div>
      </section>

      <section ref={gridSectionRef} className="relative z-10 min-h-screen px-6 pb-16 pointer-events-none">
        <div className="mx-auto max-w-6xl pt-20 md:pt-24 lg:pt-28">
          <div
            className={`grid lg:grid-cols-[1.25fr_0.75fr] gap-5 transition-all duration-700 ${
              scene === "grid" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <article className="gt-panel pointer-events-auto">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <p className="gt-kicker mb-2">Grid Data Viz</p>
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-100">
                    {selectedLocation?.label ?? "Search for a location"}
                  </h2>
                  <p className="text-sm text-slate-300/85 mt-2 max-w-xl">
                    Deterministic mock risk bars rendered as Mapbox 3D extrusions over a wireframe-style grid.
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

            <aside className="gt-panel pointer-events-auto">
              <h3 className="text-lg font-semibold text-slate-100 mb-4">Scene Notes</h3>
              <ul className="space-y-3 text-sm text-slate-300/90">
                <li className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 mt-0.5 text-cyan-300" />
                  <span>Hero uses a rotating globe and fades into data mode on search.</span>
                </li>
                <li className="flex items-start gap-2">
                  <BarChart3 className="w-4 h-4 mt-0.5 text-amber-300" />
                  <span>Grid cells are seeded from coordinates so each place keeps a stable signature.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Layers3 className="w-4 h-4 mt-0.5 text-indigo-300" />
                  <span>Hover bars to inspect risk index and extrusion height.</span>
                </li>
              </ul>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
