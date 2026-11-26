import { ACT_TIMING, clamp, lerp, mapRouteToFlyoverProgress } from './flyover-math.mjs';
import {
  COLOR_THEMES,
  getSampleColor,
  isHeatmapColorMode,
  roundRectPath,
  tintHexTowardWhite
} from './canvas-utils.mjs';

const UNIFORM_GLOW_PASSES = Object.freeze([
  [22, 0.12],
  [13, 0.20],
  [8, 0.24]
]);

function finiteOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function strokePassList(ctx, traceFn, passes, { minWidth = 3, maxAlpha = 0.55 } = {}) {
  for (const [width, alpha] of passes) {
    traceFn();
    ctx.lineWidth = Math.max(minWidth, width);
    ctx.globalAlpha = clamp(alpha, 0, maxAlpha);
    ctx.stroke();
  }
}

function smoothScreenPoints(pts, maxJump) {
  const n = pts.length;
  if (n <= 4) return pts;
  const out = new Array(n);
  out[0] = pts[0];
  out[n - 1] = pts[n - 1];

  for (let i = 1; i < n - 1; i += 1) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    if (
      !curr ||
      !prev ||
      !next ||
      Math.hypot(curr.x - prev.x, curr.y - prev.y) > maxJump ||
      Math.hypot(next.x - curr.x, next.y - curr.y) > maxJump
    ) {
      out[i] = curr;
      continue;
    }
    out[i] = {
      x: prev.x * 0.15 + curr.x * 0.7 + next.x * 0.15,
      y: prev.y * 0.15 + curr.y * 0.7 + next.y * 0.15
    };
  }
  return out;
}

function traceProjectedRange(ctx, projected, { startIdx, endIdx, tailPt = null, maxJump, useBezier }) {
  ctx.beginPath();
  const chains = [];
  let current = [];

  for (let i = startIdx; i <= endIdx; i += 1) {
    const pt = projected[i];
    if (!pt) {
      if (current.length > 0) {
        chains.push(current);
        current = [];
      }
      continue;
    }
    if (current.length > 0) {
      const prev = current[current.length - 1];
      if (Math.hypot(pt.x - prev.x, pt.y - prev.y) > maxJump) {
        chains.push(current);
        current = [];
      }
    }
    current.push(pt);
  }

  if (tailPt) {
    if (current.length > 0) {
      const prev = current[current.length - 1];
      if (Math.hypot(tailPt.x - prev.x, tailPt.y - prev.y) <= maxJump) {
        current.push(tailPt);
      }
    } else {
      current.push(tailPt);
    }
  }

  if (current.length > 0) {
    chains.push(current);
  }

  for (const chain of chains) {
    if (chain.length < 2) continue;
    ctx.moveTo(chain[0].x, chain[0].y);
    if (!useBezier || chain.length === 2) {
      for (let k = 1; k < chain.length; k += 1) {
        ctx.lineTo(chain[k].x, chain[k].y);
      }
      continue;
    }
    for (let k = 1; k < chain.length - 1; k += 1) {
      const midX = (chain[k].x + chain[k + 1].x) * 0.5;
      const midY = (chain[k].y + chain[k + 1].y) * 0.5;
      ctx.quadraticCurveTo(chain[k].x, chain[k].y, midX, midY);
    }
    const last = chain[chain.length - 1];
    ctx.lineTo(last.x, last.y);
  }
}

function forEachRouteSegment(samples, startIdx, endIdx, headPt, projected, callback) {
  const step = Math.max(1, Math.floor(samples.length / 120));
  if (endIdx === 0) {
    if (projected[0] && headPt) {
      callback({
        startIdx: 0,
        endIdx: 0,
        tailPt: headPt,
        midSample: samples[0],
        frac: 1,
        isFirst: true,
        isLast: true
      });
    }
    return;
  }

  for (let i = startIdx; i < endIdx; i += step) {
    const nextI = Math.min(endIdx, i + step);
    callback({
      startIdx: i,
      endIdx: nextI,
      tailPt: nextI === endIdx ? headPt : null,
      midSample: samples[Math.floor((i + nextI) / 2)],
      frac: nextI / Math.max(1, endIdx),
      isFirst: i === startIdx,
      isLast: nextI === endIdx
    });
  }
}

function buildOuterGlowPasses({ tailFade, frac, s, glowIntensity, outroScale }) {
  if (!tailFade) {
    return UNIFORM_GLOW_PASSES.map(([w, a]) => [w * s, a * glowIntensity]);
  }
  const fadeScale = lerp(0.06, 1.0, Math.pow(frac, 1.25)) * outroScale;
  return [
    [lerp(11 * s, 26 * s, frac), 0.11 * glowIntensity * fadeScale],
    [lerp(7.5 * s, 16 * s, frac), 0.14 * glowIntensity * fadeScale],
    [lerp(5.0 * s, 10 * s, frac), 0.16 * glowIntensity * fadeScale]
  ];
}

function drawTrackOuterGlow(
  ctx,
  traceRange,
  { projected, samples, timeline, endIdx, headPt, colorMode, glowIntensity, tailFade, outroMix, glowComposite, s }
) {
  if (glowIntensity <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = glowComposite;

  const outroScale = lerp(1, 0.75, outroMix);
  if (!isHeatmapColorMode(colorMode)) {
    ctx.strokeStyle = COLOR_THEMES[colorMode];
    if (tailFade) {
      const GLOW_LAYERS = 16;
      for (let m = 0; m < GLOW_LAYERS; m += 1) {
        const t = m / (GLOW_LAYERS - 1);
        const startFrac = Math.pow(t, 0.85) * 0.96;
        const layerStart = Math.min(endIdx, Math.floor(startFrac * endIdx));
        traceRange(layerStart, endIdx, headPt);
        ctx.lineWidth = Math.max(4, lerp(9 * s, 26 * s, t));
        ctx.globalAlpha = clamp((0.012 + 0.022 * t * t) * glowIntensity * outroScale, 0, 0.22);
        ctx.stroke();
      }
    } else {
      const passes = UNIFORM_GLOW_PASSES.map(([w, a]) => [w * s, a * glowIntensity]);
      strokePassList(ctx, () => traceRange(0, endIdx, headPt), passes, { minWidth: 4, maxAlpha: 0.55 });
    }
    ctx.restore();
    return;
  }

  forEachRouteSegment(samples, 0, endIdx, headPt, projected, (seg) => {
    ctx.strokeStyle = getSampleColor(seg.midSample, timeline, colorMode);
    ctx.lineCap = seg.isFirst || seg.isLast ? 'round' : 'butt';
    const passes = buildOuterGlowPasses({ tailFade, frac: seg.frac, s, glowIntensity, outroScale });
    strokePassList(ctx, () => traceRange(seg.startIdx, seg.endIdx, seg.tailPt), passes, {
      minWidth: 3,
      maxAlpha: 0.45
    });
  });
  ctx.restore();
}

function drawTrackCore(ctx, traceRange, { projected, samples, timeline, endIdx, headPt, colorMode, tailFade, tailBaseAlpha, s }) {
  if (!isHeatmapColorMode(colorMode)) {
    ctx.save();
    ctx.strokeStyle = COLOR_THEMES[colorMode];

    traceRange(0, endIdx, headPt);
    ctx.globalAlpha = tailBaseAlpha;
    ctx.lineWidth = Math.max(2.0, (tailFade ? 3.4 : 4.8) * s);
    ctx.stroke();

    if (tailFade) {
      const CORE_LAYERS = 16;
      const perLayerAlpha = clamp((1 - tailBaseAlpha) / 8.5, 0.02, 0.10);
      for (let m = 1; m <= CORE_LAYERS; m += 1) {
        const t = m / CORE_LAYERS;
        const layerStart = Math.min(endIdx, Math.floor(Math.pow(t, 0.9) * 0.96 * endIdx));
        traceRange(layerStart, endIdx, headPt);
        ctx.globalAlpha = perLayerAlpha;
        ctx.lineWidth = Math.max(2.2, lerp(3.5 * s, 5.6 * s, t));
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  ctx.save();
  forEachRouteSegment(samples, 0, endIdx, headPt, projected, (seg) => {
    ctx.lineCap = seg.isFirst || seg.isLast ? 'round' : 'butt';
    traceRange(seg.startIdx, seg.endIdx, seg.tailPt);
    ctx.strokeStyle = getSampleColor(seg.midSample, timeline, colorMode);
    ctx.lineWidth = Math.max(2.2, lerp(3.6 * s, 5.4 * s, tailFade ? seg.frac : 1));
    ctx.globalAlpha = tailFade ? lerp(tailBaseAlpha, 1.0, Math.pow(seg.frac, 1.25)) : 1.0;
    ctx.stroke();
  });
  ctx.restore();
}

function drawTrackHotFilament(
  ctx,
  traceRange,
  { projected, samples, timeline, endIdx, headPt, colorMode, glowIntensity, tailFade, glowComposite, s }
) {
  if (glowIntensity <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = glowComposite;
  const hotSpan = tailFade ? 0.36 : 0.14;
  const cappedGlow = Math.min(1.5, glowIntensity);

  if (!isHeatmapColorMode(colorMode)) {
    ctx.strokeStyle = tintHexTowardWhite(COLOR_THEMES[colorMode], 0.68);
    const HOT_LAYERS = 10;
    for (let m = 0; m < HOT_LAYERS; m += 1) {
      const t = m / (HOT_LAYERS - 1);
      const startFrac = Math.max(0, 1 - hotSpan * (1 - t * 0.92));
      const layerStart = Math.min(endIdx, Math.floor(startFrac * endIdx));
      traceRange(layerStart, endIdx, headPt);
      ctx.lineWidth = Math.max(1.1, lerp(1.3 * s, 2.8 * s, t));
      ctx.globalAlpha = clamp((0.045 + 0.045 * t) * cappedGlow, 0, 0.22);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const hotStartIdx = Math.max(0, Math.floor((1 - hotSpan) * endIdx));
  const spanLen = Math.max(1, endIdx - hotStartIdx);
  forEachRouteSegment(samples, hotStartIdx, endIdx, headPt, projected, (seg) => {
    const u = endIdx === 0 ? 1 : clamp((seg.endIdx - hotStartIdx) / spanLen, 0, 1);
    const segColor = getSampleColor(seg.midSample, timeline, colorMode);
    ctx.strokeStyle = tintHexTowardWhite(segColor, 0.68);
    ctx.lineCap = seg.isFirst || seg.isLast ? 'round' : 'butt';
    const passes = [
      [lerp(1.3 * s, 2.8 * s, u), 0.26 * u * u * cappedGlow],
      [lerp(0.9 * s, 1.7 * s, u), 0.34 * u * u * cappedGlow]
    ];
    strokePassList(ctx, () => traceRange(seg.startIdx, seg.endIdx, seg.tailPt), passes, {
      minWidth: 1.0,
      maxAlpha: 0.55
    });
  });
  ctx.restore();
}

/**
 * Computes anticipatory fade-in alpha and ease progress for a split marker ahead of the track head.
 */
export function computeSplitRevealState({
  splitDistanceM,
  totalDistanceM,
  splitFlyoverFrac = null,
  videoProgress,
  routeProgress,
  durationSec = 30,
  leadAheadSec = 1.5,
  fadeInSec = 0.6
}) {
  if (routeProgress >= 0.99) {
    return { visible: true, alpha: 1, revealEase: 1 };
  }
  const introGate = clamp((videoProgress - 0.015) / 0.035, 0, 1);
  if (introGate <= 0) {
    return { visible: false, alpha: 0, revealEase: 0 };
  }

  const safeDuration = Math.max(1, finiteOr(durationSec, 30));
  const flyoverSec = safeDuration * ACT_TIMING.FLYOVER_SPAN;
  const curFlyoverSec = (videoProgress - ACT_TIMING.INTRO_END) * safeDuration;
  const resolvedFlyoverFrac = clamp(
    finiteOr(splitFlyoverFrac, splitDistanceM / Math.max(1, totalDistanceM)),
    0,
    1
  );
  const splitVideoSec = resolvedFlyoverFrac * flyoverSec;
  const timeUntilHit = splitVideoSec - curFlyoverSec;
  const leadSec = clamp(finiteOr(leadAheadSec, 1.5), -5, 10);
  const fadeSec = Math.max(0.05, finiteOr(fadeInSec, 0.6));
  const timeSinceReveal = leadSec - timeUntilHit;

  if (timeSinceReveal <= 0) {
    return { visible: false, alpha: 0, revealEase: 0 };
  }

  const rawT = clamp(timeSinceReveal / fadeSec, 0, 1);
  const revealEase = 1 - Math.pow(1 - rawT, 3);
  const arrivalEase = clamp(1 - timeUntilHit / 0.35, 0, 1);
  const alpha = clamp(revealEase * lerp(0.92, 1.0, arrivalEase) * introGate, 0, 1);

  return { visible: alpha > 0, alpha, revealEase };
}

function drawSplitMarkers(ctx, { width, height, timeline, frameState, settings, projectPoint, s }) {
  if (settings.showSplits === false) return;

  const splitUnit =
    settings.splitUnit === 'mi' || settings.splitUnit === 'km'
      ? settings.splitUnit
      : settings.units === 'imperial'
        ? 'mi'
        : 'km';
  const splits = splitUnit === 'mi' ? timeline.splitsMi : timeline.splitsKm;
  const splitScale = clamp(Number(settings.splitLabelSize ?? 2.0), 0.5, 2.5);
  const showSplitUnitText = settings.showSplitUnitText !== false;
  const splitInterval = Math.max(1, Math.round(Number(settings.splitInterval || 1)));

  const fontSize = Math.max(8, Math.round(11 * s * splitScale));
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const borderWidth = Math.max(1.2, 1.8 * s * Math.sqrt(splitScale));
  const pillH = Math.max(14, Math.round(20 * s * splitScale));
  const padX = Math.max(5, Math.round(8 * s * splitScale));
  const badgeR = Math.max(6, 10 * s * splitScale);
  const margin = Math.max(40, pillH * 2);

  const speedMode = settings.speedMode || 'pace';

  for (const sp of splits) {
    if (sp.index % splitInterval !== 0) continue;

    const splitFlyoverFrac = mapRouteToFlyoverProgress(
      timeline,
      sp.distanceM / Math.max(1, timeline.totalDistanceM),
      speedMode
    );
    const reveal = computeSplitRevealState({
      splitDistanceM: sp.distanceM,
      totalDistanceM: timeline.totalDistanceM,
      splitFlyoverFrac,
      videoProgress: frameState.videoProgress,
      routeProgress: frameState.routeProgress,
      durationSec: settings.durationSec,
      leadAheadSec: settings.splitLeadAheadSec,
      fadeInSec: settings.splitFadeInSec
    });
    if (!reveal.visible) continue;

    const pt = projectPoint(sp.lon, sp.lat, sp.ele);
    if (!pt || pt.x < -margin || pt.x > width + margin || pt.y < -margin || pt.y > height + margin) continue;

    const labelText = showSplitUnitText ? `${sp.index} ${splitUnit}` : String(sp.index);
    const yOffset = (1 - reveal.revealEase) * 6 * s;
    const enterScale = lerp(0.88, 1.0, reveal.revealEase);

    ctx.save();
    ctx.globalAlpha = reveal.alpha;
    ctx.translate(pt.x, pt.y + yOffset);
    ctx.scale(enterScale, enterScale);

    if (showSplitUnitText) {
      const textW = ctx.measureText(labelText).width;
      const pillW = Math.max(pillH, Math.round(textW + padX * 2));
      roundRectPath(ctx, -pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, badgeR, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(11, 14, 20, 0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, 0, 0.5);
    ctx.restore();
  }
}

function drawEndpointPin(ctx, pt, fillColor, s) {
  if (!pt) return;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, Math.max(4, 7.5 * s), 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, 2.5 * s);
  ctx.stroke();
}

function drawAthleteBeacon(ctx, headPt, { timeline, telemetry, colorMode, glowComposite, glowIntensity, s }) {
  if (!headPt) return;

  const markerColor = getSampleColor(telemetry, timeline, colorMode);
  const innerColor = tintHexTowardWhite(markerColor, 0.82);
  if (glowIntensity > 0) {
    const glowRadius = Math.max(16, 38 * s);
    const radGrad = ctx.createRadialGradient(headPt.x, headPt.y, 0, headPt.x, headPt.y, glowRadius);
    radGrad.addColorStop(0, `${innerColor}dd`);
    radGrad.addColorStop(0.28, `${markerColor}cc`);
    radGrad.addColorStop(0.65, `${markerColor}40`);
    radGrad.addColorStop(1, `${markerColor}00`);
    ctx.save();
    ctx.globalCompositeOperation = glowComposite;
    ctx.globalAlpha = clamp(glowIntensity / 1.1, 0.3, 1.0);
    ctx.beginPath();
    ctx.arc(headPt.x, headPt.y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = radGrad;
    ctx.fill();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(headPt.x, headPt.y, Math.max(4, 7.2 * s), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = markerColor;
  ctx.lineWidth = Math.max(1.5, 2.5 * s);
  ctx.stroke();
}

/**
 * Projects and renders a smooth glowing 3D route trace with continuous head-to-tail falloff,
 * anticipatory split badges, endpoints, and athlete beacon on the 2D overlay canvas.
 */
export function drawRouteSceneOverlay(ctx, { width, height, timeline, frameState, settings, projectPoint, s }) {
  if (typeof projectPoint !== 'function') return;
  const samples = timeline.samples;
  if (!samples || samples.length < 2) return;

  const maxJump = Math.max(width, height) * 0.75;
  const trackSmoothness = clamp(Number(settings.trackSmoothness ?? 0.4), 0, 2.0);
  const rawProjected = samples.map((sample) => projectPoint(sample.lon, sample.lat, sample.ele));
  const projected = trackSmoothness >= 0.8 ? smoothScreenPoints(rawProjected, maxJump) : rawProjected;
  const useBezier = trackSmoothness > 0.05;
  const headPt = projectPoint(frameState.telemetry.lon, frameState.telemetry.lat, frameState.telemetry.ele);
  const colorMode = settings.colorMode || 'orange';
  const tailFade = settings.tailFade !== false;
  const glowIntensity = clamp(Number(settings.glowIntensity ?? 1.2), 0, 2.5);
  const glowComposite = settings.mapStyle === 'light' ? 'source-over' : 'lighter';

  const traceRange = (startIdx, endIdx, tailPt = null) =>
    traceProjectedRange(ctx, projected, { startIdx, endIdx, tailPt, maxJump, useBezier });

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Ghost Full Route
  traceRange(0, projected.length - 1);
  ctx.strokeStyle = settings.mapStyle === 'light' ? 'rgba(15, 23, 42, 0.22)' : 'rgba(255, 255, 255, 0.20)';
  ctx.lineWidth = Math.max(1.8, 3.2 * s);
  ctx.stroke();

  // 2. Active Traced Route (Outer Glow + Core Gradient + Hot Leading Filament)
  const endIdx = Math.min(samples.length - 1, Math.floor(frameState.telemetry.floatIndex));
  if (endIdx >= 0) {
    const outroMix = frameState.outroSummaryAlpha || 0;
    const tailBaseAlpha = tailFade ? lerp(0.32, 0.72, outroMix) : 1.0;

    drawTrackOuterGlow(ctx, traceRange, {
      projected,
      samples,
      timeline,
      endIdx,
      headPt,
      colorMode,
      glowIntensity,
      tailFade,
      outroMix,
      glowComposite,
      s
    });
    drawTrackCore(ctx, traceRange, {
      projected,
      samples,
      timeline,
      endIdx,
      headPt,
      colorMode,
      tailFade,
      tailBaseAlpha,
      s
    });
    drawTrackHotFilament(ctx, traceRange, {
      projected,
      samples,
      timeline,
      endIdx,
      headPt,
      colorMode,
      glowIntensity,
      tailFade,
      glowComposite,
      s
    });
  }

  // 3. Split Markers
  drawSplitMarkers(ctx, { width, height, timeline, frameState, settings, projectPoint, s });

  // 4. Start & Finish Endpoints
  drawEndpointPin(ctx, projected[0], '#22c55e', s);
  if (frameState.routeProgress > 0.02 || frameState.act === 'intro' || frameState.act === 'finale') {
    drawEndpointPin(ctx, projected[projected.length - 1], '#f43f5e', s);
  }

  // 5. Athlete Radial Comet Glow + Luminous Beacon
  drawAthleteBeacon(ctx, headPt, {
    timeline,
    telemetry: frameState.telemetry,
    colorMode,
    glowComposite,
    glowIntensity,
    s
  });

  ctx.restore();
}
