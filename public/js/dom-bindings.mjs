export function formatSplitLeadLabel(sec) {
  if (Math.abs(sec) < 0.05) return 'At head (0.0s)';
  return sec > 0 ? `+${sec.toFixed(1)}s ahead` : `${Math.abs(sec).toFixed(1)}s after`;
}

const SLIDER_FORMATTERS = Object.freeze({
  splitLabelSize: (v) => `${v.toFixed(1)}x`,
  splitLeadAheadSec: formatSplitLeadLabel,
  splitFadeInSec: (v) => `${v.toFixed(1)}s`,
  exaggeration: (v) => `${v.toFixed(1)}x`,
  glowIntensity: (v) => `${v.toFixed(1)}x`,
  trackSmoothness: (v) => `${v.toFixed(1)}x`,
  pitch: (v) => `${v}°`,
  zoomOffset: (v) => v.toFixed(1),
  motionBlur: (v) => `${v}%`
});

export function syncStudioControlsFromState(els, state) {
  const sliders = [
    [els.rangeSplitSize, els.valSplitSize, 'splitLabelSize'],
    [els.rangeSplitLead, els.valSplitLead, 'splitLeadAheadSec'],
    [els.rangeSplitFade, els.valSplitFade, 'splitFadeInSec'],
    [els.rangeExaggeration, els.valExaggeration, 'exaggeration'],
    [els.rangeGlowIntensity, els.valGlowIntensity, 'glowIntensity'],
    [els.rangeTrackSmooth, els.valTrackSmooth, 'trackSmoothness'],
    [els.rangePitch, els.valPitch, 'pitch'],
    [els.rangeZoomOffset, els.valZoomOffset, 'zoomOffset'],
    [els.rangeMotionBlur, els.valMotionBlur, 'motionBlur']
  ];
  for (const [rangeEl, valueEl, key] of sliders) {
    if (!rangeEl) continue;
    rangeEl.value = String(state[key]);
    if (valueEl) valueEl.textContent = SLIDER_FORMATTERS[key](Number(state[key]));
  }

  const checkboxes = [
    [els.chkLabels, 'showLabels'],
    [els.chkSplits, 'showSplits'],
    [els.chkSplitShowUnit, 'showSplitUnitText'],
    [els.chkTailFade, 'tailFade'],
    [els.chkHudHeader, 'showHeader'],
    [els.chkHudStats, 'showStats'],
    [els.chkHudElevation, 'showElevationChart'],
    [els.chkHudSpeed, 'showSpeedChart'],
    [els.chkHudHr, 'showHeartRateChart'],
    [els.chkHudSummary, 'showSummaryCard']
  ];
  for (const [el, key] of checkboxes) {
    if (el) el.checked = Boolean(state[key]);
  }
  if (els.splitLabelControls) {
    els.splitLabelControls.classList.toggle('disabled', !state.showSplits);
  }

  const selects = [
    [els.selectUnits, 'units'],
    [els.selectSplitInterval, 'splitInterval'],
    [els.selectColorMode, 'colorMode'],
    [els.selectCameraMode, 'cameraMode'],
    [els.selectPlaybackRate, 'playbackRate'],
    [els.selectDuration, 'durationSec'],
    [els.selectFps, 'fps']
  ];
  for (const [el, key] of selects) {
    if (el) el.value = String(state[key]);
  }

  const buttonGroups = [
    [els.styleCards, 'style', 'mapStyle'],
    [els.splitUnitBtns, 'splitUnit', 'splitUnit'],
    [els.presetCards, 'preset', 'presetId'],
    [els.qualityBtns, 'quality', 'quality']
  ];
  for (const [buttons, dataKey, stateKey] of buttonGroups) {
    if (!buttons) continue;
    buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset[dataKey] === state[stateKey]));
  }
}

export function collectStudioElements(doc = document) {
  const byId = (id) => doc.getElementById(id);
  const all = (selector) => [...doc.querySelectorAll(selector)];

  return {
    encoderPill: byId('encoder-pill'),
    dropZone: byId('drop-zone'),
    fileInput: byId('tcx-file-input'),
    sampleBtns: all('.sample-btn'),
    errorBanner: byId('error-banner'),
    summaryDist: byId('summary-dist'),
    summaryGain: byId('summary-gain'),
    summaryTime: byId('summary-time'),
    inputTitle: byId('input-title'),
    selectSport: byId('select-sport'),
    selectUnits: byId('select-units'),
    rangeTrimStart: byId('range-trim-start'),
    rangeTrimEnd: byId('range-trim-end'),
    valTrimStart: byId('val-trim-start'),
    valTrimEnd: byId('val-trim-end'),
    styleCards: all('.style-card'),
    chkLabels: byId('chk-labels'),
    chkSplits: byId('chk-splits'),
    splitLabelControls: byId('split-label-controls'),
    splitUnitBtns: all('#split-unit-segmented .seg-btn'),
    selectSplitInterval: byId('select-split-interval'),
    chkSplitShowUnit: byId('chk-split-show-unit'),
    rangeSplitSize: byId('range-split-size'),
    valSplitSize: byId('val-split-size'),
    rangeSplitLead: byId('range-split-lead'),
    valSplitLead: byId('val-split-lead'),
    rangeSplitFade: byId('range-split-fade'),
    valSplitFade: byId('val-split-fade'),
    chkTailFade: byId('chk-tail-fade'),
    rangeExaggeration: byId('range-exaggeration'),
    valExaggeration: byId('val-exaggeration'),
    selectColorMode: byId('select-color-mode'),
    rangeGlowIntensity: byId('range-glow-intensity'),
    valGlowIntensity: byId('val-glow-intensity'),
    rangeTrackSmooth: byId('range-track-smooth'),
    valTrackSmooth: byId('val-track-smooth'),
    selectCameraMode: byId('select-camera-mode'),
    rangePitch: byId('range-pitch'),
    valPitch: byId('val-pitch'),
    rangeZoomOffset: byId('range-zoom-offset'),
    valZoomOffset: byId('val-zoom-offset'),
    rangeMotionBlur: byId('range-motion-blur'),
    valMotionBlur: byId('val-motion-blur'),
    stageSpecBadge: byId('stage-spec-badge'),
    btnSafeZones: byId('btn-safe-zones'),
    stageViewport: byId('stage-viewport'),
    stageWrapper: byId('stage-wrapper'),
    captureStage: byId('capture-stage'),
    mapCanvasWrap: byId('map-canvas-wrap'),
    hudCanvas: byId('hud-canvas'),
    exportOverlay: byId('export-overlay'),
    exportProgressMsg: byId('export-progress-msg'),
    exportProgressFill: byId('export-progress-fill'),
    exportProgressPct: byId('export-progress-pct'),
    btnCancelExport: byId('btn-cancel-export'),
    btnPlayPause: byId('btn-play-pause'),
    iconPlay: byId('icon-play'),
    iconPause: byId('icon-pause'),
    btnRestart: byId('btn-restart'),
    scrubber: byId('timeline-scrubber'),
    timeReadout: byId('time-readout'),
    selectPlaybackRate: byId('select-playback-rate'),
    presetCards: all('.preset-card'),
    chkHudHeader: byId('chk-hud-header'),
    chkHudStats: byId('chk-hud-stats'),
    chkHudElevation: byId('chk-hud-elevation'),
    chkHudSpeed: byId('chk-hud-speed'),
    chkHudHr: byId('chk-hud-hr'),
    hrDataBadge: byId('hr-data-badge'),
    chkHudSummary: byId('chk-hud-summary'),
    qualityBtns: all('#quality-segmented .seg-btn'),
    selectDuration: byId('select-duration'),
    selectFps: byId('select-fps'),
    exportTargetDim: byId('export-target-dim'),
    btnExportMp4: byId('btn-export-mp4'),
    exportModal: byId('export-modal'),
    btnCloseModal: byId('btn-close-modal'),
    exportPreviewVideo: byId('export-preview-video'),
    modalRes: byId('modal-res'),
    modalSize: byId('modal-size'),
    downloadMp4Btn: byId('download-mp4-btn'),
    btnWebShare: byId('btn-web-share')
  };
}

function bindSlider(rangeEl, valueEl, state, key, formatValue, onChange) {
  rangeEl.addEventListener('input', async () => {
    const num = Number(rangeEl.value);
    state[key] = num;
    if (valueEl) valueEl.textContent = formatValue(num);
    await onChange(num);
  });
}

function bindCheckbox(el, state, key, onChange) {
  el.addEventListener('change', async () => {
    state[key] = el.checked;
    await onChange(el.checked);
  });
}

function bindSelect(el, state, key, { numeric = false, onChange }) {
  el.addEventListener('change', () => {
    state[key] = numeric ? Number(el.value) : el.value;
    onChange(state[key]);
  });
}

function bindButtonGroup(buttons, dataKey, state, stateKey, onChange) {
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      state[stateKey] = btn.dataset[dataKey];
      buttons.forEach((item) => item.classList.toggle('active', item === btn));
      await onChange(state[stateKey]);
    });
  });
}

function bindFileDropZone(dropZone, fileInput, onFile) {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

export function bindStudioControls(els, state, actions) {
  // 1. File Upload & Samples
  bindFileDropZone(els.dropZone, els.fileInput, actions.onFileSelected);
  els.sampleBtns.forEach((btn) => {
    btn.addEventListener('click', () => actions.onLoadSample(btn.dataset.sample));
  });

  // 2. Activity Details & Trim
  els.inputTitle.addEventListener('input', () => {
    state.title = els.inputTitle.value;
    actions.renderCurrentFrame();
  });
  bindSelect(els.selectSport, state, 'sport', { onChange: actions.renderCurrentFrame });

  els.selectUnits.addEventListener('change', () => {
    state.units = els.selectUnits.value;
    state.splitUnit = state.units === 'imperial' ? 'mi' : 'km';
    els.splitUnitBtns.forEach((b) => {
      b.classList.toggle('active', b.dataset.splitUnit === state.splitUnit);
    });
    actions.updateSummaryStrip();
    actions.renderCurrentFrame();
  });

  els.rangeTrimStart.addEventListener('input', () => {
    let startPct = Number(els.rangeTrimStart.value);
    const endPct = Number(els.rangeTrimEnd.value);
    if (startPct > endPct - 5) {
      startPct = endPct - 5;
      els.rangeTrimStart.value = String(startPct);
    }
    state.trimStart = startPct / 100;
    els.valTrimStart.textContent = `${startPct}%`;
    actions.rebuildTimeline({ resetProgress: false });
  });

  els.rangeTrimEnd.addEventListener('input', () => {
    const startPct = Number(els.rangeTrimStart.value);
    let endPct = Number(els.rangeTrimEnd.value);
    if (endPct < startPct + 5) {
      endPct = startPct + 5;
      els.rangeTrimEnd.value = String(endPct);
    }
    state.trimEnd = endPct / 100;
    els.valTrimEnd.textContent = `${endPct}%`;
    actions.rebuildTimeline({ resetProgress: false });
  });

  // 3. Map Style, Split Labels & Track Styling
  bindButtonGroup(els.styleCards, 'style', state, 'mapStyle', async (mapStyle) => {
    await actions.updateMapStyle({ mapStyle });
    actions.renderCurrentFrame();
  });

  bindCheckbox(els.chkLabels, state, 'showLabels', async (showLabels) => {
    await actions.updateMapStyle({ showLabels });
    actions.renderCurrentFrame();
  });

  bindCheckbox(els.chkSplits, state, 'showSplits', (showSplits) => {
    els.splitLabelControls.classList.toggle('disabled', !showSplits);
    actions.renderCurrentFrame();
  });

  bindButtonGroup(els.splitUnitBtns, 'splitUnit', state, 'splitUnit', actions.renderCurrentFrame);
  bindSelect(els.selectSplitInterval, state, 'splitInterval', { numeric: true, onChange: actions.renderCurrentFrame });
  bindCheckbox(els.chkSplitShowUnit, state, 'showSplitUnitText', actions.renderCurrentFrame);
  bindSlider(els.rangeSplitSize, els.valSplitSize, state, 'splitLabelSize', SLIDER_FORMATTERS.splitLabelSize, actions.renderCurrentFrame);
  bindSlider(els.rangeSplitLead, els.valSplitLead, state, 'splitLeadAheadSec', SLIDER_FORMATTERS.splitLeadAheadSec, actions.renderCurrentFrame);
  bindSlider(els.rangeSplitFade, els.valSplitFade, state, 'splitFadeInSec', SLIDER_FORMATTERS.splitFadeInSec, actions.renderCurrentFrame);
  bindCheckbox(els.chkTailFade, state, 'tailFade', actions.renderCurrentFrame);

  bindSlider(els.rangeExaggeration, els.valExaggeration, state, 'exaggeration', SLIDER_FORMATTERS.exaggeration, async (exaggeration) => {
    await actions.updateMapStyle({ exaggeration });
    actions.renderCurrentFrame();
  });

  bindSelect(els.selectColorMode, state, 'colorMode', { onChange: actions.renderCurrentFrame });
  bindSlider(els.rangeGlowIntensity, els.valGlowIntensity, state, 'glowIntensity', SLIDER_FORMATTERS.glowIntensity, actions.renderCurrentFrame);
  bindSlider(els.rangeTrackSmooth, els.valTrackSmooth, state, 'trackSmoothness', SLIDER_FORMATTERS.trackSmoothness, () =>
    actions.rebuildTimeline({ resetProgress: false })
  );

  // 4. Camera Choreography
  bindSelect(els.selectCameraMode, state, 'cameraMode', { onChange: actions.renderCurrentFrame });
  bindSlider(els.rangePitch, els.valPitch, state, 'pitch', SLIDER_FORMATTERS.pitch, actions.renderCurrentFrame);
  bindSlider(els.rangeZoomOffset, els.valZoomOffset, state, 'zoomOffset', SLIDER_FORMATTERS.zoomOffset, actions.renderCurrentFrame);
  bindSlider(els.rangeMotionBlur, els.valMotionBlur, state, 'motionBlur', SLIDER_FORMATTERS.motionBlur, actions.renderCurrentFrame);

  // 5. Safe Zones & Transport
  els.btnSafeZones.addEventListener('click', () => {
    state.showSafeZones = !state.showSafeZones;
    els.btnSafeZones.setAttribute('aria-pressed', String(state.showSafeZones));
    actions.renderCurrentFrame();
  });
  els.btnPlayPause.addEventListener('click', actions.togglePlayPause);
  els.btnRestart.addEventListener('click', actions.restartPlayback);
  els.scrubber.addEventListener('input', () => {
    state.isPlaying = false;
    state.videoProgress = Number(els.scrubber.value) / 1000;
    actions.renderCurrentFrame();
  });
  bindSelect(els.selectPlaybackRate, state, 'playbackRate', { numeric: true, onChange: () => {} });

  // 6. Instagram Format Presets, Quality & Export Settings
  const onStageConfigChange = () => {
    actions.updateStageLayout();
    actions.renderCurrentFrame();
  };
  bindButtonGroup(els.presetCards, 'preset', state, 'presetId', onStageConfigChange);
  bindButtonGroup(els.qualityBtns, 'quality', state, 'quality', onStageConfigChange);
  bindSelect(els.selectDuration, state, 'durationSec', { numeric: true, onChange: actions.updateTransportUi });
  bindSelect(els.selectFps, state, 'fps', { numeric: true, onChange: actions.updateStageLayout });

  // 7. HUD Overlays
  const hudToggles = [
    [els.chkHudHeader, 'showHeader'],
    [els.chkHudStats, 'showStats'],
    [els.chkHudElevation, 'showElevationChart'],
    [els.chkHudSpeed, 'showSpeedChart'],
    [els.chkHudHr, 'showHeartRateChart'],
    [els.chkHudSummary, 'showSummaryCard']
  ];
  for (const [el, key] of hudToggles) {
    bindCheckbox(el, state, key, actions.renderCurrentFrame);
  }

  // 8. Export, Modal & Share
  els.btnExportMp4.addEventListener('click', actions.runExport);
  els.btnCancelExport.addEventListener('click', actions.cancelExport);

  const closeModal = () => {
    els.exportPreviewVideo.pause();
    els.exportModal.classList.add('hidden');
  };
  els.btnCloseModal.addEventListener('click', closeModal);
  els.exportModal.addEventListener('click', (e) => {
    if (e.target === els.exportModal) closeModal();
  });
  els.btnWebShare.addEventListener('click', actions.shareLastExport);

  // 9. Keyboard & Resize
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      actions.togglePlayPause();
    }
  });

  const observer = new ResizeObserver(onStageConfigChange);
  observer.observe(els.stageViewport);
}
