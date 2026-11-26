import {
  clamp,
  isCyclingSport,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPaceOrSpeed
} from './flyover-math.mjs';
import {
  COLOR_ACCENTS,
  getSampleColor,
  isHeatmapColorMode,
  roundRectPath,
  drawMotionBlurTaps
} from './canvas-utils.mjs';
import { drawRouteSceneOverlay } from './route-renderer.mjs';

export { drawMotionBlurTaps };

function drawSportGlyph(ctx, sport, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.8, size * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isCyclingSport(sport)) {
    const r = size * 0.25;
    ctx.beginPath();
    ctx.arc(-size * 0.28, size * 0.16, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.28, size * 0.16, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, size * 0.16);
    ctx.lineTo(-size * 0.04, -size * 0.14);
    ctx.lineTo(size * 0.18, -size * 0.14);
    ctx.lineTo(size * 0.28, size * 0.16);
    ctx.moveTo(-size * 0.04, -size * 0.14);
    ctx.lineTo(size * 0.02, size * 0.16);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(size * 0.08, -size * 0.28, size * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-size * 0.18, -size * 0.05);
    ctx.lineTo(size * 0.04, -size * 0.12);
    ctx.lineTo(size * 0.22, -size * 0.02);
    ctx.moveTo(size * 0.04, -size * 0.12);
    ctx.lineTo(-size * 0.05, size * 0.10);
    ctx.lineTo(-size * 0.22, size * 0.30);
    ctx.moveTo(-size * 0.05, size * 0.10);
    ctx.lineTo(size * 0.18, size * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

function formatActivityDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function drawScrims(ctx, width, height) {
  ctx.save();
  const topScrim = ctx.createLinearGradient(0, 0, 0, height * 0.34);
  topScrim.addColorStop(0, 'rgba(7, 10, 16, 0.78)');
  topScrim.addColorStop(1, 'rgba(7, 10, 16, 0.0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, width, height * 0.34);

  const botScrim = ctx.createLinearGradient(0, height * 0.68, 0, height);
  botScrim.addColorStop(0, 'rgba(7, 10, 16, 0.0)');
  botScrim.addColorStop(1, 'rgba(7, 10, 16, 0.82)');
  ctx.fillStyle = botScrim;
  ctx.fillRect(0, height * 0.68, width, height * 0.32);
  ctx.restore();
}

function drawSafeZoneOverlay(ctx, width, height, ratioId, s) {
  ctx.save();
  const isReels = ratioId === 'reels_9_16' || height / width > 1.5;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
  ctx.lineWidth = Math.max(1.5, 2 * s);
  ctx.setLineDash([8 * s, 6 * s]);
  ctx.font = `600 ${Math.round(18 * s)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (isReels) {
    const topH = Math.round(height * 0.105);
    const botH = Math.round(height * 0.165);
    const rightW = Math.round(width * 0.145);
    const rightTop = Math.round(height * 0.48);
    const rightH = Math.round(height * 0.34);

    ctx.fillRect(0, 0, width, topH);
    ctx.strokeRect(1, 1, width - 2, topH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillText('INSTAGRAM TOP SAFE ZONE', width / 2, topH / 2);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.fillRect(0, height - botH, width, botH);
    ctx.strokeRect(1, height - botH, width - 2, botH - 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillText('INSTAGRAM CAPTION & AUDIO SAFE ZONE', width / 2, height - botH / 2);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.fillRect(width - rightW, rightTop, rightW, rightH);
    ctx.strokeRect(width - rightW, rightTop, rightW - 1, rightH);
    ctx.save();
    ctx.translate(width - rightW / 2, rightTop + rightH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillText('REELS ACTIONS', 0, 0);
    ctx.restore();
  } else {
    const margin = Math.round(36 * s);
    ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText('FEED SAFE FRAME', width / 2, margin + 18 * s);
  }
  ctx.restore();
}

function drawHeaderPill(ctx, { width, sidePad, topY, isReels, title, sport, startTimeIso, accent, s }) {
  ctx.save();
  const headerW = Math.min(width - sidePad * 2, isReels ? width - sidePad * 2 : 660 * s);
  const headerH = Math.round(92 * s);

  ctx.fillStyle = 'rgba(11, 14, 20, 0.76)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  roundRectPath(ctx, sidePad, topY, headerW, headerH, 20 * s);
  ctx.fill();
  ctx.stroke();

  const badgeSize = 54 * s;
  const badgeX = sidePad + 18 * s;
  const badgeY = topY + (headerH - badgeSize) / 2;
  ctx.fillStyle = `${accent}26`;
  roundRectPath(ctx, badgeX, badgeY, badgeSize, badgeSize, 14 * s);
  ctx.fill();
  drawSportGlyph(ctx, sport, badgeX + badgeSize / 2, badgeY + badgeSize / 2, badgeSize * 0.78, accent);

  const textX = badgeX + badgeSize + 18 * s;
  const maxTextW = headerW - (textX - sidePad) - 20 * s;

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(28 * s)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let displayTitle = title;
  while (ctx.measureText(displayTitle).width > maxTextW && displayTitle.length > 6) {
    displayTitle = `${displayTitle.slice(0, -2)}…`;
  }
  ctx.fillText(displayTitle, textX, topY + headerH * 0.37);

  const dateStr = formatActivityDate(startTimeIso);
  const subText = [sport.toUpperCase(), dateStr].filter(Boolean).join('  ·  ');
  ctx.fillStyle = 'rgba(203, 213, 225, 0.85)';
  ctx.font = `600 ${Math.round(17 * s)}px Inter, system-ui, sans-serif`;
  ctx.fillText(subText, textX, topY + headerH * 0.70);

  ctx.restore();
  return headerH + 16 * s;
}

function drawStatsGrid(ctx, { width, sidePad, topY, isReels, timeline, frameState, sport, units, accent, s }) {
  ctx.save();
  const t = frameState.telemetry;
  const distFmt = formatDistance(t.distanceM, units);
  const eleFmt = formatElevation(t.ele, units);
  const gainFmt = formatElevation(t.gainM, units);
  const paceFmt = formatPaceOrSpeed(t.speed, sport, units);
  const timeFmt = formatDuration(t.elapsedSec);

  const cards = [
    { label: 'DISTANCE', value: distFmt.value, unit: distFmt.unit },
    { label: 'ELEV / GAIN', value: eleFmt.value, unit: `${eleFmt.unit} (+${gainFmt.value})` },
    { label: paceFmt.label, value: paceFmt.value, unit: paceFmt.unit },
    { label: 'ELAPSED', value: timeFmt, unit: '' }
  ];

  if (timeline.hasPower && t.watts !== null) {
    cards.push({ label: 'POWER', value: String(Math.round(t.watts)), unit: 'W' });
  } else if (timeline.hasHeartRate && t.hr !== null) {
    cards.push({ label: 'HEART RATE', value: String(Math.round(t.hr)), unit: 'bpm' });
  }

  const cols = isReels ? (cards.length > 4 ? 3 : 2) : cards.length;
  const gap = 12 * s;
  const availW = isReels ? width - sidePad * 2 : Math.min(width - sidePad * 2, 920 * s);
  const cardW = (availW - gap * (cols - 1)) / cols;
  const cardH = Math.round(82 * s);

  cards.forEach((c, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cx = sidePad + col * (cardW + gap);
    const cy = topY + row * (cardH + gap);

    ctx.fillStyle = 'rgba(11, 14, 20, 0.74)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
    ctx.lineWidth = Math.max(1, 1.3 * s);
    roundRectPath(ctx, cx, cy, cardW, cardH, 14 * s);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
    ctx.font = `700 ${Math.round(14 * s)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.label, cx + 16 * s, cy + 24 * s);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(30 * s)}px Inter, system-ui, sans-serif`;
    ctx.fillText(c.value, cx + 16 * s, cy + 56 * s);

    if (c.unit) {
      const valW = ctx.measureText(c.value).width;
      ctx.fillStyle = accent;
      ctx.font = `700 ${Math.round(15 * s)}px Inter, system-ui, sans-serif`;
      ctx.fillText(c.unit, cx + 22 * s + valW, cy + 58 * s);
    }
  });
  ctx.restore();
}

function buildChartPaint(ctx, { plotX, plotY, plotW, plotH, samples, timeline, spec }) {
  if (!spec.isHeatmap) {
    const grad = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
    grad.addColorStop(0, `${spec.color}70`);
    grad.addColorStop(1, `${spec.color}08`);
    return { areaFill: grad, curveStroke: spec.color };
  }

  const fillGrad = ctx.createLinearGradient(plotX, 0, plotX + plotW, 0);
  const strokeGrad = ctx.createLinearGradient(plotX, 0, plotX + plotW, 0);
  const GRAD_STOPS = 20;
  for (let k = 0; k < GRAD_STOPS; k += 1) {
    const stopT = k / (GRAD_STOPS - 1);
    const sampleIdx = Math.min(samples.length - 1, Math.round(stopT * (samples.length - 1)));
    const stopColor = getSampleColor(samples[sampleIdx], timeline, spec.colorMode);
    fillGrad.addColorStop(stopT, `${stopColor}48`);
    strokeGrad.addColorStop(stopT, stopColor);
  }
  return { areaFill: fillGrad, curveStroke: strokeGrad };
}

function drawTelemetryChartCard(ctx, x, y, w, h, spec, timeline, frameState, s) {
  const samples = timeline.samples;
  if (!samples || samples.length < 2) return;

  const compact = clamp(h / (132 * s), 0.58, 1);

  ctx.save();
  ctx.fillStyle = 'rgba(11, 14, 20, 0.78)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  roundRectPath(ctx, x, y, w, h, Math.max(10, 16 * s * compact));
  ctx.fill();
  ctx.stroke();

  const padX = Math.max(12, 20 * s);
  const padTop = Math.max(22, 34 * s * compact);
  const padBot = Math.max(10, 18 * s * compact);
  const plotX = x + padX;
  const plotY = y + padTop;
  const plotW = w - padX * 2;
  const plotH = Math.max(18 * s, h - padTop - padBot);

  const minV = spec.minVal;
  const maxV = Math.max(minV + 1e-3, spec.maxVal);
  const spanV = maxV - minV;

  const titleSize = Math.max(9, Math.round(15 * s * (0.78 + 0.22 * compact)));
  ctx.font = `700 ${titleSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(203, 213, 225, 0.88)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = y + padTop * 0.54;
  ctx.fillText(spec.title, plotX, headerY);

  ctx.textAlign = 'right';
  ctx.fillStyle = spec.color;
  ctx.fillText(spec.rightSummary, x + w - padX, headerY);

  const pointXY = (idx) => {
    const px = plotX + (idx / (samples.length - 1)) * plotW;
    const raw = spec.getValue(samples[idx]);
    const val = raw === null || raw === undefined || !Number.isFinite(raw) ? minV : raw;
    const normY = (val - minV) / spanV;
    const py = plotY + plotH - clamp(normY, 0, 1) * plotH;
    return [px, py];
  };

  // Full ghost curve
  ctx.beginPath();
  for (let i = 0; i < samples.length; i += 2) {
    const [px, py] = pointXY(i);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  const [lastX, lastY] = pointXY(samples.length - 1);
  ctx.lineTo(lastX, lastY);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = Math.max(1.4, 2 * s);
  ctx.stroke();

  // Traced active fill + line up to routeProgress
  const activeCount = Math.max(1, Math.round(frameState.routeProgress * (samples.length - 1)));
  ctx.save();
  ctx.beginPath();
  const [startX, startY] = pointXY(0);
  ctx.moveTo(startX, plotY + plotH);
  ctx.lineTo(startX, startY);
  for (let i = 1; i <= activeCount; i += 1) {
    const [px, py] = pointXY(i);
    ctx.lineTo(px, py);
  }
  const [curX, curY] = pointXY(activeCount);
  ctx.lineTo(curX, plotY + plotH);
  ctx.closePath();

  const { areaFill, curveStroke } = buildChartPaint(ctx, { plotX, plotY, plotW, plotH, samples, timeline, spec });
  ctx.fillStyle = areaFill;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  for (let i = 1; i <= activeCount; i += 1) {
    const [px, py] = pointXY(i);
    ctx.lineTo(px, py);
  }
  ctx.strokeStyle = curveStroke;
  ctx.lineWidth = Math.max(2, 3.2 * s);
  ctx.stroke();
  ctx.restore();

  // Current dot
  ctx.beginPath();
  ctx.arc(curX, curY, Math.max(5, 8.5 * s * compact), 0, Math.PI * 2);
  ctx.fillStyle = `${spec.color}55`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(curX, curY, Math.max(2.8, 4.2 * s * compact), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = Math.max(1.5, 2.2 * s);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function buildChartSpecs(timeline, frameState, settings, { sport, units, colorMode }) {
  const chartSpecs = [];
  const trackColor = getSampleColor(frameState.telemetry, timeline, colorMode);
  const isHeatmap = isHeatmapColorMode(colorMode);

  if (settings.showElevationChart !== false) {
    const minFmt = formatElevation(timeline.bounds.minEle, units);
    const maxFmt = formatElevation(timeline.bounds.maxEle, units);
    const gradeSign = frameState.telemetry.gradePct >= 0 ? '+' : '';
    const gradeStr = `${gradeSign}${frameState.telemetry.gradePct.toFixed(1)}%`;
    chartSpecs.push({
      title: 'ELEVATION PROFILE',
      rightSummary: `${gradeStr} GRADE · ${minFmt.value}–${maxFmt.value} ${maxFmt.unit}`,
      color: trackColor,
      colorMode,
      isHeatmap,
      minVal: timeline.bounds.minEle,
      maxVal: timeline.bounds.maxEle,
      getValue: (sample) => sample.ele
    });
  }

  if (settings.showSpeedChart === true) {
    const spdMult = units === 'imperial' ? 2.236936 : 3.6;
    const spdUnit = units === 'imperial' ? 'mph' : 'km/h';
    const livePace = formatPaceOrSpeed(frameState.telemetry.speed, sport, units);
    const maxSpd = timeline.maxSpeed * spdMult;
    chartSpecs.push({
      title: isCyclingSport(sport) ? 'SPEED PROFILE' : 'SPEED / PACE',
      rightSummary: `${livePace.value} ${livePace.unit} · MAX ${maxSpd.toFixed(1)} ${spdUnit}`,
      color: trackColor,
      colorMode,
      isHeatmap,
      minVal: Math.max(0, timeline.minSpeed * spdMult * 0.85),
      maxVal: Math.max(2, maxSpd),
      getValue: (sample) => (sample.speed ?? 0) * spdMult
    });
  }

  if (settings.showHeartRateChart === true && timeline.hasHeartRate) {
    const minHr = Math.max(40, timeline.minHr - 5);
    const maxHr = Math.max(minHr + 15, timeline.maxHr + 5);
    const curHr = Math.round(frameState.telemetry.hr ?? timeline.avgHr ?? 0);
    chartSpecs.push({
      title: 'HEART RATE',
      rightSummary: `♥ ${curHr} bpm · ${Math.round(timeline.minHr)}–${Math.round(timeline.maxHr)} bpm`,
      color: trackColor,
      colorMode,
      isHeatmap,
      minVal: minHr,
      maxVal: maxHr,
      getValue: (sample) => sample.hr
    });
  }

  return chartSpecs;
}

function drawChartStack(ctx, { width, height, sidePad, bottomMargin, isReels, chartSpecs, timeline, frameState, s }) {
  if (chartSpecs.length === 0) return;

  const n = chartSpecs.length;
  if (width / height > 1.2) {
    const gap = 14 * s;
    const totalW = n === 1 ? Math.min(width - sidePad * 2, 760 * s) : width - sidePad * 2;
    const cardW = (totalW - gap * (n - 1)) / n;
    const cardH = Math.round(136 * s);
    const chartY = height - bottomMargin - cardH;
    chartSpecs.forEach((spec, idx) => {
      drawTelemetryChartCard(ctx, sidePad + idx * (cardW + gap), chartY, cardW, cardH, spec, timeline, frameState, s);
    });
    return;
  }

  const rightReserve = isReels ? Math.round(width * 0.14) : sidePad;
  const cardW = isReels
    ? width - sidePad - Math.max(sidePad, rightReserve + 12 * s)
    : Math.min(width - sidePad * 2, 760 * s);
  const gap = Math.round(10 * s);
  const cardH = n === 1 ? Math.round(144 * s) : n === 2 ? Math.round(106 * s) : Math.round(84 * s);
  const totalStackH = n * cardH + (n - 1) * gap;
  const topStackY = height - bottomMargin - totalStackH;

  chartSpecs.forEach((spec, idx) => {
    drawTelemetryChartCard(ctx, sidePad, topStackY + idx * (cardH + gap), cardW, cardH, spec, timeline, frameState, s);
  });
}

function drawFinaleSummaryCard(ctx, { width, height, timeline, alpha, accent, sport, units, s }) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);

  const cardW = Math.min(width * 0.86, 680 * s);
  const cardH = Math.round(236 * s);
  const cx = (width - cardW) / 2;
  const cy = (height - cardH) / 2 + (1 - alpha) * 24 * s;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 32 * s;
  ctx.fillStyle = 'rgba(11, 14, 20, 0.88)';
  roundRectPath(ctx, cx, cy, cardW, cardH, 24 * s);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = Math.max(1, 1.8 * s);
  ctx.stroke();

  ctx.fillStyle = accent;
  roundRectPath(ctx, cx + 28 * s, cy + 27 * s, 44 * s, 5 * s, 3 * s);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.font = `700 ${Math.round(17 * s)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ACTIVITY COMPLETE', cx + 82 * s, cy + 30 * s);

  const distFmt = formatDistance(timeline.totalDistanceM, units);
  const gainFmt = formatElevation(timeline.totalElevationGainM, units);
  const durFmt = formatDuration(timeline.movingTimeSec);
  const avgPace = formatPaceOrSpeed(timeline.avgSpeedMps, sport || timeline.sport, units);

  const stats = [
    { label: 'DISTANCE', val: `${distFmt.value} ${distFmt.unit}` },
    { label: 'ELEV GAIN', val: `${gainFmt.value} ${gainFmt.unit}` },
    { label: 'MOVING TIME', val: durFmt },
    { label: `AVG ${avgPace.label}`, val: `${avgPace.value} ${avgPace.unit}` }
  ];

  const colW = (cardW - 56 * s) / 2;
  const startY = cy + 78 * s;
  const rowH = 76 * s;

  stats.forEach((st, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const sx = cx + 28 * s + col * colW;
    const sy = startY + row * rowH;

    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = `700 ${Math.round(15 * s)}px Inter, system-ui, sans-serif`;
    ctx.fillText(st.label, sx, sy);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(32 * s)}px Inter, system-ui, sans-serif`;
    ctx.fillText(st.val, sx, sy + 32 * s);
  });

  ctx.restore();
}

/**
 * Renders the broadcast telemetry HUD onto a 2D canvas context.
 */
export function renderHud(
  ctx,
  {
    width,
    height,
    timeline,
    frameState,
    settings = {},
    projectPoint = null,
    mapCanvas = null,
    motionFlow = null,
    isExporting = false,
    clear = true
  }
) {
  if (clear) {
    ctx.clearRect(0, 0, width, height);
  }
  if (!timeline || !frameState) return;

  if (motionFlow && mapCanvas) {
    drawMotionBlurTaps(ctx, mapCanvas, motionFlow, width, height, { includeBaseTap: false });
  }

  const s = Math.min(width, height) / 1080;
  const isReels = settings.presetId === 'reels_9_16' || height / width > 1.5;
  const colorMode = settings.colorMode || 'orange';
  const accent = COLOR_ACCENTS[colorMode] || '#FC4C02';
  const units = settings.units || 'metric';
  const sport = settings.sport || timeline.sport || 'Running';
  const title = (settings.title || timeline.title || '3D Flyover').trim();

  drawRouteSceneOverlay(ctx, { width, height, timeline, frameState, settings, projectPoint, s });
  drawScrims(ctx, width, height);

  const sidePad = Math.round((isReels ? 48 : 42) * s);
  const topY = isReels ? Math.round(height * 0.115) : Math.round(38 * s);
  const bottomMargin = isReels ? Math.round(height * 0.178) : Math.round(36 * s);

  let nextTopY = topY;
  if (settings.showHeader !== false) {
    nextTopY += drawHeaderPill(ctx, {
      width,
      sidePad,
      topY: nextTopY,
      isReels,
      title,
      sport,
      startTimeIso: timeline.startTimeIso,
      accent,
      s
    });
  }

  if (settings.showStats !== false) {
    drawStatsGrid(ctx, {
      width,
      sidePad,
      topY: nextTopY,
      isReels,
      timeline,
      frameState,
      sport,
      units,
      accent,
      s
    });
  }

  const chartSpecs = buildChartSpecs(timeline, frameState, settings, { sport, units, colorMode });
  drawChartStack(ctx, { width, height, sidePad, bottomMargin, isReels, chartSpecs, timeline, frameState, s });

  if (settings.showSummaryCard !== false && frameState.outroSummaryAlpha > 0.01) {
    drawFinaleSummaryCard(ctx, {
      width,
      height,
      timeline,
      alpha: frameState.outroSummaryAlpha,
      accent,
      sport,
      units,
      s
    });
  }

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = `700 ${Math.round(14 * s)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('FLYOVER STUDIO · 3D', width - sidePad, topY - (isReels ? 16 * s : 18 * s));
  ctx.restore();

  if (settings.showSafeZones && !isExporting) {
    drawSafeZoneOverlay(ctx, width, height, settings.presetId, s);
  }
}
