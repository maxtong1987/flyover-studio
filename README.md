# Flyover Studio — 3D TCX Route Videos for Instagram

A zero-npm-dependency web application that turns Garmin `.tcx` (and `.gpx`) activity files into cinematic 3D terrain flyover videos exported as Instagram-ready H.264 `.mp4` files.

## Features

- **TCX / GPX Import & Built-in Samples**: Drag-and-drop `.tcx` files or load included sample activities (Marin Headlands trail run, Alpe d'Huez climb, Central Park tempo).
- **Interactive 3D Terrain & Map Styles**: MapLibre GL JS 3D terrain with Satellite, Dark, Topo, and Light basemaps, configurable terrain exaggeration, and optional place/road labels.
- **MapDirector-Style Route Visuals**:
  - Continuous glowing head-to-tail comet track fade without dark edge artifacts.
  - Glow, hot filament, athlete beacon, and HUD charts dynamically match the chosen route color (solid themes or Pace / Elevation / Heart Rate heatmaps).
  - Configurable track smoothing and camera motion blur.
  - Configurable split labels (`km` / `mi`, interval, unit text toggle, label size, lead-ahead reveal timing, and smooth fade-in duration).
- **Broadcast Telemetry HUD**: Activity header, live distance/elevation/pace/HR/power cards, and optional Elevation, Speed/Pace, and Heart Rate profile charts.
- **Instagram MP4 Export**:
  - Presets for `9:16` Reels/Stories (`1080×1920`), `4:5` Feed Portrait (`1080×1350`), `1:1` Square (`1080×1080`), and `16:9` Landscape (`1920×1080`), plus a `Fast HD` 720p tier.
  - Pipelined server-side FFmpeg encoding (`libx264` `yuv420p` BT.709 + silent stereo AAC + `faststart`) with HTTP Range preview/download and browser WebCodecs fallback.

## Requirements

- **Node.js** 20+ (tested on Node 22)
- **FFmpeg** on `PATH` (for fast server-side H.264 MP4 encoding; falls back to browser WebCodecs if unavailable)

## Quick Start

```bash
npm start
```

Open http://localhost:3456 in your browser.

## Testing

```bash
npm test
```

## Project Structure

- `server.mjs` — Zero-dependency HTTP server for static assets and `/api/encode/*` MP4 streaming endpoints.
- `lib/encoder.mjs` — FFmpeg H.264/AAC encode job manager and binary frame-batch unpacking.
- `public/js/tcx-parser.mjs` — Namespace-agnostic TCX/GPX XML parser.
- `public/js/flyover-math.mjs` — Arc-length resampling, track smoothing, 3-act camera choreography, and telemetry formatters.
- `public/js/map-scene.mjs` — MapLibre GL 3D terrain scene controller and synchronous export frame rendering.
- `public/js/route-renderer.mjs` — 2D overlay renderer for glowing 3D route traces, anticipatory split markers, and athlete beacon.
- `public/js/hud-renderer.mjs` — Broadcast HUD overlays, telemetry charts, and safe-zone guides.
- `public/js/exporter.mjs` — Pipelined frame capture, OffscreenCanvas pool, and FFmpeg / WebCodecs export orchestration.
- `public/js/studio-state.mjs` & `public/js/dom-bindings.mjs` & `public/js/app.mjs` — Studio state, UI bindings, and application lifecycle.
- `test/flyover.test.mjs` — Node test suite covering parsing, math, rendering, encoding, and HTTP range streaming.
