import { INSTAGRAM_PRESETS } from './flyover-math.mjs';

export const DEFAULT_STUDIO_STATE = Object.freeze({
  activity: null,
  timeline: null,
  presetId: 'reels_9_16',
  quality: 'full', // 'full' | 'fast'
  durationSec: 30,
  fps: 30,
  mapStyle: 'satellite',
  showLabels: true,
  showSplits: true,
  splitUnit: 'km',
  showSplitUnitText: true,
  splitLabelSize: 2.0,
  splitInterval: 1,
  splitLeadAheadSec: 0.2,
  splitFadeInSec: 0.6,
  tailFade: true,
  glowIntensity: 1.2,
  trackSmoothness: 0.4,
  exaggeration: 1.4,
  colorMode: 'orange',
  cameraMode: 'chase',
  pitch: 54,
  zoomOffset: 0,
  motionBlur: 45,
  units: 'metric',
  title: '',
  sport: 'Running',
  trimStart: 0,
  trimEnd: 1,
  showHeader: true,
  showStats: true,
  showElevationChart: false,
  showSpeedChart: true,
  showHeartRateChart: true,
  showSummaryCard: true,
  showSafeZones: false,
  videoProgress: 0.28,
  isPlaying: false,
  playbackRate: 1,
  isExporting: false,
  lastExportResult: null
});

const RENDER_SETTING_KEYS = [
  'durationSec',
  'fps',
  'mapStyle',
  'showLabels',
  'showSplits',
  'splitUnit',
  'showSplitUnitText',
  'splitLabelSize',
  'splitInterval',
  'splitLeadAheadSec',
  'splitFadeInSec',
  'tailFade',
  'glowIntensity',
  'trackSmoothness',
  'exaggeration',
  'colorMode',
  'cameraMode',
  'pitch',
  'zoomOffset',
  'motionBlur',
  'units',
  'title',
  'sport',
  'showHeader',
  'showStats',
  'showElevationChart',
  'showSpeedChart',
  'showHeartRateChart',
  'showSummaryCard',
  'showSafeZones'
];

export function createStudioState() {
  return { ...DEFAULT_STUDIO_STATE };
}

export function getTargetDimensions(state) {
  const preset = INSTAGRAM_PRESETS[state.presetId] || INSTAGRAM_PRESETS.reels_9_16;
  const width = state.quality === 'fast' ? preset.draftWidth : preset.width;
  const height = state.quality === 'fast' ? preset.draftHeight : preset.height;
  return {
    preset,
    width: Math.floor(width / 2) * 2,
    height: Math.floor(height / 2) * 2
  };
}

export function buildRenderSettings(state) {
  const { preset, width, height } = getTargetDimensions(state);
  const settings = {
    presetId: preset.id,
    ratioLabel: preset.ratioLabel,
    stageWidth: width,
    stageHeight: height
  };
  for (const key of RENDER_SETTING_KEYS) {
    settings[key] = state[key];
  }
  return settings;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
