import { toRadians } from './tcx-parser.mjs';

export const ACT_TIMING = Object.freeze({
  INTRO_END: 0.12,
  FLYOVER_END: 0.86,
  FLYOVER_SPAN: 0.74,
  FINALE_SPAN: 0.14
});

export const INSTAGRAM_PRESETS = {
  reels_9_16: {
    id: 'reels_9_16',
    label: 'Reels / Stories',
    ratioLabel: '9:16',
    width: 1080,
    height: 1920,
    draftWidth: 720,
    draftHeight: 1280,
    badge: 'Instagram Reels & Stories'
  },
  portrait_4_5: {
    id: 'portrait_4_5',
    label: 'Feed Portrait',
    ratioLabel: '4:5',
    width: 1080,
    height: 1350,
    draftWidth: 720,
    draftHeight: 900,
    badge: 'Instagram Feed (Max Height)'
  },
  square_1_1: {
    id: 'square_1_1',
    label: 'Feed Square',
    ratioLabel: '1:1',
    width: 1080,
    height: 1080,
    draftWidth: 720,
    draftHeight: 720,
    badge: 'Instagram Square Post'
  },
  landscape_16_9: {
    id: 'landscape_16_9',
    label: 'Landscape HD',
    ratioLabel: '16:9',
    width: 1920,
    height: 1080,
    draftWidth: 1280,
    draftHeight: 720,
    badge: 'Instagram Landscape / IGTV'
  }
};

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function isCyclingSport(sport = '') {
  return /cycl|bik|ride/i.test(String(sport));
}

function mercatorX(lon) {
  return (lon + 180) / 360;
}

function mercatorY(lat) {
  const clamped = clamp(lat, -85.05112878, 85.05112878);
  const rad = toRadians(clamped);
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

export function computeViewportZooms(bounds, stageWidth = 1080, stageHeight = 1920) {
  const minX = mercatorX(bounds.minLon);
  const maxX = mercatorX(bounds.maxLon);
  const minY = mercatorY(bounds.maxLat);
  const maxY = mercatorY(bounds.minLat);

  const dx = Math.max(1e-5, maxX - minX);
  const dy = Math.max(1e-5, maxY - minY);

  // Leave generous top/bottom margin for HUD & Instagram safe zones
  const usableW = Math.max(120, stageWidth * 0.64);
  const usableH = Math.max(120, stageHeight * 0.46);

  const zoomX = Math.log2(usableW / (512 * dx));
  const zoomY = Math.log2(usableH / (512 * dy));
  const overviewZoom = clamp(Math.min(zoomX, zoomY), 7.5, 16.2);

  // Chase zoom sits comfortably above overview zoom without zooming past tile detail
  const chaseZoom = clamp(Math.max(overviewZoom + 2.0, 13.6), 12.2, 16.0);

  return {
    overviewCenter: [bounds.centerLon, bounds.centerLat],
    overviewZoom,
    chaseZoom
  };
}

function gaussianSmooth(arr, radius, { skipNulls = false } = {}) {
  const n = arr.length;
  if (n <= 2 || radius <= 0) return [...arr];
  const sigma = Math.max(1, radius / 2.2);
  const twoSigmaSq = 2 * sigma * sigma;
  const out = new Array(n).fill(skipNulls ? null : 0);

  for (let i = 0; i < n; i += 1) {
    if (skipNulls && (arr[i] === null || arr[i] === undefined)) continue;
    let wSum = 0;
    let vSum = 0;
    const jStart = Math.max(0, i - radius);
    const jEnd = Math.min(n - 1, i + radius);
    for (let j = jStart; j <= jEnd; j += 1) {
      const val = arr[j];
      if (skipNulls && (val === null || val === undefined)) continue;
      const d = j - i;
      const w = Math.exp(-(d * d) / twoSigmaSq);
      wSum += w;
      vSum += val * w;
    }
    out[i] = wSum > 0 ? vSum / wSum : arr[i];
  }
  return out;
}

function catmullRom(v0, v1, v2, v3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * v1 +
      (-v0 + v2) * u +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * u3)
  );
}

function smoothEndpointPinned(arr, radius) {
  const n = arr.length;
  if (radius <= 0 || n <= 4) return [...arr];
  const smoothed = gaussianSmooth(arr, radius);
  const pinRamp = Math.max(1, radius * 1.5);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const w = clamp(Math.min(i / pinRamp, (n - 1 - i) / pinRamp), 0, 1);
    out[i] = lerp(arr[i], smoothed[i], w);
  }
  return out;
}

function fillNullableGaps(arr) {
  const n = arr.length;
  const out = [...arr];
  const firstIdx = out.findIndex((v) => v !== null && v !== undefined);
  if (firstIdx === -1) return out;
  for (let i = 0; i < firstIdx; i += 1) out[i] = out[firstIdx];
  let prevIdx = firstIdx;
  for (let i = firstIdx + 1; i < n; i += 1) {
    if (out[i] !== null && out[i] !== undefined) {
      const span = i - prevIdx;
      if (span > 1) {
        const v0 = out[prevIdx];
        const v1 = out[i];
        for (let k = 1; k < span; k += 1) {
          out[prevIdx + k] = lerp(v0, v1, k / span);
        }
      }
      prevIdx = i;
    }
  }
  for (let i = prevIdx + 1; i < n; i += 1) out[i] = out[prevIdx];
  return out;
}

function interpolateNullable(a, b, t) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a ?? null;
  return lerp(a, b, t);
}

function trimActivityPoints(rawPts, trimStart, trimEnd) {
  const cleanTrimStart = clamp(trimStart, 0, 0.94);
  const cleanTrimEnd = clamp(trimEnd, cleanTrimStart + 0.05, 1);
  const startIdx = Math.floor(cleanTrimStart * (rawPts.length - 1));
  const endIdx = Math.max(startIdx + 1, Math.ceil(cleanTrimEnd * (rawPts.length - 1)));
  const sliced = rawPts.slice(startIdx, endIdx + 1);
  const baseDist = sliced[0].distanceM;
  const baseTime = sliced[0].timeMs;

  return sliced.map((p) => ({
    ...p,
    distanceM: Math.max(0, p.distanceM - baseDist),
    elapsedSec: Math.max(0, (p.timeMs - baseTime) / 1000)
  }));
}

function computeElevationGainTrack(rawEles) {
  const smoothRawEles = gaussianSmooth(rawEles, 3);
  const gainTrack = new Array(rawEles.length).fill(0);
  let anchorEle = smoothRawEles[0];
  let cumGain = 0;

  for (let i = 1; i < rawEles.length; i += 1) {
    const e = smoothRawEles[i];
    if (e - anchorEle >= 2.0) {
      cumGain += e - anchorEle;
      anchorEle = e;
    } else if (e < anchorEle) {
      anchorEle = e;
    }
    gainTrack[i] = cumGain;
  }

  return { smoothRawEles, gainTrack, totalElevationGainM: cumGain };
}

function resampleUniformArcLength(trimmed, smoothRawEles, gainTrack, count, smoothLevel) {
  const totalDistanceM = trimmed[trimmed.length - 1].distanceM;
  const samples = new Array(count);
  const useSpline = smoothLevel > 0.05;
  const splineBlend = clamp(smoothLevel * 1.25, 0, 1);
  let cursor = 0;

  for (let i = 0; i < count; i += 1) {
    const targetDist = (i / (count - 1)) * totalDistanceM;
    while (cursor < trimmed.length - 2 && trimmed[cursor + 1].distanceM < targetDist) {
      cursor += 1;
    }
    const nextIdx = Math.min(trimmed.length - 1, cursor + 1);
    const pPrev = trimmed[Math.max(0, cursor - 1)];
    const p0 = trimmed[cursor];
    const p1 = trimmed[nextIdx];
    const pNext = trimmed[Math.min(trimmed.length - 1, cursor + 2)];
    const segSpan = p1.distanceM - p0.distanceM;
    const u = segSpan > 1e-6 ? clamp((targetDist - p0.distanceM) / segSpan, 0, 1) : 0;

    let sampleLat = lerp(p0.lat, p1.lat, u);
    let sampleLon = lerp(p0.lon, p1.lon, u);
    if (useSpline) {
      const crLat = clamp(
        catmullRom(pPrev.lat, p0.lat, p1.lat, pNext.lat, u),
        Math.min(pPrev.lat, p0.lat, p1.lat, pNext.lat),
        Math.max(pPrev.lat, p0.lat, p1.lat, pNext.lat)
      );
      const crLon = clamp(
        catmullRom(pPrev.lon, p0.lon, p1.lon, pNext.lon, u),
        Math.min(pPrev.lon, p0.lon, p1.lon, pNext.lon),
        Math.max(pPrev.lon, p0.lon, p1.lon, pNext.lon)
      );
      sampleLat = lerp(sampleLat, crLat, splineBlend);
      sampleLon = lerp(sampleLon, crLon, splineBlend);
    }

    samples[i] = {
      lat: sampleLat,
      lon: sampleLon,
      ele: lerp(smoothRawEles[cursor], smoothRawEles[nextIdx], u),
      gainM: lerp(gainTrack[cursor], gainTrack[nextIdx], u),
      distanceM: targetDist,
      elapsedSec: lerp(p0.elapsedSec, p1.elapsedSec, u),
      speed: lerp(p0.speed ?? 0, p1.speed ?? 0, u),
      hr: interpolateNullable(p0.hr, p1.hr, u),
      cadence: interpolateNullable(p0.cadence, p1.cadence, u),
      watts: interpolateNullable(p0.watts, p1.watts, u),
      gradePct: 0,
      camLat: 0,
      camLon: 0,
      camBearing: 0
    };
  }

  // Gentle endpoint-pinned spatial smoothing removes minor GPS jitter without cutting real turns
  const smoothRadius = Math.round(smoothLevel * 2.5);
  if (smoothRadius > 0) {
    const pinnedLats = smoothEndpointPinned(samples.map((s) => s.lat), smoothRadius);
    const pinnedLons = smoothEndpointPinned(samples.map((s) => s.lon), smoothRadius);
    for (let i = 0; i < count; i += 1) {
      samples[i].lat = pinnedLats[i];
      samples[i].lon = pinnedLons[i];
    }
  }

  return samples;
}

function computeCameraTrajectory(samples) {
  const count = samples.length;
  const camPosRadius = Math.max(8, Math.round(count * 0.05));
  const camLats = gaussianSmooth(samples.map((s) => s.lat), camPosRadius);
  const camLons = gaussianSmooth(samples.map((s) => s.lon), camPosRadius);

  const cosCenterLat = Math.cos(
    toRadians(samples.reduce((acc, s) => acc + s.lat, 0) / count)
  );
  const vecX = new Array(count).fill(0);
  const vecY = new Array(count).fill(1);
  const lookSpan = Math.max(2, Math.round(count * 0.015));

  for (let i = 0; i < count; i += 1) {
    const a = Math.max(0, i - lookSpan);
    const b = Math.min(count - 1, i + lookSpan);
    const dx = (camLons[b] - camLons[a]) * cosCenterLat;
    const dy = camLats[b] - camLats[a];
    const mag = Math.hypot(dx, dy);
    if (mag > 1e-10) {
      vecX[i] = dx / mag;
      vecY[i] = dy / mag;
    } else if (i > 0) {
      vecX[i] = vecX[i - 1];
      vecY[i] = vecY[i - 1];
    }
  }

  // Heavy circular smoothing on heading vectors prevents hairpin whips
  const bearingRadius = Math.max(14, Math.round(count * 0.075));
  const smoothVecX = gaussianSmooth(vecX, bearingRadius);
  const smoothVecY = gaussianSmooth(vecY, bearingRadius);

  const rawBearings = new Array(count);
  for (let i = 0; i < count; i += 1) {
    rawBearings[i] = (Math.atan2(smoothVecX[i], smoothVecY[i]) * 180) / Math.PI;
  }

  // Unwrap bearings sequentially so camera never spins across +-180 deg
  const unwrappedBearings = new Array(count);
  unwrappedBearings[0] = rawBearings[0];
  for (let i = 1; i < count; i += 1) {
    const delta = ((rawBearings[i] - rawBearings[i - 1] + 540) % 360) - 180;
    unwrappedBearings[i] = unwrappedBearings[i - 1] + delta;
  }

  return { camLats, camLons, unwrappedBearings };
}

function buildSplitMarkers(samples, totalDistanceM, stepMeters, unitLabel) {
  const count = samples.length;
  const markers = [];
  let nextMark = stepMeters;
  while (nextMark < totalDistanceM - stepMeters * 0.15) {
    const frac = clamp(nextMark / totalDistanceM, 0, 1);
    const floatIdx = frac * (count - 1);
    const idx0 = Math.floor(floatIdx);
    const idx1 = Math.min(count - 1, idx0 + 1);
    const u = floatIdx - idx0;
    const indexNum = Math.round(nextMark / stepMeters);
    markers.push({
      label: `${indexNum}${unitLabel}`,
      index: indexNum,
      distanceM: nextMark,
      lat: lerp(samples[idx0].lat, samples[idx1].lat, u),
      lon: lerp(samples[idx0].lon, samples[idx1].lon, u),
      ele: lerp(samples[idx0].ele, samples[idx1].ele, u),
      elapsedSec: lerp(samples[idx0].elapsedSec, samples[idx1].elapsedSec, u)
    });
    nextMark += stepMeters;
  }
  return markers;
}

function averageNonNull(values) {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null && v !== undefined) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

const MIN_USABLE_SPEED_MPS = 0.05;
const MIN_PACE_SPEED_FLOOR_MPS = 0.2;
const PACE_SPEED_FLOOR_RATIO = 0.12;

function buildLinearRamp(count) {
  if (count <= 1) return new Array(count).fill(0);
  const ramp = new Array(count);
  for (let i = 0; i < count; i += 1) {
    ramp[i] = i / (count - 1);
  }
  return ramp;
}

function resolveReferenceSpeed(samples, avgSpeedMps) {
  if (Number.isFinite(avgSpeedMps) && avgSpeedMps > MIN_USABLE_SPEED_MPS) {
    return avgSpeedMps;
  }
  let speedSum = 0;
  let speedCount = 0;
  for (const s of samples) {
    if (Number.isFinite(s.speed) && s.speed > MIN_USABLE_SPEED_MPS) {
      speedSum += s.speed;
      speedCount += 1;
    }
  }
  return speedCount > 0 ? speedSum / speedCount : 0;
}

function hasPaceTimeMap(timeline, speedMode) {
  return speedMode !== 'constant' && Array.isArray(timeline?.paceTimeNorm) && timeline.paceTimeNorm.length >= 2;
}

function computeMovingTimeSec(trimmed, fallbackDurationSec) {
  let movingTimeSec = 0;
  for (let i = 1; i < trimmed.length; i += 1) {
    const dt = (trimmed[i].timeMs - trimmed[i - 1].timeMs) / 1000;
    const dd = trimmed[i].distanceM - trimmed[i - 1].distanceM;
    if (dt > 0 && dt < 30 && dd / dt > 0.4) {
      movingTimeSec += dt;
    }
  }
  return movingTimeSec > 0 ? movingTimeSec : fallbackDurationSec;
}

/**
 * Builds a cumulative normalized time table [0..1] across uniform-distance samples
 * so track head velocity (dDistance / dVideoTime) is proportional to actual activity speed.
 * Uses a gentle slow-motion floor so brief stops don't freeze the video indefinitely.
 */
function buildPaceTimeMap(samples, avgSpeedMps) {
  const count = samples.length;
  if (count < 2) return buildLinearRamp(count);

  const refSpeed = resolveReferenceSpeed(samples, avgSpeedMps);
  if (refSpeed <= MIN_USABLE_SPEED_MPS) {
    return buildLinearRamp(count);
  }

  const speedFloor = Math.max(MIN_PACE_SPEED_FLOOR_MPS, refSpeed * PACE_SPEED_FLOOR_RATIO);
  const paceTimeNorm = new Array(count).fill(0);
  let cumTime = 0;
  for (let i = 1; i < count; i += 1) {
    const segDist = Math.max(1e-6, samples[i].distanceM - samples[i - 1].distanceM);
    const v0 = Number.isFinite(samples[i - 1].speed) ? samples[i - 1].speed : refSpeed;
    const v1 = Number.isFinite(samples[i].speed) ? samples[i].speed : refSpeed;
    cumTime += segDist / Math.max(speedFloor, 0.5 * (v0 + v1));
    paceTimeNorm[i] = cumTime;
  }

  if (cumTime <= 0 || !Number.isFinite(cumTime)) {
    return buildLinearRamp(count);
  }

  for (let i = 1; i < count - 1; i += 1) {
    paceTimeNorm[i] /= cumTime;
  }
  paceTimeNorm[0] = 0;
  paceTimeNorm[count - 1] = 1;
  return paceTimeNorm;
}

/**
 * Maps Act 2 flyover time fraction [0, 1] to route distance progress [0, 1].
 * In 'pace' mode, slower segments consume more video time and faster segments move quicker.
 */
export function mapFlyoverToRouteProgress(timeline, flyoverT, speedMode = 'pace') {
  const t = clamp(flyoverT, 0, 1);
  if (!hasPaceTimeMap(timeline, speedMode)) {
    return t;
  }
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const table = timeline.paceTimeNorm;
  const maxIdx = table.length - 1;
  let lo = 0;
  let hi = maxIdx;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = table[lo];
  const t1 = table[hi];
  const frac = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
  return (lo + frac) / maxIdx;
}

/**
 * Inverse of mapFlyoverToRouteProgress: maps route distance fraction [0, 1]
 * to the exact Act 2 flyover time fraction [0, 1] when the track head arrives there.
 */
export function mapRouteToFlyoverProgress(timeline, routeProgress, speedMode = 'pace') {
  const p = clamp(routeProgress, 0, 1);
  if (!hasPaceTimeMap(timeline, speedMode)) {
    return p;
  }
  const table = timeline.paceTimeNorm;
  const maxIdx = table.length - 1;
  const floatIdx = p * maxIdx;
  const idx0 = Math.floor(floatIdx);
  const idx1 = Math.min(maxIdx, idx0 + 1);
  return lerp(table[idx0], table[idx1], floatIdx - idx0);
}

/**
 * Builds a uniform-arc-length 3D flyover timeline from normalized TCX activity data.
 */
export function buildFlyoverTimeline(
  activity,
  { trimStart = 0, trimEnd = 1, numSamples = 950, trackSmoothness = 0.4 } = {}
) {
  const trimmed = trimActivityPoints(activity.points, trimStart, trimEnd);
  const totalDistanceM = trimmed[trimmed.length - 1].distanceM;
  const totalDurationSec = trimmed[trimmed.length - 1].elapsedSec;

  const { smoothRawEles, gainTrack, totalElevationGainM } = computeElevationGainTrack(
    trimmed.map((p) => p.ele)
  );

  const count = Math.max(40, Math.round(numSamples));
  const smoothLevel = clamp(Number(trackSmoothness ?? 0.4), 0, 2.0);
  const samples = resampleUniformArcLength(trimmed, smoothRawEles, gainTrack, count, smoothLevel);

  // Smooth telemetry channels
  const smoothedSpeed = gaussianSmooth(
    samples.map((s) => s.speed),
    Math.max(4, Math.round(count * 0.015))
  );
  let smoothedHr = gaussianSmooth(
    samples.map((s) => s.hr),
    Math.max(3, Math.round(count * 0.01)),
    { skipNulls: true }
  );
  if (activity.hasHeartRate) {
    smoothedHr = fillNullableGaps(smoothedHr);
  }
  const smoothedWatts = gaussianSmooth(
    samples.map((s) => s.watts),
    Math.max(3, Math.round(count * 0.01)),
    { skipNulls: true }
  );

  const { camLats, camLons, unwrappedBearings } = computeCameraTrajectory(samples);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let minSpeed = Infinity;
  let maxSpeed = -Infinity;
  let minHr = Infinity;
  let maxHr = -Infinity;
  const gradeHalfSpan = Math.max(2, Math.round(count * 0.01));

  for (let i = 0; i < count; i += 1) {
    const s = samples[i];
    s.speed = smoothedSpeed[i];
    if (smoothedHr[i] !== null) s.hr = smoothedHr[i];
    if (smoothedWatts[i] !== null) s.watts = smoothedWatts[i];

    s.camLat = lerp(s.lat, camLats[i], 0.72);
    s.camLon = lerp(s.lon, camLons[i], 0.72);
    s.camBearing = unwrappedBearings[i];

    const ga = Math.max(0, i - gradeHalfSpan);
    const gb = Math.min(count - 1, i + gradeHalfSpan);
    const dDist = samples[gb].distanceM - samples[ga].distanceM;
    s.gradePct = dDist > 2 ? clamp(((samples[gb].ele - samples[ga].ele) / dDist) * 100, -35, 35) : 0;

    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
    if (s.ele < minEle) minEle = s.ele;
    if (s.ele > maxEle) maxEle = s.ele;
    if (s.speed < minSpeed) minSpeed = s.speed;
    if (s.speed > maxSpeed) maxSpeed = s.speed;
    if (s.hr !== null) {
      if (s.hr < minHr) minHr = s.hr;
      if (s.hr > maxHr) maxHr = s.hr;
    }
  }

  const movingTimeSec = computeMovingTimeSec(trimmed, totalDurationSec);

  const bounds = {
    minLat,
    maxLat,
    minLon,
    maxLon,
    centerLat: (minLat + maxLat) / 2,
    centerLon: (minLon + maxLon) / 2,
    minEle,
    maxEle: Math.max(maxEle, minEle + 1)
  };

  const avgSpeedMps = movingTimeSec > 0 ? totalDistanceM / movingTimeSec : 0;
  const paceTimeNorm = buildPaceTimeMap(samples, avgSpeedMps);

  return {
    title: activity.title,
    sport: activity.sport,
    startTimeIso: activity.startTimeIso,
    totalDistanceM,
    totalElevationGainM,
    totalDurationSec,
    movingTimeSec,
    avgSpeedMps,
    avgHr: averageNonNull(samples.map((s) => s.hr)),
    avgWatts: averageNonNull(samples.map((s) => s.watts)),
    hasElevation: activity.hasElevation,
    hasHeartRate: activity.hasHeartRate,
    hasCadence: activity.hasCadence,
    hasPower: activity.hasPower,
    minSpeed: Number.isFinite(minSpeed) ? minSpeed : 0,
    maxSpeed: Number.isFinite(maxSpeed) ? Math.max(maxSpeed, minSpeed + 0.5) : 5,
    minHr: Number.isFinite(minHr) ? minHr : 110,
    maxHr: Number.isFinite(maxHr) ? Math.max(maxHr, minHr + 10) : 185,
    bounds,
    samples,
    paceTimeNorm,
    fullCoordinates: samples.map((s) => [s.lon, s.lat]),
    splitsKm: buildSplitMarkers(samples, totalDistanceM, 1000, 'km'),
    splitsMi: buildSplitMarkers(samples, totalDistanceM, 1609.344, 'mi')
  };
}

function sampleAtProgress(timeline, routeProgress) {
  const p = clamp(routeProgress, 0, 1);
  const samples = timeline.samples;
  const maxIdx = samples.length - 1;
  const floatIdx = p * maxIdx;
  const idx0 = Math.floor(floatIdx);
  const idx1 = Math.min(maxIdx, idx0 + 1);
  const u = floatIdx - idx0;

  const s0 = samples[idx0];
  const s1 = samples[idx1];

  return {
    sampleIndex: idx0,
    floatIndex: floatIdx,
    lat: lerp(s0.lat, s1.lat, u),
    lon: lerp(s0.lon, s1.lon, u),
    ele: lerp(s0.ele, s1.ele, u),
    gainM: lerp(s0.gainM, s1.gainM, u),
    distanceM: lerp(s0.distanceM, s1.distanceM, u),
    elapsedSec: lerp(s0.elapsedSec, s1.elapsedSec, u),
    speed: lerp(s0.speed, s1.speed, u),
    hr: interpolateNullable(s0.hr, s1.hr, u),
    cadence: interpolateNullable(s0.cadence, s1.cadence, u),
    watts: interpolateNullable(s0.watts, s1.watts, u),
    gradePct: lerp(s0.gradePct, s1.gradePct, u),
    camLat: lerp(s0.camLat, s1.camLat, u),
    camLon: lerp(s0.camLon, s1.camLon, u),
    camBearing: lerp(s0.camBearing, s1.camBearing, u)
  };
}

function lerpCamera(fromCam, toCam, t) {
  return {
    center: [
      lerp(fromCam.center[0], toCam.center[0], t),
      lerp(fromCam.center[1], toCam.center[1], t)
    ],
    zoom: lerp(fromCam.zoom, toCam.zoom, t),
    pitch: lerp(fromCam.pitch, toCam.pitch, t),
    bearing: lerp(fromCam.bearing, toCam.bearing, t)
  };
}

function getAct2Camera(timeline, routeProgress, settings, zooms) {
  const sample = sampleAtProgress(timeline, routeProgress);
  const cameraMode = settings.cameraMode || 'chase';
  const zoomOffset = Number(settings.zoomOffset ?? 0);
  const basePitch = clamp(Number(settings.pitch ?? 58), 0, 82);

  if (cameraMode === 'overview') {
    return {
      center: zooms.overviewCenter,
      zoom: clamp(zooms.overviewZoom + zoomOffset * 0.6, 6, 18),
      pitch: Math.min(54, basePitch),
      bearing: timeline.samples[0].camBearing - 20 + routeProgress * 45
    };
  }

  if (cameraMode === 'orbit') {
    return {
      center: [
        lerp(sample.camLon, zooms.overviewCenter[0], 0.25),
        lerp(sample.camLat, zooms.overviewCenter[1], 0.25)
      ],
      zoom: clamp(zooms.chaseZoom - 0.6 + zoomOffset, 7, 18),
      pitch: basePitch,
      bearing: timeline.samples[0].camBearing + routeProgress * 220
    };
  }

  return {
    center: [sample.camLon, sample.camLat],
    zoom: clamp(zooms.chaseZoom + zoomOffset, 7, 18.2),
    pitch: basePitch,
    bearing: sample.camBearing
  };
}

/**
 * Evaluates exact 3D camera, route progress, and telemetry state at normalized videoProgress [0, 1].
 * Act 1 (0.00 -> 0.12): Overview swoop-in to start.
 * Act 2 (0.12 -> 0.86): Route flyover tracking athlete.
 * Act 3 (0.86 -> 1.00): Pullback to 3D overview + summary card reveal.
 */
export function evaluateFrameAt(timeline, videoProgress, settings = {}) {
  const vp = clamp(videoProgress, 0, 1);
  const stageWidth = Number(settings.stageWidth || 1080);
  const stageHeight = Number(settings.stageHeight || 1920);
  const zooms = computeViewportZooms(timeline.bounds, stageWidth, stageHeight);

  let routeProgress = 0;
  let act = 'flyover';
  let introAlpha = 0;
  let outroSummaryAlpha = 0;
  let camera;

  if (vp < ACT_TIMING.INTRO_END) {
    act = 'intro';
    routeProgress = 0;
    const t = easeInOutCubic(vp / ACT_TIMING.INTRO_END);
    introAlpha = 1 - t;
    const startCam = getAct2Camera(timeline, 0, settings, zooms);
    const introStartCam = {
      center: zooms.overviewCenter,
      zoom: zooms.overviewZoom,
      pitch: 28,
      bearing: startCam.bearing - 28
    };
    camera = lerpCamera(introStartCam, startCam, t);
  } else if (vp <= ACT_TIMING.FLYOVER_END) {
    act = 'flyover';
    const flyoverT = (vp - ACT_TIMING.INTRO_END) / ACT_TIMING.FLYOVER_SPAN;
    routeProgress = mapFlyoverToRouteProgress(timeline, flyoverT, settings.speedMode || 'pace');
    camera = getAct2Camera(timeline, routeProgress, settings, zooms);
  } else {
    act = 'finale';
    routeProgress = 1;
    const t = easeInOutCubic((vp - ACT_TIMING.FLYOVER_END) / ACT_TIMING.FINALE_SPAN);
    outroSummaryAlpha = t;
    const endCam = getAct2Camera(timeline, 1, settings, zooms);
    const finaleCam = {
      center: zooms.overviewCenter,
      zoom: zooms.overviewZoom,
      pitch: 36,
      bearing: endCam.bearing + 25
    };
    camera = lerpCamera(endCam, finaleCam, t);
  }

  return {
    videoProgress: vp,
    routeProgress,
    act,
    introAlpha,
    outroSummaryAlpha,
    camera,
    telemetry: sampleAtProgress(timeline, routeProgress)
  };
}

export function formatDistance(meters, units = 'metric') {
  if (units === 'imperial') {
    return { value: (meters / 1609.344).toFixed(2), unit: 'mi' };
  }
  return { value: (meters / 1000).toFixed(2), unit: 'km' };
}

export function formatElevation(meters, units = 'metric') {
  if (units === 'imperial') {
    return { value: Math.round(meters * 3.28084).toLocaleString('en-US'), unit: 'ft' };
  }
  return { value: Math.round(meters).toLocaleString('en-US'), unit: 'm' };
}

export function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatPaceOrSpeed(speedMps, sport = 'Running', units = 'metric') {
  if (isCyclingSport(sport)) {
    const val = units === 'imperial' ? speedMps * 2.236936 : speedMps * 3.6;
    return {
      label: 'SPEED',
      value: val.toFixed(1),
      unit: units === 'imperial' ? 'mph' : 'km/h'
    };
  }

  const unitSuffix = units === 'imperial' ? '/mi' : '/km';
  if (speedMps < 0.25) {
    return { label: 'PACE', value: '--:--', unit: unitSuffix };
  }
  const metersPerUnit = units === 'imperial' ? 1609.344 : 1000;
  const secPerUnit = Math.min(3599, metersPerUnit / speedMps);
  const mins = Math.floor(secPerUnit / 60);
  const secs = Math.round(secPerUnit % 60);
  const adjMins = secs === 60 ? mins + 1 : mins;
  const adjSecs = secs === 60 ? 0 : secs;
  return {
    label: 'PACE',
    value: `${adjMins}:${String(adjSecs).padStart(2, '0')}`,
    unit: unitSuffix
  };
}
