import { parseTcx } from './tcx-parser.mjs';
import {
  buildFlyoverTimeline,
  evaluateFrameAt,
  formatDistance,
  formatDuration,
  formatElevation
} from './flyover-math.mjs';
import { FlyoverMapScene } from './map-scene.mjs';
import { renderHud } from './hud-renderer.mjs';
import { exportInstagramVideo } from './exporter.mjs';
import {
  DEFAULT_TIMELINE_SAMPLES,
  applyActivityToState,
  createStudioState,
  getTargetDimensions,
  buildRenderSettings,
  formatBytes
} from './studio-state.mjs';
import {
  collectStudioElements,
  syncStudioControlsFromState,
  bindStudioControls
} from './dom-bindings.mjs';

const state = createStudioState();
const els = collectStudioElements(document);
const hudCtx = els.hudCanvas.getContext('2d');

let mapScene = null;
let rafId = null;
let lastFrameTs = null;
let activeExportAbort = null;

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove('hidden');
}

function clearError() {
  els.errorBanner.textContent = '';
  els.errorBanner.classList.add('hidden');
}

function updateStageLayout() {
  const { preset, width, height } = getTargetDimensions(state);
  const vpRect = els.stageViewport.getBoundingClientRect();
  const availW = Math.max(200, vpRect.width - 16);
  const availH = Math.max(200, vpRect.height - 16);
  const fitScale = Math.min(availW / width, availH / height, 1);

  els.stageWrapper.style.width = `${Math.round(width * fitScale)}px`;
  els.stageWrapper.style.height = `${Math.round(height * fitScale)}px`;

  els.captureStage.style.width = `${width}px`;
  els.captureStage.style.height = `${height}px`;
  els.captureStage.style.transform = `scale(${fitScale})`;

  if (els.hudCanvas.width !== width || els.hudCanvas.height !== height) {
    els.hudCanvas.width = width;
    els.hudCanvas.height = height;
  }

  if (mapScene) {
    mapScene.resizeStage(width, height);
  }

  els.stageSpecBadge.textContent = `${preset.badge} • ${preset.ratioLabel} • ${width}×${height} • H.264 MP4`;
  els.exportTargetDim.textContent = `${width} × ${height} · ${state.fps} fps`;
}

function updateSummaryStrip() {
  if (!state.timeline) return;
  const distFmt = formatDistance(state.timeline.totalDistanceM, state.units);
  const gainFmt = formatElevation(state.timeline.totalElevationGainM, state.units);
  els.summaryDist.textContent = `${distFmt.value} ${distFmt.unit}`;
  els.summaryGain.textContent = `+${gainFmt.value} ${gainFmt.unit}`;
  els.summaryTime.textContent = formatDuration(state.timeline.movingTimeSec);
}

function updateTransportUi() {
  els.scrubber.value = String(Math.round(state.videoProgress * 1000));
  const curSec = state.videoProgress * state.durationSec;
  els.timeReadout.textContent = `${formatDuration(curSec)} / ${formatDuration(state.durationSec)}`;
  els.iconPlay.classList.toggle('hidden', state.isPlaying);
  els.iconPause.classList.toggle('hidden', !state.isPlaying);
}

function drawHudForCurrentState(frameStateOverride = null) {
  if (!state.timeline || state.isExporting) return;
  const settings = buildRenderSettings(state);
  const frameState = frameStateOverride || evaluateFrameAt(state.timeline, state.videoProgress, settings);
  const motionFlow =
    state.isPlaying && mapScene
      ? mapScene.computeCameraMotionFlow(state.timeline, state.videoProgress, settings, evaluateFrameAt)
      : null;

  renderHud(hudCtx, {
    width: settings.stageWidth,
    height: settings.stageHeight,
    timeline: state.timeline,
    frameState,
    settings,
    projectPoint: mapScene
      ? (lon, lat, ele) =>
          mapScene.project3DPoint(
            lon,
            lat,
            ele,
            frameState.camera,
            frameState.telemetry.ele,
            settings.stageWidth,
            settings.stageHeight
          )
      : null,
    mapCanvas: mapScene ? mapScene.getCanvas() : null,
    motionFlow,
    isExporting: false,
    clear: true
  });
}

function renderCurrentFrame() {
  if (!state.timeline) return;
  const settings = buildRenderSettings(state);
  const frameState = evaluateFrameAt(state.timeline, state.videoProgress, settings);

  if (mapScene) {
    mapScene.applyFrame(frameState, state.timeline, settings);
  }

  drawHudForCurrentState(frameState);
  updateTransportUi();
}

function rebuildTimeline({ resetProgress = false } = {}) {
  if (!state.activity) return;
  state.timeline = buildFlyoverTimeline(state.activity, {
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    numSamples: DEFAULT_TIMELINE_SAMPLES,
    trackSmoothness: state.trackSmoothness
  });
  if (resetProgress) {
    state.videoProgress = 0.28;
  }
  updateSummaryStrip();
  renderCurrentFrame();
}

function loadActivityXml(xmlText, fileName, { samplePath = null } = {}) {
  try {
    clearError();
    const parsed = parseTcx(xmlText, fileName);
    applyActivityToState(state, parsed);
    state.trimStart = 0;
    state.trimEnd = 1;
    state.isPlaying = false;

    els.inputTitle.value = state.title;
    const hasSportOption = [...els.selectSport.options].some((o) => o.value === state.sport);
    els.selectSport.value = hasSportOption ? state.sport : 'Running';

    els.rangeTrimStart.value = '0';
    els.rangeTrimEnd.value = '100';
    els.valTrimStart.textContent = '0%';
    els.valTrimEnd.textContent = '100%';

    els.sampleBtns.forEach((btn) => {
      btn.classList.toggle('active', Boolean(samplePath && btn.dataset.sample === samplePath));
    });

    els.chkHudHr.disabled = !parsed.hasHeartRate;
    els.hrDataBadge.classList.toggle('hidden', parsed.hasHeartRate);
    if (!parsed.hasHeartRate) {
      els.chkHudHr.checked = false;
    }

    rebuildTimeline({ resetProgress: true });
  } catch (err) {
    showError(err?.message || 'Unable to parse TCX file');
  }
}

async function loadSampleFile(samplePath) {
  try {
    const res = await fetch(samplePath);
    if (!res.ok) throw new Error(`Failed to fetch sample (${res.status})`);
    const text = await res.text();
    loadActivityXml(text, samplePath.split('/').pop(), { samplePath });
  } catch (err) {
    showError(err?.message || 'Unable to load sample TCX file');
  }
}

function handleFileObject(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      loadActivityXml(reader.result, file.name);
    }
  };
  reader.onerror = () => showError(`Could not read file "${file.name}"`);
  reader.readAsText(file);
}

function startPlaybackLoop() {
  if (rafId !== null) return;
  lastFrameTs = performance.now();

  const tick = (now) => {
    if (!state.isPlaying || state.isExporting) {
      rafId = null;
      return;
    }
    const dtSec = Math.min(0.1, (now - lastFrameTs) / 1000);
    lastFrameTs = now;

    state.videoProgress += (dtSec * state.playbackRate) / state.durationSec;
    if (state.videoProgress >= 1) {
      state.videoProgress = 1;
      state.isPlaying = false;
      renderCurrentFrame();
      rafId = null;
      return;
    }

    renderCurrentFrame();
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

function togglePlayPause() {
  if (state.isExporting || !state.timeline) return;
  if (state.isPlaying) {
    state.isPlaying = false;
    updateTransportUi();
    return;
  }
  if (state.videoProgress >= 0.995) {
    state.videoProgress = 0;
  }
  state.isPlaying = true;
  updateTransportUi();
  startPlaybackLoop();
}

function restartPlayback() {
  state.videoProgress = 0;
  state.isPlaying = true;
  updateTransportUi();
  renderCurrentFrame();
  startPlaybackLoop();
}

async function runExport() {
  if (state.isExporting || !state.timeline || !mapScene) return;

  state.isPlaying = false;
  state.isExporting = true;
  updateTransportUi();
  clearError();

  els.btnExportMp4.disabled = true;
  els.exportOverlay.classList.remove('hidden');
  els.exportProgressFill.style.width = '1%';
  els.exportProgressPct.textContent = '1%';
  els.exportProgressMsg.textContent = 'Preparing 3D stage…';

  activeExportAbort = new AbortController();

  try {
    const result = await exportInstagramVideo({
      timeline: state.timeline,
      settings: buildRenderSettings(state),
      mapScene,
      evaluateFrameFn: evaluateFrameAt,
      renderHudFn: renderHud,
      abortSignal: activeExportAbort.signal,
      onProgress: ({ percent, message }) => {
        const pct = Math.max(0, Math.min(100, Math.round(percent)));
        els.exportProgressFill.style.width = `${pct}%`;
        els.exportProgressPct.textContent = `${pct}%`;
        els.exportProgressMsg.textContent = message;
      }
    });

    state.lastExportResult = result;
    els.exportPreviewVideo.src = result.videoUrl;
    els.exportPreviewVideo.load();
    els.downloadMp4Btn.href = result.downloadUrl;
    els.downloadMp4Btn.setAttribute('download', result.filename);
    els.modalRes.textContent = `${result.width}×${result.height} · ${result.fps}fps · ${result.durationSec}s`;
    els.modalSize.textContent = formatBytes(result.sizeBytes);
    els.btnWebShare.classList.toggle('hidden', typeof navigator.canShare !== 'function');
    els.exportModal.classList.remove('hidden');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showError(err?.message || 'Video export failed');
    }
  } finally {
    state.isExporting = false;
    activeExportAbort = null;
    els.btnExportMp4.disabled = false;
    els.exportOverlay.classList.add('hidden');
    renderCurrentFrame();
  }
}

async function shareLastExport() {
  if (!state.lastExportResult) return;
  try {
    const res = await fetch(state.lastExportResult.videoUrl);
    const blob = await res.blob();
    const file = new File([blob], state.lastExportResult.filename, { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: state.title || '3D Flyover Video' });
    }
  } catch {
    // User dismissed share sheet
  }
}

async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('offline');
    const data = await res.json();
    els.encoderPill.textContent = `H.264 MP4 Ready (${data.encoder})`;
    els.encoderPill.classList.add('ready');
  } catch {
    els.encoderPill.textContent = 'Browser WebCodecs Mode';
  }
}

async function bootstrap() {
  syncStudioControlsFromState(els, state);
  bindStudioControls(els, state, {
    onFileSelected: handleFileObject,
    onLoadSample: loadSampleFile,
    renderCurrentFrame,
    updateSummaryStrip,
    updateStageLayout,
    updateTransportUi,
    rebuildTimeline,
    updateMapStyle: (patch) => (mapScene ? mapScene.updateMapStyle(patch) : Promise.resolve()),
    togglePlayPause,
    restartPlayback,
    runExport,
    cancelExport: () => activeExportAbort?.abort(),
    shareLastExport
  });

  checkBackendHealth();
  updateStageLayout();

  try {
    mapScene = new FlyoverMapScene(els.mapCanvasWrap, {
      mapStyle: state.mapStyle,
      showLabels: state.showLabels,
      exaggeration: state.exaggeration
    });
    mapScene.setRenderListener(() => drawHudForCurrentState());
    updateStageLayout();
    await loadSampleFile('samples/marin-headlands-trail-run.tcx');
    await mapScene.waitUntilLoaded();
    renderCurrentFrame();
  } catch (err) {
    showError(err?.message || 'Failed to initialize 3D map engine');
  }
}

bootstrap();
