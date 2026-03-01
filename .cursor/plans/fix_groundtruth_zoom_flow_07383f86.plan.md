---
name: Fix groundtruth zoom flow
overview: "The zoom after address search in groundtruth is broken due to three compounding issues: the map is non-interactive, a camera-sync listener fights the flyTo animation mid-flight, and the globe spin uses `easeTo` which queues conflicting animations. The lumos.ai reference handles all of these cleanly."
todos:
  - id: replace-spin
    content: Replace easeTo globe spin with requestAnimationFrame + jumpTo pattern from lumos.ai
    status: completed
  - id: enable-interactive
    content: "Set interactive: true on map, remove dragRotate: false"
    status: completed
  - id: remove-camera-sync
    content: Remove syncCameraToZoom listener and zoomstart/zoomend interaction handlers
    status: completed
  - id: simplify-flyto
    content: "Simplify flyToSearchFeature: explicit pause, fixed duration+easing, fixed pitch/bearing"
    status: completed
  - id: cleanup-refs
    content: Remove spinTimerRef, interactionResumeRef, userInteractingRef; use module-level rotation flag
    status: completed
isProject: false
---

# Fix Broken Zoom After Address Search

## Root Cause Analysis

There are three issues in `[src/App.jsx](src/App.jsx)` that compound to break the zoom:

### Issue 1: `interactive: false` (line 192)

```javascript
const map = new mapboxgl.Map({
  // ...
  interactive: false,   // blocks ALL user interaction
  dragRotate: false,
});
```

The map is created with `interactive: false`, so after `flyTo` completes the user is stuck -- no zoom, no pan, no tilt. Lumos.ai creates its map with `interactive: true` (GlobeView.tsx line 97).

### Issue 2: `syncCameraToZoom` fights the flyTo animation (lines 199-205, 258)

```javascript
const syncCameraToZoom = () => {
  const zoom = map.getZoom()
  const targetCamera = getCinematicCameraForZoom(zoom)
  map.setPitch(lerp(map.getPitch(), targetCamera.pitch, 0.22))
  map.setBearing(lerp(map.getBearing(), targetCamera.bearing, 0.22))
}
// ...
map.on('zoom', syncCameraToZoom)
```

During a `flyTo` from zoom 1.65 to zoom 17.2, the map fires `zoom` events at every intermediate level. Each time, `syncCameraToZoom` calls `setPitch`/`setBearing` with values computed for the *current intermediate zoom*, fighting the flyTo's own target pitch/bearing. This tug-of-war produces erratic jerking. Lumos.ai has no such listener -- pitch and bearing are set once inside `flyTo` and left alone.

### Issue 3: Globe spin uses `map.easeTo()` (lines 163-167)

```javascript
map.easeTo({
  center: currentCenter,
  duration: 1000,
  easing: (t) => t,
})
```

`easeTo` queues an actual map animation, which can conflict with `flyTo`. The `moveend` handler (line 256) re-queues the spin, so a spin animation can start overlapping the fly animation. Lumos.ai avoids this entirely by using `requestAnimationFrame` + `map.jumpTo()` for rotation, which is instant and never conflicts.

## Key Differences Summary


| Aspect                   | groundtruth (broken)                                      | lumos.ai (working)                                              |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------- |
| Map interactivity        | `interactive: false`                                      | `interactive: true`                                             |
| Camera sync during flyTo | `syncCameraToZoom` on every `zoom` event fights animation | No camera sync listener -- flyTo controls pitch/bearing         |
| Globe rotation method    | `map.easeTo()` with `duration: 1000` (queues animation)   | `requestAnimationFrame` + `map.jumpTo()` (instant, no conflict) |
| Rotation pause           | Timer-based `userInteractingRef` flag + `clearTimeout`    | Module-level `_rotationPaused = true` before `map.stop()`       |
| flyTo parameters         | `speed: 0.72, curve: 1.35` (slow, variable duration)      | `duration: 2800` with explicit ease-out cubic easing            |
| Zoom level               | Feature-type-dependent (up to 17.2)                       | Fixed `14`                                                      |


## Changes to Make in `src/App.jsx`

### 1. Enable map interactivity

Change `interactive: false` to `interactive: true` and remove `dragRotate: false`. Optionally add `attributionControl: false` as lumos.ai does.

### 2. Replace `easeTo`-based globe spin with `requestAnimationFrame` + `jumpTo`

Adopt the lumos.ai pattern: module-level `_rotationPaused` flag, a `requestAnimationFrame` loop calling `map.jumpTo()`, and explicit `pauseGlobeRotation` / `resumeGlobeRotation` helpers. Remove the `spinGlobe` callback that uses `easeTo`, the `spinTimerRef`, the `queueSpin` function, and the `moveend` -> `queueSpin` listener.

### 3. Remove `syncCameraToZoom` listener from the `zoom` event

Delete the `syncCameraToZoom` function and its registration on `map.on('zoom', ...)`. Also remove the `zoomstart` / `zoomend` interaction listeners since rotation pause is now handled explicitly. The pitch and bearing should be set once in the `flyTo` call and not overridden during animation.

### 4. Simplify `flyToSearchFeature` to match lumos.ai's `flyToLocation` pattern

- Explicitly pause rotation before calling `map.stop()`
- Use a fixed `duration` with an ease-out cubic easing function instead of `speed`/`curve`
- Keep the feature-type zoom levels if desired (they're a nice touch), but use a fixed pitch/bearing (e.g., `pitch: 50, bearing: -20`) rather than computing them dynamically
- Resume rotation after the fly completes via a `moveend` listener (only when zoom is low enough)

### 5. Clean up timer refs

Remove `spinTimerRef` and `interactionResumeRef` since the new rotation approach doesn't need them. The `userInteractingRef` can be replaced by the module-level `_rotationPaused` flag.