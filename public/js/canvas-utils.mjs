import { clamp, lerp } from './flyover-math.mjs';

export const COLOR_THEMES = Object.freeze({
  orange: '#FC4C02',
  cyan: '#00F0FF',
  lime: '#CCFF00',
  magenta: '#FF2E93'
});

export const COLOR_ACCENTS = Object.freeze({
  ...COLOR_THEMES,
  pace: '#FC4C02',
  elevation: '#38BDF8',
  hr: '#FB7185'
});

export function isHeatmapColorMode(colorMode) {
  return !COLOR_THEMES[colorMode];
}

const HEATMAP_STOPS = [
  [0.0, [56, 189, 248]],
  [0.35, [34, 197, 94]],
  [0.65, [250, 204, 21]],
  [1.0, [252, 76, 2]]
];

const MOTION_BLUR_TAPS = [
  [0.25, 0.28],
  [0.50, 0.20],
  [0.75, 0.13],
  [1.00, 0.08]
];

function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function sampleHeatmapHex(t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < HEATMAP_STOPS.length; i += 1) {
    const [t0, c0] = HEATMAP_STOPS[i - 1];
    const [t1, c1] = HEATMAP_STOPS[i];
    if (x <= t1) {
      const u = (x - t0) / Math.max(1e-6, t1 - t0);
      return rgbToHex(lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u));
    }
  }
  return '#FC4C02';
}

export function tintHexTowardWhite(hex, amount = 0.68) {
  const clean = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#ffffff';
  const t = clamp(amount, 0, 1);
  return rgbToHex(
    lerp(parseInt(clean.slice(0, 2), 16), 255, t),
    lerp(parseInt(clean.slice(2, 4), 16), 255, t),
    lerp(parseInt(clean.slice(4, 6), 16), 255, t)
  );
}

export function getSampleColor(sample, timeline, colorMode) {
  if (COLOR_THEMES[colorMode]) {
    return COLOR_THEMES[colorMode];
  }
  if (!sample) {
    return COLOR_ACCENTS[colorMode] || '#FC4C02';
  }
  if (colorMode === 'elevation') {
    const span = Math.max(1, timeline.bounds.maxEle - timeline.bounds.minEle);
    return sampleHeatmapHex((sample.ele - timeline.bounds.minEle) / span);
  }
  if (colorMode === 'hr' && sample.hr !== null) {
    const span = Math.max(1, timeline.maxHr - timeline.minHr);
    return sampleHeatmapHex((sample.hr - timeline.minHr) / span);
  }
  const span = Math.max(0.25, timeline.maxSpeed - timeline.minSpeed);
  return sampleHeatmapHex((sample.speed - timeline.minSpeed) / span);
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Composites camera-velocity directional/rotational/zoom shutter taps from the WebGL map canvas.
 */
export function drawMotionBlurTaps(
  ctx,
  mapCanvas,
  motionFlow,
  width,
  height,
  { includeBaseTap = true } = {}
) {
  if (!mapCanvas) return;
  if (includeBaseTap) {
    ctx.drawImage(mapCanvas, 0, 0, width, height);
  }
  if (!motionFlow) return;

  const minDim = Math.max(1, Math.min(width, height));
  for (const [frac, alpha] of MOTION_BLUR_TAPS) {
    const tx = motionFlow.dx * frac;
    const ty = motionFlow.dy * frac;
    const rot = -motionFlow.rotRad * frac * 0.65;
    const zScale = 1 + (motionFlow.zoomScale - 1) * frac;
    const edgePad = 1 + (Math.hypot(tx, ty) * 2.15) / minDim + Math.abs(rot) * 0.7;
    const scale = Math.max(1.002, zScale * edgePad);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(width / 2 + tx, height / 2 + ty);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.drawImage(mapCanvas, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
}
