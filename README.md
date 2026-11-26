# Flyover Studio — 3D TCX Route Videos for Instagram

A web application and headless CLI that turns Garmin `.tcx` (and `.gpx`) activity files into cinematic 3D terrain flyover videos exported as Instagram-ready H.264 `.mp4` files.

## Features

- **TCX / GPX Import & Built-in Samples**: Drag-and-drop `.tcx` files or load included sample activities (Marin Headlands trail run, Alpe d'Huez climb, Central Park tempo).
- **Interactive 3D Terrain & Map Styles**: MapLibre GL JS 3D terrain with Satellite, Dark, Topo, and Light basemaps, configurable terrain exaggeration, and optional place/road labels.
- **MapDirector-Style Route Visuals**:
  - Continuous glowing head-to-tail comet track fade without dark edge artifacts.
  - Glow, hot filament, athlete beacon, and HUD charts dynamically match the chosen route color (solid themes or Pace / Elevation / Heart Rate heatmaps).
  - Pace-matched track head speed (`Match Activity Pace` default or `Constant Speed`), configurable track smoothing, and camera motion blur.
  - Configurable split labels (`km` / `mi`, interval, unit text toggle, label size, lead-ahead reveal timing, and smooth fade-in duration).
- **Broadcast Telemetry HUD**: Activity header, live distance/elevation/pace/HR/power cards, and optional Elevation, Speed/Pace, and Heart Rate profile charts.
- **Instagram MP4 Export**:
  - Presets for `9:16` Reels/Stories (`1080×1920`), `4:5` Feed Portrait (`1080×1350`), `1:1` Square (`1080×1080`), and `16:9` Landscape (`1920×1080`), plus a `Fast HD` 720p tier.
  - Pipelined server-side FFmpeg encoding (`libx264` `yuv420p` BT.709 + silent stereo AAC + `faststart`) with HTTP Range preview/download and browser WebCodecs fallback.
- **Headless CLI (`cli.mjs`) & Container (`Dockerfile`)**: Render `.tcx + config.json → .mp4` from the terminal or inside Podman/Docker using the exact same rendering pipeline.

## Requirements

- **Node.js** 20+ (tested on Node 22)
- **FFmpeg** on `PATH` (for fast server-side H.264 MP4 encoding; web app falls back to browser WebCodecs if unavailable)

## Quick Start (Web App)

### Option A: Local Node.js (zero runtime dependencies)

```bash
npm start
```

Open http://localhost:3456 in your browser.

### Option B: Docker / Podman Web App (lightweight Node 22 + FFmpeg image)

Build and run the dedicated `web` target (no Chromium/Playwright overhead):

```bash
podman build --target web -t flyover-studio-web .
podman run --rm -p 3456:3456 flyover-studio-web
# or with Docker:
# docker build --target web -t flyover-studio-web .
# docker run --rm -p 3456:3456 flyover-studio-web
```

Or using Compose (`compose.yaml`):

```bash
docker compose up --build
# or: podman compose up --build
```

Open http://localhost:3456 in your browser (override the port with `PORT=8080 docker compose up`).

## Headless CLI (`tcx + config → mp4`)

### Option A: Project-Local Setup (venv-style, no global installs)

Installs Playwright into `./node_modules/` and Chromium into `./.playwright-browsers/` inside the repo folder only:

```bash
npm run cli:setup
```

Generate a starter JSON config with all default studio settings:

```bash
node cli.mjs --init-config flyover.config.json
```

Render a video from a `.tcx` file and config (with optional CLI flag overrides):

```bash
node cli.mjs public/samples/marin-headlands-trail-run.tcx \
  --config flyover.config.json \
  --out marin-reel.mp4

# Quick flag-only example (720p fast preview, 15s, Neon Cyan)
node cli.mjs public/samples/alpe-dhuez-climb.tcx \
  --quality fast --duration 15 --color cyan --out alpe.mp4
```

Run `node cli.mjs --help` for the full list of flags.

### Option B: Containerized CLI (Podman / Docker — zero host installs)

Build the `cli` target once:

```bash
podman build --target cli -t flyover-studio-cli .
# or: docker build --target cli -t flyover-studio-cli .
```

Render a video by mounting your working directory to `/work`:

```bash
podman run --rm -v "$PWD:/work:Z" flyover-studio-cli \
  /work/activity.tcx --config /work/flyover.config.json --out /work/reel.mp4

# Or via Compose:
docker compose run --rm cli /work/activity.tcx --config /work/flyover.config.json --out /work/reel.mp4
```

*(On Linux with an Intel/AMD GPU, you can optionally pass `--device /dev/dri` for hardware-accelerated WebGL; otherwise Chromium automatically falls back to SwiftShader software WebGL.)*

## Testing

```bash
npm test
```

## Project Structure

- `server.mjs` — Zero-dependency HTTP server for static assets and `/api/encode/*` MP4 streaming endpoints.
- `cli.mjs` & `lib/cli-config.mjs` — Headless CLI runner, config loader, and flag validator.
- `Dockerfile`, `compose.yaml`, & `.dockerignore` — Multi-target container setup (`web` lightweight Node + FFmpeg image, `cli` Playwright Chromium + FFmpeg image).
- `lib/encoder.mjs` — FFmpeg H.264/AAC encode job manager and binary frame-batch unpacking.
- `public/render.html` & `public/js/headless-runner.mjs` — Minimal headless rendering entrypoint driving the shared web pipeline.
- `public/js/tcx-parser.mjs` — Namespace-agnostic TCX/GPX XML parser.
- `public/js/flyover-math.mjs` — Arc-length resampling, track smoothing, 3-act camera choreography, and telemetry formatters.
- `public/js/map-scene.mjs` — MapLibre GL 3D terrain scene controller and synchronous export frame rendering.
- `public/js/route-renderer.mjs` — 2D overlay renderer for glowing 3D route traces, anticipatory split markers, and athlete beacon.
- `public/js/hud-renderer.mjs` — Broadcast HUD overlays, telemetry charts, and safe-zone guides.
- `public/js/exporter.mjs` — Pipelined frame capture, OffscreenCanvas pool, and FFmpeg / WebCodecs export orchestration.
- `public/js/studio-state.mjs`, `public/js/dom-bindings.mjs`, `public/js/app.mjs` — Studio state, UI bindings, and application lifecycle.
- `test/flyover.test.mjs` — Node test suite covering parsing, math, rendering, encoding, HTTP range streaming, and CLI config resolution.
