import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseTcx } from '../public/js/tcx-parser.mjs';
import {
  ACT_TIMING,
  INSTAGRAM_PRESETS,
  buildFlyoverTimeline,
  computeViewportZooms,
  evaluateFrameAt,
  mapFlyoverToRouteProgress,
  mapRouteToFlyoverProgress
} from '../public/js/flyover-math.mjs';
import { FfmpegEncodeManager, unpackFrameBatch } from '../lib/encoder.mjs';
import { createAppServer } from '../server.mjs';
import {
  buildStyleObject,
  getBasemapTiles,
  isPointInFrontOfCamera
} from '../public/js/map-scene.mjs';
import { drawMotionBlurTaps, renderHud } from '../public/js/hud-renderer.mjs';
import { computeSplitRevealState } from '../public/js/route-renderer.mjs';
import { getSampleColor, isHeatmapColorMode, tintHexTowardWhite } from '../public/js/canvas-utils.mjs';
import { formatSplitLeadLabel, syncStudioControlsFromState } from '../public/js/dom-bindings.mjs';
import {
  buildTemplateConfig,
  loadAndResolveCliJob,
  parseCliArgs,
  resolvePlaywrightBrowsersPath
} from '../lib/cli-config.mjs';
import { buildChromiumArgs, resolveEffectiveWebglOrder } from '../cli.mjs';
import {
  applyActivityToState,
  createStudioState,
  getTargetDimensions,
  buildRenderSettings,
  formatBytes
} from '../public/js/studio-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'public', 'samples');

function createMockCanvasContext() {
  const ops = [];
  const strokeStyles = [];
  const glowStrokeStyles = [];
  const linearGradientStops = [];
  const radialGradientStops = [];
  const drawnTexts = [];
  const stateStack = [];
  let currentScale = 1;

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    clearRect: () => ops.push('clearRect'),
    fillRect: () => {},
    strokeRect: () => {},
    drawImage: () => ops.push('drawImage'),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    arcTo: () => {},
    quadraticCurveTo: () => ops.push('quadraticCurveTo'),
    fill: () => {},
    stroke() {
      ops.push('stroke');
      strokeStyles.push(this.strokeStyle);
      if (this.globalCompositeOperation === 'lighter') {
        glowStrokeStyles.push(this.strokeStyle);
      }
    },
    save() {
      stateStack.push({
        alpha: this.globalAlpha,
        scale: currentScale,
        composite: this.globalCompositeOperation
      });
    },
    restore() {
      const prev = stateStack.pop();
      if (prev) {
        this.globalAlpha = prev.alpha;
        currentScale = prev.scale;
        this.globalCompositeOperation = prev.composite;
      }
    },
    translate: () => {},
    rotate: () => {},
    scale(sx) {
      currentScale *= sx;
    },
    setLineDash: () => {},
    fillText(txt) {
      ops.push(`text:${txt}`);
      drawnTexts.push({ text: txt, font: this.font, alpha: this.globalAlpha, scale: currentScale });
    },
    measureText: (txt) => ({ width: String(txt).length * 10 }),
    createLinearGradient: () => {
      const stops = [];
      linearGradientStops.push(stops);
      return {
        addColorStop: (offset, color) => stops.push({ offset, color })
      };
    },
    createRadialGradient: () => {
      const stops = [];
      radialGradientStops.push(stops);
      return {
        addColorStop: (offset, color) => stops.push({ offset, color })
      };
    }
  };

  return { ctx, ops, strokeStyles, glowStrokeStyles, linearGradientStops, radialGradientStops, drawnTexts };
}

test('parseTcx parses all 3 generated sample TCX files accurately', async () => {
  const sampleFiles = [
    { file: 'marin-headlands-trail-run.tcx', expectedSport: 'Running', minDist: 9000 },
    { file: 'alpe-dhuez-climb.tcx', expectedSport: 'Cycling', minDist: 11000, expectWatts: true },
    { file: 'central-park-tempo.tcx', expectedSport: 'Running', minDist: 8500 }
  ];

  for (const spec of sampleFiles) {
    const xml = await fs.readFile(path.join(SAMPLES_DIR, spec.file), 'utf8');
    const activity = parseTcx(xml, spec.file);
    assert.equal(activity.sport, spec.expectedSport);
    assert.ok(activity.points.length >= 300, `${spec.file} should have >= 300 points`);
    const lastDist = activity.points[activity.points.length - 1].distanceM;
    assert.ok(lastDist >= spec.minDist, `${spec.file} distance ${lastDist} >= ${spec.minDist}`);
    assert.equal(activity.hasElevation, true);
    assert.equal(activity.hasHeartRate, true);
    if (spec.expectWatts) {
      assert.equal(activity.hasPower, true);
      assert.equal(activity.hasCadence, true);
    }
  }
});

test('parseTcx handles multi-lap, missing Position, TPX extensions, missing DistanceMeters, and invalid XML', () => {
  const edgeTcx = `<?xml version="1.0" encoding="UTF-8"?>
  <TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
    <Activities>
      <Activity Sport="Running">
        <Id>2026-10-01T07:00:00Z</Id>
        <Lap StartTime="2026-10-01T07:00:00Z">
          <Track>
            <Trackpoint>
              <Time>2026-10-01T07:00:00Z</Time>
              <HeartRateBpm><Value>132</Value></HeartRateBpm>
            </Trackpoint>
            <Trackpoint>
              <Time>2026-10-01T07:00:05Z</Time>
              <Position><LatitudeDegrees>37.8000</LatitudeDegrees><LongitudeDegrees>-122.4000</LongitudeDegrees></Position>
              <AltitudeMeters>10</AltitudeMeters>
              <Extensions><ns3:TPX><ns3:Speed>3.2</ns3:Speed><ns3:RunCadence>88</ns3:RunCadence><ns3:Watts>260</ns3:Watts></ns3:TPX></Extensions>
            </Trackpoint>
          </Track>
        </Lap>
        <Lap StartTime="2026-10-01T07:00:10Z">
          <Track>
            <Trackpoint>
              <Time>2026-10-01T07:00:10Z</Time>
              <Position><LatitudeDegrees>37.8010</LatitudeDegrees><LongitudeDegrees>-122.4000</LongitudeDegrees></Position>
              <AltitudeMeters>15</AltitudeMeters>
            </Trackpoint>
            <Trackpoint>
              <Time>2026-10-01T07:00:15Z</Time>
              <Position><LatitudeDegrees>37.8020</LatitudeDegrees><LongitudeDegrees>-122.4000</LongitudeDegrees></Position>
              <AltitudeMeters>22</AltitudeMeters>
            </Trackpoint>
          </Track>
        </Lap>
      </Activity>
    </Activities>
  </TrainingCenterDatabase>`;

  const act = parseTcx(edgeTcx, 'custom-edge-run.tcx');
  assert.equal(act.title, 'Custom Edge Run');
  assert.equal(act.points.length, 3);
  assert.equal(act.points[0].cadence, 88);
  assert.equal(act.points[0].watts, 260);
  assert.equal(act.points[0].speed, 3.2);
  // Haversine fallback: 0.002 deg lat ~ 222m
  assert.ok(act.points[2].distanceM > 200 && act.points[2].distanceM < 250);

  assert.throws(() => parseTcx('<not-valid', 'bad.tcx'), /XML/);
  assert.throws(() => parseTcx('<Foo><Bar/></Foo>', 'bad.tcx'), /Unsupported XML root/);
});

test('Alpe d Huez timeline has monotonic distance, continuous unwrapped bearings (<15 deg/frame), and valid IG zooms', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'alpe-dhuez-climb.tcx'), 'utf8');
  const activity = parseTcx(xml, 'alpe-dhuez-climb.tcx');
  const timeline = buildFlyoverTimeline(activity, { numSamples: 750 });

  for (let i = 1; i < timeline.samples.length; i += 1) {
    assert.ok(timeline.samples[i].distanceM >= timeline.samples[i - 1].distanceM);
    assert.ok(Number.isFinite(timeline.samples[i].lat));
    assert.ok(Number.isFinite(timeline.samples[i].lon));
    assert.ok(Number.isFinite(timeline.samples[i].camBearing));
  }

  // Test all 4 Instagram presets
  for (const preset of Object.values(INSTAGRAM_PRESETS)) {
    const zooms = computeViewportZooms(timeline.bounds, preset.width, preset.height);
    assert.ok(Number.isFinite(zooms.overviewZoom) && zooms.overviewZoom >= 7.5 && zooms.overviewZoom <= 16.2);
    assert.ok(Number.isFinite(zooms.chaseZoom) && zooms.chaseZoom >= zooms.overviewZoom);
  }

  // Evaluate 900 frames (30s @ 30fps) on 9:16 Reels
  const settings = {
    stageWidth: 1080,
    stageHeight: 1920,
    cameraMode: 'chase',
    pitch: 58,
    zoomOffset: 0
  };
  let prevBearing = null;
  let maxDelta = 0;

  for (let f = 0; f < 900; f += 1) {
    const vp = f / 899;
    const frame = evaluateFrameAt(timeline, vp, settings);
    assert.ok(Number.isFinite(frame.camera.center[0]) && Number.isFinite(frame.camera.center[1]));
    assert.ok(Number.isFinite(frame.camera.zoom));
    assert.ok(Number.isFinite(frame.camera.bearing));

    if (prevBearing !== null) {
      const delta = Math.abs(frame.camera.bearing - prevBearing);
      if (delta > maxDelta) maxDelta = delta;
      assert.ok(delta < 15, `Frame ${f} bearing delta ${delta.toFixed(2)}° must be < 15°`);
    }
    prevBearing = frame.camera.bearing;

    if (vp < 0.12) {
      assert.equal(frame.routeProgress, 0);
    } else if (vp > 0.86) {
      assert.equal(frame.routeProgress, 1);
      assert.ok(frame.outroSummaryAlpha >= 0 && frame.outroSummaryAlpha <= 1);
    }
  }
  assert.ok(maxDelta < 15, `Max bearing jump across 900 frames was ${maxDelta.toFixed(2)}°`);
});

test('FfmpegEncodeManager encodes 30 frames at 720x1280 into Instagram H.264 yuv420p MP4 with AAC and Range streaming', async () => {
  const encoderManager = new FfmpegEncodeManager();

  // Generate 1 crisp synthetic 720x1280 JPEG buffer via ffmpeg
  const jpegBuf = execFileSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=#fc4c02:s=720x1280:d=0.1',
      '-frames:v', '1', '-f', 'mjpeg', 'pipe:1'
    ],
    { maxBuffer: 5 * 1024 * 1024 }
  );
  assert.ok(jpegBuf.length > 1000);

  const job = encoderManager.startJob({
    width: 720,
    height: 1280,
    fps: 30,
    filenameHint: 'test-reels-9x16.mp4'
  });

  // Pack 30 frames in batches of 10 using [uint32BE len][bytes]
  for (let b = 0; b < 3; b += 1) {
    const parts = [];
    for (let i = 0; i < 10; i += 1) {
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(jpegBuf.length, 0);
      parts.push(header, jpegBuf);
    }
    const batch = Buffer.concat(parts);
    await encoderManager.appendFrames(job.jobId, batch, 'application/octet-stream');
  }

  const meta = await encoderManager.finishJob(job.jobId);
  assert.equal(meta.frameCount, 30);
  assert.equal(meta.width, 720);
  assert.equal(meta.height, 1280);
  assert.ok(meta.sizeBytes > 2000);

  const internalJob = encoderManager.getJob(job.jobId);
  const probeRaw = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,profile,pix_fmt,width,height',
      '-show_entries', 'format=format_name',
      '-of', 'json',
      internalJob.outputPath
    ],
    { encoding: 'utf8' }
  );
  const probe = JSON.parse(probeRaw);
  const videoStream = probe.streams.find((s) => s.codec_type === 'video');
  const audioStream = probe.streams.find((s) => s.codec_type === 'audio');

  assert.ok(videoStream, 'MP4 must contain video stream');
  assert.equal(videoStream.codec_name, 'h264');
  assert.equal(videoStream.pix_fmt, 'yuv420p');
  assert.equal(videoStream.width, 720);
  assert.equal(videoStream.height, 1280);
  assert.ok(audioStream && audioStream.codec_name === 'aac', 'MP4 must contain silent AAC audio track');

  await encoderManager.disposeAll();
});

test('server.mjs serves health, static UI, and HTTP Range MP4 downloads', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('Flyover Studio'));

    // Test encode + Range 206 endpoint
    const jpegBuf = execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=0.1', '-frames:v', '1', '-f', 'mjpeg', 'pipe:1'],
      { maxBuffer: 2 * 1024 * 1024 }
    );
    const startRes = await fetch(`${baseUrl}/api/encode/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 320, height: 240, fps: 15, filename: 'range-test.mp4' })
    });
    const { jobId } = await startRes.json();

    const frameRes = await fetch(`${baseUrl}/api/encode/frames?jobId=${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: jpegBuf
    });
    assert.equal(frameRes.status, 200);

    const finRes = await fetch(`${baseUrl}/api/encode/finish?jobId=${jobId}`, { method: 'POST' });
    const fin = await finRes.json();

    const rangeRes = await fetch(`${baseUrl}${fin.downloadUrl}`, {
      headers: { Range: 'bytes=0-127' }
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
    const slice = await rangeRes.arrayBuffer();
    assert.equal(slice.byteLength, 128);
  } finally {
    await server.encoderManager.disposeAll();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('map-scene tile URLs use Esri {z}/{y}/{x} order, XYZ {z}/{x}/{y} order, and clean DEM fallback', () => {
  const styles = ['satellite', 'topo', 'dark', 'light'];
  for (const mapStyle of styles) {
    for (const useFallback of [false, true]) {
      const basemap = getBasemapTiles(mapStyle, useFallback);
      assert.ok(Array.isArray(basemap.tiles) && basemap.tiles.length > 0);
      for (const tileUrl of basemap.tiles) {
        if (tileUrl.includes('arcgisonline.com')) {
          assert.ok(tileUrl.includes('/tile/{z}/{y}/{x}'), `Esri URL must use /tile/{z}/{y}/{x}: ${tileUrl}`);
          assert.ok(!tileUrl.includes('/tile/{z}/{x}/{y}'), `Esri URL must NOT use /tile/{z}/{x}/{y}: ${tileUrl}`);
        } else {
          assert.ok(tileUrl.includes('/{z}/{x}/{y}'), `XYZ URL must use /{z}/{x}/{y}: ${tileUrl}`);
        }
      }
    }
  }

  const satStyle = buildStyleObject({
    mapStyle: 'satellite',
    showLabels: true,
    exaggeration: 1.4,
    demProvider: 'mapterhorn'
  });
  assert.ok(satStyle.sources['basemap-labels'].tiles[0].includes('/tile/{z}/{y}/{x}'));
  assert.ok(!satStyle.sources['basemap-labels'].tiles[0].includes('/tile/{z}/{x}/{y}'));
  assert.ok(satStyle.sources['terrain-dem'].tiles[0].includes('tiles.mapterhorn.com/{z}/{x}/{y}.webp'));
  assert.equal(satStyle.terrain.source, 'terrain-dem');
  assert.equal(
    Object.values(satStyle.sources).some((s) => s.type === 'geojson'),
    false,
    'Style must contain zero dynamic GeoJSON sources to prevent terrain RTT flicker'
  );
  assert.equal(
    satStyle.layers.find((l) => l.id === 'basemap-layer').paint['raster-fade-duration'],
    200
  );
  assert.ok(!satStyle.layers.some((l) => l.id === 'terrain-hillshade'));

  const darkStyle = buildStyleObject({
    mapStyle: 'dark',
    showLabels: false,
    exaggeration: 1.4,
    demProvider: 'mapterhorn'
  });
  assert.ok(darkStyle.layers.some((l) => l.id === 'terrain-hillshade'));

  const lightStyle = buildStyleObject({
    mapStyle: 'light',
    showLabels: false,
    exaggeration: 1.4,
    demProvider: 'mapterhorn'
  });
  assert.ok(lightStyle.layers.some((l) => l.id === 'terrain-hillshade'));

  const awsStyle = buildStyleObject({
    mapStyle: 'satellite',
    showLabels: false,
    exaggeration: 1.2,
    demProvider: 'aws'
  });
  assert.ok(awsStyle.sources['terrain-dem'].tiles[0].includes('elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'));

  const noDemStyle = buildStyleObject({
    mapStyle: 'satellite',
    showLabels: true,
    exaggeration: 1.4,
    demProvider: 'none'
  });
  assert.equal(noDemStyle.sources['terrain-dem'], undefined);
  assert.equal(noDemStyle.terrain, undefined);
  assert.ok(!noDemStyle.layers.some((l) => l.id === 'terrain-hillshade'));
});

test('isPointInFrontOfCamera accepts overhead/forward points and clips points behind pitched camera', () => {
  const overheadCam = { center: [-122.5, 37.83], zoom: 14, pitch: 0, bearing: 0 };
  assert.equal(isPointInFrontOfCamera(-122.5, 37.82, 100, overheadCam, 100, 1920), true);
  assert.equal(isPointInFrontOfCamera(-122.5, 37.84, 100, overheadCam, 100, 1920), true);

  const pitchedNorthCam = { center: [-122.5, 37.83], zoom: 15, pitch: 58, bearing: 0 };
  // Point north (ahead of camera) is visible
  assert.equal(isPointInFrontOfCamera(-122.5, 37.835, 100, pitchedNorthCam, 100, 1920), true);
  // Point far south (well behind camera eye when zoomed in at z15) is clipped
  assert.equal(isPointInFrontOfCamera(-122.5, 37.75, 100, pitchedNorthCam, 100, 1920), false);
});

test('buildFlyoverTimeline smooths sharp zig-zags while pinning endpoints and filling HR gaps', () => {
  const zigZagActivity = {
    title: 'ZigZag Trail',
    sport: 'Running',
    startTimeIso: '2026-10-10T08:00:00Z',
    hasElevation: true,
    hasHeartRate: true,
    hasCadence: false,
    hasPower: false,
    points: [
      { lat: 37.8000, lon: -122.5000, ele: 100, timeMs: 1000, distanceM: 0, speed: 3.2, hr: 135, cadence: null, watts: null },
      { lat: 37.8010, lon: -122.4985, ele: 112, timeMs: 61000, distanceM: 170, speed: 3.3, hr: null, cadence: null, watts: null },
      { lat: 37.8012, lon: -122.5015, ele: 125, timeMs: 121000, distanceM: 430, speed: 3.1, hr: 148, cadence: null, watts: null },
      { lat: 37.8025, lon: -122.4980, ele: 140, timeMs: 181000, distanceM: 760, speed: 3.4, hr: null, cadence: null, watts: null },
      { lat: 37.8035, lon: -122.5005, ele: 150, timeMs: 241000, distanceM: 1020, speed: 3.5, hr: 162, cadence: null, watts: null }
    ]
  };

  const unsmoothed = buildFlyoverTimeline(zigZagActivity, { numSamples: 200, trackSmoothness: 0 });
  const smoothed = buildFlyoverTimeline(zigZagActivity, { numSamples: 200, trackSmoothness: 1.6 });

  const startRaw = zigZagActivity.points[0];
  const endRaw = zigZagActivity.points[zigZagActivity.points.length - 1];

  // Start and finish remain pinned
  assert.ok(Math.abs(smoothed.samples[0].lat - startRaw.lat) < 1e-9);
  assert.ok(Math.abs(smoothed.samples[0].lon - startRaw.lon) < 1e-9);
  assert.ok(Math.abs(smoothed.samples[199].lat - endRaw.lat) < 1e-9);
  assert.ok(Math.abs(smoothed.samples[199].lon - endRaw.lon) < 1e-9);

  // Measure second-derivative corner sharpness across interior samples
  const secondDerivEnergy = (samples) => {
    let sum = 0;
    for (let i = 1; i < samples.length - 1; i += 1) {
      const d2Lat = samples[i + 1].lat - 2 * samples[i].lat + samples[i - 1].lat;
      const d2Lon = samples[i + 1].lon - 2 * samples[i].lon + samples[i - 1].lon;
      sum += d2Lat * d2Lat + d2Lon * d2Lon;
    }
    return sum;
  };
  assert.ok(
    secondDerivEnergy(smoothed.samples) < secondDerivEnergy(unsmoothed.samples),
    'Smoothed track must have lower corner curvature energy'
  );

  // Gap-free numeric HR and speed across all samples
  for (const s of smoothed.samples) {
    assert.ok(typeof s.hr === 'number' && Number.isFinite(s.hr));
    assert.ok(typeof s.speed === 'number' && Number.isFinite(s.speed));
  }
});

test('renderHud and drawMotionBlurTaps execute cleanly with glow, tailFade, motionFlow, and all 3 charts', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'alpe-dhuez-climb.tcx'), 'utf8');
  const activity = parseTcx(xml, 'alpe-dhuez-climb.tcx');
  const timeline = buildFlyoverTimeline(activity, { numSamples: 300, trackSmoothness: 1.2 });
  const settings = {
    presetId: 'reels_9_16',
    stageWidth: 1080,
    stageHeight: 1920,
    colorMode: 'orange',
    tailFade: true,
    glowIntensity: 1.5,
    showSplits: true,
    showHeader: true,
    showStats: true,
    showElevationChart: true,
    showSpeedChart: true,
    showHeartRateChart: true,
    showSummaryCard: true,
    units: 'metric'
  };
  const frameState = evaluateFrameAt(timeline, 0.5, settings);

  const { ctx: mockCtx, ops, strokeStyles } = createMockCanvasContext();
  const mockMapCanvas = { width: 1080, height: 1920 };
  const motionFlow = { dx: 12, dy: -8, rotRad: 0.015, zoomScale: 1.008 };

  drawMotionBlurTaps(mockCtx, mockMapCanvas, motionFlow, 1080, 1920, { includeBaseTap: true });
  // 1 base tap + 4 directional motion blur taps
  assert.equal(ops.filter((op) => op === 'drawImage').length, 5);

  renderHud(mockCtx, {
    width: 1080,
    height: 1920,
    timeline,
    frameState,
    settings,
    projectPoint: (lon, lat) => ({
      x: 540 + (lon - 6.04) * 5000,
      y: 960 - (lat - 45.07) * 5000
    }),
    mapCanvas: mockMapCanvas,
    motionFlow,
    isExporting: false,
    clear: true
  });

  assert.ok(ops.includes('quadraticCurveTo'), 'Smooth Bezier track should call quadraticCurveTo');
  assert.ok(!strokeStyles.includes('#090d16'), 'Glowing track must not draw dark black casing edge');
  assert.ok(strokeStyles.filter((c) => c === '#FC4C02').length >= 16, 'Track glow/fade should use smooth multi-layer falloff');
  assert.ok(ops.includes('text:ELEVATION PROFILE'));
  assert.ok(ops.some((op) => op.startsWith('text:SPEED')));
  assert.ok(ops.includes('text:HEART RATE'));
});

test('split labels support unit toggle (km/mi), unit text toggle, interval, and custom size', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'marin-headlands-trail-run.tcx'), 'utf8');
  const activity = parseTcx(xml, 'marin-headlands-trail-run.tcx');
  const timeline = buildFlyoverTimeline(activity, { numSamples: 300, trackSmoothness: 0.4 });
  const frameState = evaluateFrameAt(timeline, 0.9, { stageWidth: 1080, stageHeight: 1920 });

  const renderWithSplitSettings = (splitOpts) => {
    const { ctx: mockCtx, drawnTexts } = createMockCanvasContext();
    renderHud(mockCtx, {
      width: 1080,
      height: 1920,
      timeline,
      frameState,
      settings: {
        presetId: 'reels_9_16',
        showSplits: true,
        showHeader: false,
        showStats: false,
        showElevationChart: false,
        showSummaryCard: false,
        ...splitOpts
      },
      projectPoint: () => ({ x: 540, y: 960 }),
      isExporting: false,
      clear: true
    });
    return {
      texts: drawnTexts.map((d) => d.text),
      fonts: drawnTexts.map((d) => d.font)
    };
  };

  // km with unit text + interval 2 + 2.0x size
  const kmRes = renderWithSplitSettings({
    splitUnit: 'km',
    showSplitUnitText: true,
    splitLabelSize: 2.0,
    splitInterval: 2
  });
  assert.ok(kmRes.texts.includes('2 km'));
  assert.ok(!kmRes.texts.includes('1 km'));
  assert.ok(kmRes.fonts.some((f) => f.includes('22px')));

  // mi without unit text + interval 1 + 1.0x size
  const miNoUnitRes = renderWithSplitSettings({
    splitUnit: 'mi',
    showSplitUnitText: false,
    splitLabelSize: 1.0,
    splitInterval: 1
  });
  assert.ok(miNoUnitRes.texts.includes('1'));
  assert.ok(!miNoUnitRes.texts.includes('1 mi'));
  assert.ok(miNoUnitRes.fonts.some((f) => f.includes('11px')));

  // mi with unit text
  const miUnitRes = renderWithSplitSettings({
    splitUnit: 'mi',
    showSplitUnitText: true,
    splitLabelSize: 1.2,
    splitInterval: 1
  });
  assert.ok(miUnitRes.texts.includes('1 mi'));
});

test('split labels appear 1.5s ahead of track head and fade in smoothly rather than popping', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'marin-headlands-trail-run.tcx'), 'utf8');
  const activity = parseTcx(xml, 'marin-headlands-trail-run.tcx');
  const timeline = buildFlyoverTimeline(activity, { numSamples: 300, trackSmoothness: 0.4 });

  const durationSec = 30;
  const flyoverSec = durationSec * ACT_TIMING.FLYOVER_SPAN;
  const split3 = timeline.splitsKm.find((s) => s.index === 3);
  assert.ok(split3, 'Marin Headlands sample should have a 3 km split');

  const renderSplitsAt = (videoProgress) => {
    const frameState = evaluateFrameAt(timeline, videoProgress, {
      stageWidth: 1080,
      stageHeight: 1920,
      durationSec
    });
    const { ctx: mockCtx, drawnTexts } = createMockCanvasContext();

    renderHud(mockCtx, {
      width: 1080,
      height: 1920,
      timeline,
      frameState,
      settings: {
        presetId: 'reels_9_16',
        durationSec,
        showSplits: true,
        splitUnit: 'km',
        showSplitUnitText: true,
        splitLabelSize: 1.2,
        splitInterval: 1,
        showHeader: false,
        showStats: false,
        showElevationChart: false,
        showSummaryCard: false
      },
      projectPoint: () => ({ x: 540, y: 960 }),
      isExporting: false,
      clear: true
    });

    const drawn = new Map(drawnTexts.map((entry) => [entry.text, entry]));
    return { drawn, frameState };
  };

  // 1. Frame 0 (Act 1 Intro start): no split labels popped in yet
  const introStart = renderSplitsAt(0.0);
  const introSplitLabels = [...introStart.drawn.keys()].filter((txt) => /^\d+ km$/.test(txt));
  assert.equal(introSplitLabels.length, 0, 'No split labels should appear at videoProgress=0');

  // 2. When 3 km is 1.25s ahead of the track head (0.25s into its 0.6s fade-in, synchronized with pace mode)
  const split3FlyoverSec =
    mapRouteToFlyoverProgress(timeline, split3.distanceM / timeline.totalDistanceM, 'pace') * flyoverSec;
  const vpMidFade = ACT_TIMING.INTRO_END + (split3FlyoverSec - 1.25) / durationSec;
  const midFade = renderSplitsAt(vpMidFade);

  assert.ok(
    midFade.frameState.telemetry.distanceM < split3.distanceM,
    'Track head should still be behind 3 km'
  );
  assert.ok(midFade.drawn.has('3 km'), '3 km label should be visible 1.25s ahead of the track head');
  const split3Draw = midFade.drawn.get('3 km');
  assert.ok(
    split3Draw.alpha > 0.1 && split3Draw.alpha < 0.9,
    `3 km should be mid fade-in (got alpha=${split3Draw.alpha})`
  );
  assert.ok(
    split3Draw.scale > 0.88 && split3Draw.scale < 1.0,
    `3 km should gently scale in while fading (got scale=${split3Draw.scale})`
  );
  assert.ok(!midFade.drawn.has('5 km'), '5 km (>3s ahead) must not appear yet');
  assert.ok(midFade.drawn.has('1 km'), '1 km (already passed) should remain visible');
  assert.equal(midFade.drawn.get('1 km').alpha, 1, 'Passed split should be at full opacity');

  // 3. Monotonically increases alpha 0.25s later (1.0s ahead of head)
  const vpLaterFade = ACT_TIMING.INTRO_END + (split3FlyoverSec - 1.0) / durationSec;
  const laterFade = renderSplitsAt(vpLaterFade);
  assert.ok(
    laterFade.drawn.get('3 km').alpha > split3Draw.alpha,
    'Fade-in opacity should increase smoothly over time'
  );

  // 4. Act 3 Finale: all splits at full opacity
  const finale = renderSplitsAt(0.92);
  assert.ok(finale.drawn.has('3 km'));
  assert.equal(finale.drawn.get('3 km').alpha, 1);
});

test('studio-state derives even dimensions, render settings, and human-readable byte sizes', () => {
  const st = createStudioState();
  st.presetId = 'portrait_4_5';
  st.quality = 'fast';
  const dims = getTargetDimensions(st);
  assert.equal(dims.width, 720);
  assert.equal(dims.height, 900);

  const settings = buildRenderSettings(st);
  assert.equal(settings.presetId, 'portrait_4_5');
  assert.equal(settings.ratioLabel, '4:5');
  assert.equal(settings.stageWidth, 720);
  assert.equal(settings.stageHeight, 900);
  assert.equal(settings.durationSec, 30);
  assert.equal(settings.speedMode, 'pace');
  assert.equal(settings.splitLabelSize, 2.0);
  assert.equal(settings.splitLeadAheadSec, 0.2);
  assert.equal(settings.splitFadeInSec, 0.6);
  assert.equal(settings.showElevationChart, false);
  assert.equal(settings.showSpeedChart, true);
  assert.equal(settings.showHeartRateChart, true);

  assert.equal(formatBytes(512 * 1024), '512 KB');
  assert.equal(formatBytes(3.5 * 1024 * 1024), '3.5 MB');
  assert.equal(formatBytes(Number.NaN), '—');
});

test('computeSplitRevealState and unpackFrameBatch handle boundary and malformed inputs safely', () => {
  const hidden = computeSplitRevealState({
    splitDistanceM: 3000,
    totalDistanceM: 10000,
    videoProgress: 0.0,
    routeProgress: 0,
    durationSec: 30
  });
  assert.equal(hidden.visible, false);

  const finale = computeSplitRevealState({
    splitDistanceM: 9000,
    totalDistanceM: 10000,
    videoProgress: 0.95,
    routeProgress: 1,
    durationSec: 30
  });
  assert.deepEqual(finale, { visible: true, alpha: 1, revealEase: 1 });

  // Custom leadAheadSec: at head (0.0s) and after head (-0.5s)
  const durationSec = 30;
  const flyoverSec = durationSec * ACT_TIMING.FLYOVER_SPAN;
  const split5kSec = 0.5 * flyoverSec;
  const vpHalfSecBefore = ACT_TIMING.INTRO_END + (split5kSec - 0.5) / durationSec;
  const vpQuarterSecAfter = ACT_TIMING.INTRO_END + (split5kSec + 0.25) / durationSec;
  const vpOneSecAfter = ACT_TIMING.INTRO_END + (split5kSec + 1.0) / durationSec;

  assert.equal(
    computeSplitRevealState({
      splitDistanceM: 5000,
      totalDistanceM: 10000,
      videoProgress: vpHalfSecBefore,
      routeProgress: 0.45,
      durationSec,
      leadAheadSec: 0,
      fadeInSec: 0.5
    }).visible,
    false,
    'leadAheadSec=0 must stay hidden before track head reaches split'
  );
  const atHeadAfter = computeSplitRevealState({
    splitDistanceM: 5000,
    totalDistanceM: 10000,
    videoProgress: vpQuarterSecAfter,
    routeProgress: 0.51,
    durationSec,
    leadAheadSec: 0,
    fadeInSec: 0.5
  });
  assert.ok(atHeadAfter.visible && atHeadAfter.alpha > 0.5 && atHeadAfter.alpha < 1);

  assert.equal(
    computeSplitRevealState({
      splitDistanceM: 5000,
      totalDistanceM: 10000,
      videoProgress: vpQuarterSecAfter,
      routeProgress: 0.51,
      durationSec,
      leadAheadSec: -0.5,
      fadeInSec: 0.5
    }).visible,
    false,
    'leadAheadSec=-0.5 must stay hidden until 0.5s after head passes split'
  );
  assert.equal(
    computeSplitRevealState({
      splitDistanceM: 5000,
      totalDistanceM: 10000,
      videoProgress: vpOneSecAfter,
      routeProgress: 0.55,
      durationSec,
      leadAheadSec: -0.5,
      fadeInSec: 0.5
    }).alpha,
    1,
    'leadAheadSec=-0.5 should reach full opacity by 1.0s after head passes split'
  );

  const frameA = Buffer.from([1, 2, 3]);
  const frameB = Buffer.from([4, 5]);
  const packed = Buffer.alloc(4 + frameA.length + 4 + frameB.length);
  packed.writeUInt32BE(frameA.length, 0);
  frameA.copy(packed, 4);
  packed.writeUInt32BE(frameB.length, 4 + frameA.length);
  frameB.copy(packed, 8 + frameA.length);

  const unpacked = unpackFrameBatch(packed, 'application/octet-stream');
  assert.equal(unpacked.length, 2);
  assert.deepEqual(unpacked[0], frameA);
  assert.deepEqual(unpacked[1], frameB);

  assert.throws(
    () => unpackFrameBatch(Buffer.concat([packed, Buffer.from([9])]), 'application/octet-stream'),
    /Trailing bytes/
  );
});

test('track outer glow, hot filament, and athlete comet glow follow the chosen route line color', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'alpe-dhuez-climb.tcx'), 'utf8');
  const activity = parseTcx(xml, 'alpe-dhuez-climb.tcx');
  const timeline = buildFlyoverTimeline(activity, { numSamples: 300, trackSmoothness: 0.4 });
  const frameState = evaluateFrameAt(timeline, 0.5, { stageWidth: 1080, stageHeight: 1920 });

  const renderColorMode = (colorMode) => {
    const mock = createMockCanvasContext();
    renderHud(mock.ctx, {
      width: 1080,
      height: 1920,
      timeline,
      frameState,
      settings: {
        presetId: 'reels_9_16',
        mapStyle: 'satellite',
        colorMode,
        tailFade: true,
        glowIntensity: 1.4,
        showSplits: false,
        showHeader: false,
        showStats: false,
        showElevationChart: false,
        showSummaryCard: false
      },
      projectPoint: (lon, lat) => ({
        x: 540 + (lon - 6.04) * 5000,
        y: 960 - (lat - 45.07) * 5000
      }),
      isExporting: false,
      clear: true
    });
    return mock;
  };

  // 1. Solid theme: Neon Cyan (#00F0FF)
  const cyan = renderColorMode('cyan');
  const expectedCyanHot = tintHexTowardWhite('#00F0FF', 0.68);
  assert.ok(cyan.glowStrokeStyles.includes('#00F0FF'), 'Cyan outer glow should use #00F0FF');
  assert.ok(cyan.glowStrokeStyles.includes(expectedCyanHot), 'Cyan hot filament should be cyan-tinted');
  assert.ok(!cyan.glowStrokeStyles.includes('#FC4C02'), 'Cyan glow must not leak default orange');
  assert.ok(!cyan.glowStrokeStyles.includes('#fff8f0'), 'Cyan hot filament must not use warm orange-white');
  assert.equal(cyan.radialGradientStops.length, 1);
  assert.ok(
    cyan.radialGradientStops[0].some((s) => s.color.toLowerCase().startsWith('#00f0ff')),
    'Athlete comet glow should match #00F0FF'
  );

  // 2. Heatmap mode: Elevation Heatmap (outer glow + hot filament + comet follow live heatmap colors)
  const ele = renderColorMode('elevation');
  const headEleColor = getSampleColor(frameState.telemetry, timeline, 'elevation');
  const uniqueGlowColors = new Set(ele.glowStrokeStyles);
  assert.ok(
    uniqueGlowColors.size >= 4,
    `Elevation heatmap glow should follow multi-color segments (got ${uniqueGlowColors.size} unique colors)`
  );
  assert.ok(!ele.glowStrokeStyles.includes('#fff8f0'), 'Heatmap hot filament must not use hardcoded warm white');
  assert.equal(ele.radialGradientStops.length, 1);
  assert.ok(
    ele.radialGradientStops[0].some((s) => s.color.toLowerCase().startsWith(headEleColor.toLowerCase())),
    `Athlete comet glow should match live elevation head color (${headEleColor})`
  );
  assert.ok(
    ele.strokeStyles.includes(headEleColor),
    'Athlete beacon outline should match live elevation head color'
  );
});

test('telemetry charts follow the chosen track color in both solid and heatmap modes', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'alpe-dhuez-climb.tcx'), 'utf8');
  const activity = parseTcx(xml, 'alpe-dhuez-climb.tcx');
  const timeline = buildFlyoverTimeline(activity, { numSamples: 300, trackSmoothness: 0.4 });
  const frameState = evaluateFrameAt(timeline, 0.5, { stageWidth: 1080, stageHeight: 1920 });

  // 1. Solid theme: Volt Lime (#CCFF00) with default Speed + HR charts
  const limeMock = createMockCanvasContext();
  renderHud(limeMock.ctx, {
    width: 1080,
    height: 1920,
    timeline,
    frameState,
    settings: {
      presetId: 'reels_9_16',
      colorMode: 'lime',
      showHeader: false,
      showStats: false,
      showElevationChart: false,
      showSpeedChart: true,
      showHeartRateChart: true,
      showSummaryCard: false
    },
    projectPoint: null,
    isExporting: false,
    clear: true
  });
  assert.ok(limeMock.ops.some((op) => op.startsWith('text:SPEED')));
  assert.ok(limeMock.ops.includes('text:HEART RATE'));
  assert.ok(!limeMock.ops.includes('text:ELEVATION PROFILE'));
  assert.ok(limeMock.strokeStyles.includes('#CCFF00'), 'Charts should stroke with chosen track color #CCFF00');
  assert.ok(!limeMock.strokeStyles.includes('#38BDF8'), 'Speed chart must not use hardcoded cyan');
  assert.ok(!limeMock.strokeStyles.includes('#FB7185'), 'Heart rate chart must not use hardcoded pink');

  // 2. Heatmap mode: Speed/Pace heatmap -> charts use multi-stop heatmap gradients + live head dot color
  const paceMock = createMockCanvasContext();
  const headPaceColor = getSampleColor(frameState.telemetry, timeline, 'pace');
  renderHud(paceMock.ctx, {
    width: 1080,
    height: 1920,
    timeline,
    frameState,
    settings: {
      presetId: 'reels_9_16',
      colorMode: 'pace',
      showHeader: false,
      showStats: false,
      showElevationChart: false,
      showSpeedChart: true,
      showHeartRateChart: true,
      showSummaryCard: false
    },
    projectPoint: null,
    isExporting: false,
    clear: true
  });
  // 2 scrims + 2 charts * 2 gradients (fill + stroke) = 6 linear gradients
  const chartGradients = paceMock.linearGradientStops.filter((stops) => stops.length >= 10);
  assert.equal(chartGradients.length, 4, 'Each heatmap chart should build fill & stroke heatmap gradients');
  assert.ok(
    paceMock.strokeStyles.includes(headPaceColor),
    `Chart live marker should match live track head color (${headPaceColor})`
  );
});

test('syncStudioControlsFromState and canvas/format helpers stay consistent with DEFAULT_STUDIO_STATE', () => {
  assert.equal(formatSplitLeadLabel(0.2), '+0.2s ahead');
  assert.equal(formatSplitLeadLabel(0), 'At head (0.0s)');
  assert.equal(formatSplitLeadLabel(-0.5), '0.5s after');

  assert.equal(isHeatmapColorMode('orange'), false);
  assert.equal(isHeatmapColorMode('cyan'), false);
  assert.equal(isHeatmapColorMode('pace'), true);
  assert.equal(isHeatmapColorMode('elevation'), true);
  assert.equal(tintHexTowardWhite('#000000', 0.5), '#808080');
  assert.equal(tintHexTowardWhite('invalid', 0.5), '#ffffff');

  const st = createStudioState();
  const makeClassList = () => {
    const classes = new Set();
    return {
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
      has: (name) => classes.has(name)
    };
  };
  const mockEls = {
    rangeSplitSize: { value: '' },
    valSplitSize: { textContent: '' },
    rangeSplitLead: { value: '' },
    valSplitLead: { textContent: '' },
    rangeSplitFade: { value: '' },
    valSplitFade: { textContent: '' },
    chkSplits: { checked: false },
    chkHudElevation: { checked: true },
    chkHudSpeed: { checked: false },
    chkHudHr: { checked: false },
    splitLabelControls: { classList: makeClassList() },
    selectColorMode: { value: '' },
    selectSpeedMode: { value: '' },
    splitUnitBtns: [
      { dataset: { splitUnit: 'km' }, classList: makeClassList() },
      { dataset: { splitUnit: 'mi' }, classList: makeClassList() }
    ]
  };

  syncStudioControlsFromState(mockEls, st);
  assert.equal(mockEls.rangeSplitSize.value, '2');
  assert.equal(mockEls.valSplitSize.textContent, '2.0x');
  assert.equal(mockEls.rangeSplitLead.value, '0.2');
  assert.equal(mockEls.valSplitLead.textContent, '+0.2s ahead');
  assert.equal(mockEls.valSplitFade.textContent, '0.6s');
  assert.equal(mockEls.chkHudElevation.checked, false);
  assert.equal(mockEls.chkHudSpeed.checked, true);
  assert.equal(mockEls.chkHudHr.checked, true);
  assert.equal(mockEls.selectColorMode.value, 'orange');
  assert.equal(mockEls.selectSpeedMode.value, 'pace');
  assert.equal(mockEls.splitUnitBtns[0].classList.has('active'), true);
  assert.equal(mockEls.splitUnitBtns[1].classList.has('active'), false);
});

test('cli-config parses flags, merges JSON config with overrides, and validates inputs', async () => {
  const os = await import('node:os');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flyover-cli-test-'));

  try {
    const tpl = buildTemplateConfig();
    assert.equal(tpl.presetId, 'reels_9_16');
    assert.equal(tpl.speedMode, 'pace');
    assert.equal(tpl.splitLabelSize, 2.0);
    assert.equal(tpl.splitLeadAheadSec, 0.2);
    assert.equal(tpl.showElevationChart, false);
    assert.equal(tpl.showSpeedChart, true);
    assert.equal(tpl.showHeartRateChart, true);

    const cfgPath = path.join(tmpDir, 'my-config.json');
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        input: './sample.tcx',
        output: './exports/out.mp4',
        presetId: 'portrait_4_5',
        colorMode: 'cyan',
        durationSec: 20,
        units: 'imperial',
        showElevationChart: true
      }),
      'utf8'
    );

    const resolved = await loadAndResolveCliJob(
      ['--config', cfgPath, '--color', 'lime', '--speed-mode', 'constant', '--duration=15', '--no-hr-chart', '--quality', 'fast'],
      { cwd: tmpDir }
    );
    assert.equal(resolved.inputPath, path.join(tmpDir, 'sample.tcx'));
    assert.equal(resolved.outputPath, path.join(tmpDir, 'exports', 'out.mp4'));
    assert.equal(resolved.state.presetId, 'portrait_4_5');
    assert.equal(resolved.state.colorMode, 'lime'); // CLI flag overrides JSON config
    assert.equal(resolved.state.speedMode, 'constant');
    assert.equal(resolved.state.durationSec, 15);
    assert.equal(resolved.state.quality, 'fast');
    assert.equal(resolved.state.units, 'imperial');
    assert.equal(resolved.state.splitUnit, 'mi'); // auto-synced from units
    assert.equal(resolved.state.showElevationChart, true);
    assert.equal(resolved.state.showHeartRateChart, false);

    // Inline --init-config
    const initArgs = parseCliArgs(['--init-config', 'starter.json']);
    assert.equal(initArgs.initConfigPath, 'starter.json');

    // Rejects invalid enum and unknown config key
    await assert.rejects(
      () => loadAndResolveCliJob(['run.tcx', '--color', 'neon-plaid'], { cwd: tmpDir }),
      /Invalid colorMode/
    );
    await assert.rejects(
      () => loadAndResolveCliJob(['run.tcx', '--speed-mode', 'warp'], { cwd: tmpDir }),
      /Invalid speedMode/
    );
    const badCfgPath = path.join(tmpDir, 'bad.json');
    await fs.writeFile(badCfgPath, JSON.stringify({ bogusKey: 123 }), 'utf8');
    await assert.rejects(
      () => loadAndResolveCliJob(['run.tcx', '--config', badCfgPath], { cwd: tmpDir }),
      /Unknown config key/
    );

    // Shared CLI browser & activity helpers
    assert.equal(
      resolvePlaywrightBrowsersPath('/app', {}),
      path.join('/app', '.playwright-browsers')
    );
    assert.equal(
      resolvePlaywrightBrowsersPath('/app', { PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' }),
      '/ms-playwright'
    );
    assert.deepEqual(resolveEffectiveWebglOrder('auto', { hasDri: true }), ['gpu', 'swiftshader']);
    assert.deepEqual(resolveEffectiveWebglOrder('auto', { hasDri: false }), ['swiftshader']);
    assert.deepEqual(resolveEffectiveWebglOrder('swiftshader', { hasDri: true }), ['swiftshader']);
    assert.ok(buildChromiumArgs('swiftshader').includes('--use-angle=swiftshader'));
    assert.ok(buildChromiumArgs('gpu').includes('--enable-webgl'));

    const st = createStudioState();
    applyActivityToState(
      st,
      { title: 'Morning Run', sport: 'Running', hasHeartRate: false },
      { title: 'Custom Title' }
    );
    assert.equal(st.title, 'Custom Title');
    assert.equal(st.sport, 'Running');
    assert.equal(st.showHeartRateChart, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pace speedMode matches track head speed to activity pace while synchronizing splits and handling stops', () => {
  // Build a 4 km straight run: first 2 km slow (2.0 m/s), second 2 km fast (6.0 m/s -> 3x faster)
  const points = [];
  const totalPts = 201;
  let timeMs = 1_700_000_000_000;
  for (let i = 0; i < totalPts; i += 1) {
    const distanceM = i * 20; // 0 .. 4000m
    const speed = distanceM < 2000 ? 2.0 : 6.0;
    if (i > 0) {
      timeMs += (20 / speed) * 1000;
    }
    points.push({
      lat: 37.8 + distanceM * 0.000009,
      lon: -122.5,
      ele: 50,
      timeMs,
      distanceM,
      speed,
      hr: 150,
      cadence: null,
      watts: null
    });
  }

  const activity = {
    title: 'Slow-Fast Intervals',
    sport: 'Running',
    startTimeIso: new Date(points[0].timeMs).toISOString(),
    hasElevation: true,
    hasHeartRate: true,
    hasCadence: false,
    hasPower: false,
    points
  };

  const timeline = buildFlyoverTimeline(activity, { numSamples: 400, trackSmoothness: 0.2 });

  // 1. In pace mode (default), first 50% distance (2 km @ 2 m/s = 1000s) takes ~75% of flyover time
  //    and second 50% (2 km @ 6 m/s = 333s) takes ~25% of flyover time.
  const midFlyover = mapRouteToFlyoverProgress(timeline, 0.5, 'pace');
  assert.ok(
    midFlyover > 0.70 && midFlyover < 0.78,
    `Slow first half should consume ~75% of flyover time (got ${(midFlyover * 100).toFixed(1)}%)`
  );

  // Measure head ground velocity in slow zone (flyoverT 0.2 -> 0.3) vs fast zone (flyoverT 0.85 -> 0.95)
  const slowDistA = evaluateFrameAt(timeline, ACT_TIMING.INTRO_END + 0.20 * ACT_TIMING.FLYOVER_SPAN, { speedMode: 'pace' }).telemetry.distanceM;
  const slowDistB = evaluateFrameAt(timeline, ACT_TIMING.INTRO_END + 0.30 * ACT_TIMING.FLYOVER_SPAN, { speedMode: 'pace' }).telemetry.distanceM;
  const fastDistA = evaluateFrameAt(timeline, ACT_TIMING.INTRO_END + 0.85 * ACT_TIMING.FLYOVER_SPAN, { speedMode: 'pace' }).telemetry.distanceM;
  const fastDistB = evaluateFrameAt(timeline, ACT_TIMING.INTRO_END + 0.95 * ACT_TIMING.FLYOVER_SPAN, { speedMode: 'pace' }).telemetry.distanceM;
  const speedRatio = (fastDistB - fastDistA) / (slowDistB - slowDistA);
  assert.ok(
    speedRatio > 2.7 && speedRatio < 3.3,
    `Fast section head speed should be ~3x slow section (got ${speedRatio.toFixed(2)}x)`
  );

  // 2. Inverse mapping symmetry
  for (const p of [0, 0.15, 0.5, 0.82, 1]) {
    const fT = mapRouteToFlyoverProgress(timeline, p, 'pace');
    const roundTrip = mapFlyoverToRouteProgress(timeline, fT, 'pace');
    assert.ok(Math.abs(roundTrip - p) < 1e-4, `Inverse mismatch at p=${p}: got ${roundTrip}`);
  }

  // 3. In constant mode, routeProgress is strictly linear with flyoverT
  const constMid = evaluateFrameAt(timeline, ACT_TIMING.INTRO_END + 0.5 * ACT_TIMING.FLYOVER_SPAN, { speedMode: 'constant' });
  assert.ok(Math.abs(constMid.routeProgress - 0.5) < 1e-6);

  // 4. Split markers synchronize with pace-adjusted arrival (2 km split must NOT appear at linear 50% time)
  const durationSec = 30;
  const flyoverSec = durationSec * ACT_TIMING.FLYOVER_SPAN;
  const renderSplits = (flyoverT) => {
    const vp = ACT_TIMING.INTRO_END + flyoverT * ACT_TIMING.FLYOVER_SPAN;
    const frameState = evaluateFrameAt(timeline, vp, { durationSec, speedMode: 'pace' });
    const { ctx, drawnTexts } = createMockCanvasContext();
    renderHud(ctx, {
      width: 1080,
      height: 1920,
      timeline,
      frameState,
      settings: {
        durationSec,
        speedMode: 'pace',
        showSplits: true,
        splitUnit: 'km',
        splitLeadAheadSec: 0.2,
        splitFadeInSec: 0.6,
        showHeader: false,
        showStats: false,
        showElevationChart: false,
        showSpeedChart: false,
        showHeartRateChart: false,
        showSummaryCard: false
      },
      projectPoint: () => ({ x: 540, y: 960 }),
      isExporting: false,
      clear: true
    });
    return new Set(drawnTexts.map((d) => d.text));
  };

  assert.equal(renderSplits(0.50).has('2 km'), false, '2 km split should stay hidden at linear 50% time in pace mode');
  assert.equal(
    renderSplits(midFlyover - 0.1 / flyoverSec).has('2 km'),
    true,
    '2 km split should appear 0.1s ahead of actual pace-adjusted arrival'
  );

  // 5. Degenerate all-zero speed activity falls back cleanly to linear without NaN
  const zeroSpeedActivity = {
    ...activity,
    points: points.map((p) => ({ ...p, speed: 0 }))
  };
  const zeroTimeline = buildFlyoverTimeline(zeroSpeedActivity, { numSamples: 100 });
  const zeroMid = evaluateFrameAt(zeroTimeline, ACT_TIMING.INTRO_END + 0.5 * ACT_TIMING.FLYOVER_SPAN, { speedMode: 'pace' });
  assert.ok(Number.isFinite(zeroMid.routeProgress));
  assert.ok(Math.abs(zeroMid.routeProgress - 0.5) < 0.02);
});

test('finale summary card omits the TCX filename/title header and renders summary metrics cleanly', async () => {
  const xml = await fs.readFile(path.join(SAMPLES_DIR, 'marin-headlands-trail-run.tcx'), 'utf8');
  const activity = parseTcx(xml, 'my-secret-export-2026.tcx');
  activity.title = 'My Secret Export 2026';
  const timeline = buildFlyoverTimeline(activity, { numSamples: 200 });
  const frameState = evaluateFrameAt(timeline, 0.98, { stageWidth: 1080, stageHeight: 1920 });

  const { ctx, drawnTexts } = createMockCanvasContext();
  renderHud(ctx, {
    width: 1080,
    height: 1920,
    timeline,
    frameState,
    settings: {
      presetId: 'reels_9_16',
      showHeader: false,
      showStats: false,
      showElevationChart: false,
      showSpeedChart: false,
      showHeartRateChart: false,
      showSummaryCard: true,
      units: 'metric'
    },
    projectPoint: null,
    isExporting: false,
    clear: true
  });

  const texts = drawnTexts.map((d) => d.text);
  assert.ok(texts.includes('ACTIVITY COMPLETE'));
  assert.ok(texts.includes('DISTANCE'));
  assert.ok(texts.includes('ELEV GAIN'));
  assert.ok(texts.includes('MOVING TIME'));
  assert.ok(texts.includes('AVG PACE'));
  assert.ok(
    !texts.some((t) => t.includes('My Secret Export 2026')),
    'Finale summary card must not render the TCX filename/title header'
  );
});
