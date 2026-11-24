import { clamp } from './flyover-math.mjs';

const BASEMAP_CATALOG = Object.freeze({
  dark: {
    primary: {
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      maxzoom: 18,
      bg: '#090d14'
    },
    fallback: {
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 16,
      bg: '#090d14'
    }
  },
  topo: {
    primary: {
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 18,
      bg: '#161f2c'
    },
    fallback: {
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      maxzoom: 17,
      bg: '#161f2c'
    }
  },
  light: {
    primary: {
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      maxzoom: 18,
      bg: '#dfe4ea'
    },
    fallback: {
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      bg: '#dfe4ea'
    }
  },
  satellite: {
    primary: {
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 18,
      bg: '#0b1021'
    },
    fallback: {
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      bg: '#0b1021'
    }
  }
});

export function getBasemapTiles(mapStyle, useFallback = false) {
  const entry = BASEMAP_CATALOG[mapStyle] || BASEMAP_CATALOG.satellite;
  return useFallback ? entry.fallback : entry.primary;
}

function getDemSourceConfig(demProvider) {
  if (demProvider === 'aws') {
    return {
      type: 'raster-dem',
      tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 14,
      encoding: 'terrarium'
    };
  }
  if (demProvider === 'mapterhorn') {
    return {
      type: 'raster-dem',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      tileSize: 512,
      maxzoom: 12,
      encoding: 'terrarium'
    };
  }
  return null;
}

/**
 * Builds a pure raster + 3D terrain MapLibre style with zero dynamic GeoJSON sources
 * so animation never triggers worker reloads or RenderToTexture cache invalidations.
 */
export function buildStyleObject({
  mapStyle,
  showLabels,
  exaggeration,
  demProvider = 'mapterhorn',
  useBasemapFallback = false
}) {
  const basemap = getBasemapTiles(mapStyle, useBasemapFallback);
  const demSource = getDemSourceConfig(demProvider);
  const includeHillshade = Boolean(demSource && (mapStyle === 'dark' || mapStyle === 'light'));

  const sources = {
    basemap: {
      type: 'raster',
      tiles: basemap.tiles,
      tileSize: basemap.tileSize,
      maxzoom: basemap.maxzoom
    },
    'basemap-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 18
    }
  };

  if (demSource) {
    sources['terrain-dem'] = demSource;
  }

  const layers = [
    {
      id: 'background-fill',
      type: 'background',
      paint: { 'background-color': basemap.bg }
    },
    {
      id: 'basemap-layer',
      type: 'raster',
      source: 'basemap',
      paint: { 'raster-fade-duration': 200 }
    },
    ...(includeHillshade
      ? [
          {
            id: 'terrain-hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-exaggeration': 0.25,
              'hillshade-shadow-color': '#050811',
              'hillshade-highlight-color': '#ffffff'
            }
          }
        ]
      : []),
    {
      id: 'basemap-labels-layer',
      type: 'raster',
      source: 'basemap-labels',
      layout: { visibility: showLabels && mapStyle === 'satellite' ? 'visible' : 'none' },
      paint: { 'raster-fade-duration': 200, 'raster-opacity': 0.9 }
    }
  ];

  const style = {
    version: 8,
    sources,
    sky: {
      'sky-color': mapStyle === 'light' ? '#9bc2e6' : '#10192e',
      'sky-horizon-blend': 0.55,
      'horizon-color': mapStyle === 'light' ? '#dce9f7' : '#2a3d5f',
      'horizon-fog-blend': 0.8,
      'fog-color': mapStyle === 'light' ? '#d4e2f0' : '#141e33',
      'fog-ground-blend': 0.45
    },
    layers
  };

  if (demSource) {
    style.terrain = {
      source: 'terrain-dem',
      exaggeration: clamp(Number(exaggeration ?? 1.4), 0, 2.5)
    };
  }

  return style;
}

/**
 * Checks whether a 3D geographic coordinate lies in front of the tilted camera near plane.
 */
export function isPointInFrontOfCamera(
  lon,
  lat,
  eleM,
  camera,
  centerEleM = 0,
  stageHeight = 1080,
  exaggeration = 1.4
) {
  if (!camera || !Array.isArray(camera.center)) return false;
  const latRad = (camera.center[1] * Math.PI) / 180;
  const metersPerPx = (40075016.686 * Math.cos(latRad)) / (512 * Math.pow(2, camera.zoom));
  const camDistM = 1.5 * stageHeight * metersPerPx;
  const bearingRad = (camera.bearing * Math.PI) / 180;
  const pitchRad = (clamp(camera.pitch ?? 0, 0, 85) * Math.PI) / 180;

  const dEast = (lon - camera.center[0]) * Math.cos(latRad) * 111320;
  const dNorth = (lat - camera.center[1]) * 111320;
  const dUp = ((eleM ?? centerEleM) - centerEleM) * exaggeration;

  const alongFwd = dEast * Math.sin(bearingRad) + dNorth * Math.cos(bearingRad);
  const depthFromEye = alongFwd * Math.sin(pitchRad) - dUp * Math.cos(pitchRad) + camDistM;

  return depthFromEye > 0.18 * camDistM;
}

export class FlyoverMapScene {
  constructor(containerEl, initialSettings = {}) {
    if (!window.maplibregl) {
      throw new Error('MapLibre GL JS failed to load');
    }

    this.containerEl = containerEl;
    this.mapStyle = initialSettings.mapStyle || 'satellite';
    this.showLabels = Boolean(initialSettings.showLabels ?? true);
    this.exaggeration = Number(initialSettings.exaggeration ?? 1.4);
    this.demProvider = 'mapterhorn';
    this.useBasemapFallback = false;
    this.demLoadedOnce = false;
    this.basemapLoadedOnce = false;
    this.demErrorCount = 0;
    this.basemapErrorCount = 0;
    this._isReloadingStyle = false;
    this.isReady = false;
    this.isExportMode = false;
    this.styleVersion = 0;
    this.onRender = null;

    this.map = new window.maplibregl.Map({
      container: containerEl,
      style: buildStyleObject({
        mapStyle: this.mapStyle,
        showLabels: this.showLabels,
        exaggeration: this.exaggeration,
        demProvider: this.demProvider,
        useBasemapFallback: this.useBasemapFallback
      }),
      center: [-122.499, 37.827],
      zoom: 12,
      pitch: 54,
      bearing: 0,
      maxPitch: 60,
      maxTileCacheSize: 600,
      maxTileCacheZoomLevels: 6,
      pixelRatio: 1,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        antialias: true
      }
    });

    this.readyPromise = new Promise((resolve) => {
      this.map.once('load', () => {
        this.isReady = true;
        resolve();
      });
    });

    this.map.on('render', () => {
      if (this.onRender) this.onRender();
    });

    this.map.on('sourcedata', (e) => {
      if (e.sourceId === 'terrain-dem' && e.tile) {
        this.demLoadedOnce = true;
      }
      if (e.sourceId === 'basemap' && e.tile) {
        this.basemapLoadedOnce = true;
      }
    });

    this.map.on('error', (e) => {
      if (this._isReloadingStyle) return;
      if (e.sourceId === 'terrain-dem' && !this.demLoadedOnce) {
        this.demErrorCount += 1;
        if (this.demErrorCount >= 3) {
          this.demErrorCount = 0;
          if (this.demProvider === 'mapterhorn') {
            this.demProvider = 'aws';
            this._reloadCurrentStyle();
          } else if (this.demProvider === 'aws') {
            this.demProvider = 'none';
            this._reloadCurrentStyle();
          }
        }
      } else if (e.sourceId === 'basemap' && !this.basemapLoadedOnce && !this.useBasemapFallback) {
        this.basemapErrorCount += 1;
        if (this.basemapErrorCount >= 4) {
          this.basemapErrorCount = 0;
          this.useBasemapFallback = true;
          this._reloadCurrentStyle();
        }
      }
    });

    this.lastTimeline = null;
    this.lastFrameState = null;
    this.lastSettings = initialSettings;
  }

  setRenderListener(fn) {
    this.onRender = typeof fn === 'function' ? fn : null;
  }

  async _reloadCurrentStyle() {
    this._isReloadingStyle = true;
    this.styleVersion += 1;
    const version = this.styleVersion;
    try {
      await new Promise((resolve) => {
        this.map.once('style.load', () => resolve());
        this.map.setStyle(
          buildStyleObject({
            mapStyle: this.mapStyle,
            showLabels: this.showLabels,
            exaggeration: this.exaggeration,
            demProvider: this.demProvider,
            useBasemapFallback: this.useBasemapFallback
          })
        );
      });
      if (version === this.styleVersion && this.isExportMode) {
        this.setExportMode(true);
      }
      if (version === this.styleVersion && this.lastTimeline && this.lastFrameState) {
        this.applyFrame(this.lastFrameState, this.lastTimeline, this.lastSettings);
      }
    } finally {
      if (version === this.styleVersion) {
        this._isReloadingStyle = false;
      }
    }
  }

  async waitUntilLoaded() {
    await this.readyPromise;
  }

  getCanvas() {
    return this.map.getCanvas();
  }

  resizeStage(width, height) {
    this.containerEl.style.width = `${width}px`;
    this.containerEl.style.height = `${height}px`;
    this.map.resize();
  }

  async updateMapStyle({ mapStyle, showLabels, exaggeration }) {
    await this.waitUntilLoaded();

    const styleChanged = mapStyle && mapStyle !== this.mapStyle;
    if (mapStyle) this.mapStyle = mapStyle;
    if (showLabels !== undefined) this.showLabels = Boolean(showLabels);
    if (exaggeration !== undefined) this.exaggeration = clamp(Number(exaggeration), 0, 2.5);

    if (styleChanged) {
      this.useBasemapFallback = false;
      this.basemapLoadedOnce = false;
      this.basemapErrorCount = 0;
      await this._reloadCurrentStyle();
      return;
    }

    if (this.map.getLayer('basemap-labels-layer')) {
      this.map.setLayoutProperty(
        'basemap-labels-layer',
        'visibility',
        this.showLabels && this.mapStyle === 'satellite' ? 'visible' : 'none'
      );
    }
    if (this.demProvider !== 'none' && this.map.getSource('terrain-dem')) {
      this.map.setTerrain({
        source: 'terrain-dem',
        exaggeration: this.exaggeration
      });
    }
  }

  applyFrame(frameState, timeline, settings) {
    this.lastTimeline = timeline;
    this.lastFrameState = frameState;
    this.lastSettings = settings;

    if (!this.isReady) return;

    this.map.jumpTo({
      center: frameState.camera.center,
      zoom: frameState.camera.zoom,
      pitch: clamp(frameState.camera.pitch, 0, 60),
      bearing: frameState.camera.bearing
    });
  }

  setExportMode(enabled) {
    this.isExportMode = Boolean(enabled);
    if (!this.isReady) return;
    const fadeMs = this.isExportMode ? 0 : 200;
    if (this.map.getLayer('basemap-layer')) {
      this.map.setPaintProperty('basemap-layer', 'raster-fade-duration', fadeMs);
    }
    if (this.map.getLayer('basemap-labels-layer')) {
      this.map.setPaintProperty('basemap-labels-layer', 'raster-fade-duration', fadeMs);
    }
  }

  isPrimaryTerrainAndBasemapLoaded() {
    if (!this.isReady) return false;
    const basemapReady = this.map.isSourceLoaded('basemap');
    const demReady =
      this.demProvider === 'none' ||
      !this.map.getSource('terrain-dem') ||
      this.map.isSourceLoaded('terrain-dem');
    return Boolean(basemapReady && demReady);
  }

  _flushMapRenderSync() {
    if (typeof this.map._render !== 'function') return false;
    try {
      if (typeof this.map._frameCancel === 'function') {
        this.map._frameCancel();
        this.map._frameCancel = null;
      } else if (this.map._frame && typeof this.map._frame.cancel === 'function') {
        this.map._frame.cancel();
        this.map._frame = null;
      }
      this.map._render(performance.now());
      return true;
    } catch {
      return false;
    }
  }

  _waitForSingleRender(timeoutMs = 35) {
    this.map.triggerRepaint();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.map.off('render', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.map.once('render', done);
    });
  }

  _waitForPrimarySources(timeoutMs = 25) {
    if (this.isPrimaryTerrainAndBasemapLoaded()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.map.off('sourcedata', onSourceData);
        this.map.off('idle', done);
        resolve();
      };
      const onSourceData = (e) => {
        if ((e.sourceId === 'basemap' || e.sourceId === 'terrain-dem') && this.isPrimaryTerrainAndBasemapLoaded()) {
          done();
        }
      };
      const timer = setTimeout(done, timeoutMs);
      this.map.on('sourcedata', onSourceData);
      this.map.once('idle', done);
    });
  }

  projectRawLngLat(lon, lat) {
    if (!this.isReady) return null;
    const pt = this.map.project({ lon, lat });
    return Number.isFinite(pt.x) && Number.isFinite(pt.y) ? { x: pt.x, y: pt.y } : null;
  }

  computeCameraMotionFlow(timeline, videoProgress, settings, evaluateFrameFn) {
    const blurPct = clamp(Number(settings.motionBlur ?? 0), 0, 100);
    if (!this.isReady || !timeline || blurPct <= 0 || videoProgress <= 0.001) {
      return null;
    }

    const frameStep = 1 / Math.max(15, Number(settings.durationSec || 30) * Number(settings.fps || 30));
    const curState = evaluateFrameFn(timeline, videoProgress, settings);
    const prevState = evaluateFrameFn(timeline, Math.max(0, videoProgress - frameStep), settings);
    const prevPt = this.projectRawLngLat(prevState.camera.center[0], prevState.camera.center[1]);
    if (!prevPt) return null;

    const width = Number(settings.stageWidth || 1080);
    const height = Number(settings.stageHeight || 1920);
    const s = Math.min(width, height) / 1080;
    const shutter = (blurPct / 100) * 1.35;

    const rawDx = (prevPt.x - width * 0.5) * shutter;
    const rawDy = (prevPt.y - height * 0.5) * shutter;
    const mag = Math.hypot(rawDx, rawDy);
    const maxPx = 30 * s;
    const magScale = mag > maxPx && mag > 0 ? maxPx / mag : 1;
    const dx = rawDx * magScale;
    const dy = rawDy * magScale;

    const rotRad = clamp(
      (((curState.camera.bearing - prevState.camera.bearing) * Math.PI) / 180) * shutter,
      -0.045,
      0.045
    );
    const zoomScale = clamp(
      1 + (Math.pow(2, prevState.camera.zoom - curState.camera.zoom) - 1) * shutter,
      0.965,
      1.035
    );

    if (Math.hypot(dx, dy) < 0.6 && Math.abs(rotRad) < 0.001 && Math.abs(zoomScale - 1) < 0.001) {
      return null;
    }

    return { dx, dy, rotRad, zoomScale };
  }

  project3DPoint(lon, lat, eleM, camera, centerEleM, stageWidth, stageHeight) {
    if (!this.isReady) return null;
    const effectiveExag = this.demProvider === 'none' ? 0 : this.exaggeration;
    if (!isPointInFrontOfCamera(lon, lat, eleM, camera, centerEleM, stageHeight, effectiveExag)) {
      return null;
    }
    const pt = this.map.project({ lon, lat });
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
    // Reject far-clipped projection overflow beyond extended stage bounds
    const maxSpan = Math.max(stageWidth, stageHeight) * 4;
    if (Math.abs(pt.x) > maxSpan || Math.abs(pt.y) > maxSpan) {
      return null;
    }
    return { x: pt.x, y: pt.y };
  }

  /**
   * Renders one deterministic export frame immediately, bypassing 60Hz VSync when possible.
   */
  async renderExportFrame(frameState, timeline, settings) {
    await this.waitUntilLoaded();
    this.applyFrame(frameState, timeline, settings);
    const synced = this._flushMapRenderSync();
    if (!synced) {
      await this._waitForSingleRender(35);
    }
    if (!this.isPrimaryTerrainAndBasemapLoaded()) {
      const waitMs = Math.max(25, Number(settings?.exportTileWaitMs || 25));
      await this._waitForPrimarySources(waitMs);
      const reSynced = this._flushMapRenderSync();
      if (!reSynced) {
        await this._waitForSingleRender(20);
      }
    }
  }

  /**
   * Visits overview + evenly spaced viewpoints along the route before export starts
   * so MapLibre downloads and caches terrain DEM and imagery tiles ahead of time.
   */
  async prewarmRouteTiles(timeline, settings, evaluateFrameFn, onProgress = () => {}, abortSignal = null) {
    await this.waitUntilLoaded();
    const prewarmWaitMs = Math.max(260, Number(settings?.prewarmTileWaitMs || 260));
    const waypoints = [0.0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 1.0];
    for (let i = 0; i < waypoints.length; i += 1) {
      if (abortSignal?.aborted) {
        throw new DOMException('Export canceled', 'AbortError');
      }
      const state = evaluateFrameFn(timeline, waypoints[i], settings);
      this.applyFrame(state, timeline, settings);
      this._flushMapRenderSync();
      if (!this.isPrimaryTerrainAndBasemapLoaded()) {
        await this._waitForPrimarySources(prewarmWaitMs);
        this._flushMapRenderSync();
      }
      onProgress((i + 1) / waypoints.length);
    }
  }

  destroy() {
    this._onRender = null;
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
