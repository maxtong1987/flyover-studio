import fs from 'node:fs/promises';
import path from 'node:path';
import { INSTAGRAM_PRESETS } from '../public/js/flyover-math.mjs';
import { COLOR_ACCENTS } from '../public/js/canvas-utils.mjs';
import {
  DEFAULT_STUDIO_STATE,
  RENDER_SETTING_KEYS,
  createStudioState
} from '../public/js/studio-state.mjs';

export const DEFAULT_BROWSERS_DIR_NAME = '.playwright-browsers';

export function resolvePlaywrightBrowsersPath(rootDir, env = process.env) {
  return env.PLAYWRIGHT_BROWSERS_PATH || path.join(rootDir, DEFAULT_BROWSERS_DIR_NAME);
}

export const VALID_ENUMS = Object.freeze({
  presetId: Object.keys(INSTAGRAM_PRESETS),
  quality: ['full', 'fast'],
  mapStyle: ['satellite', 'dark', 'topo', 'light'],
  colorMode: Object.keys(COLOR_ACCENTS),
  cameraMode: ['chase', 'orbit', 'overview'],
  units: ['metric', 'imperial'],
  splitUnit: ['km', 'mi'],
  webgl: ['auto', 'gpu', 'swiftshader']
});

export const CONFIGURABLE_STATE_KEYS = Object.freeze([
  'presetId',
  'quality',
  ...RENDER_SETTING_KEYS.filter((key) => key !== 'showSafeZones'),
  'trimStart',
  'trimEnd'
]);

const VALUE_FLAG_MAP = Object.freeze({
  '-i': ['input', 'string'],
  '--input': ['input', 'string'],
  '-c': ['configPath', 'string'],
  '--config': ['configPath', 'string'],
  '-o': ['outputPath', 'string'],
  '--out': ['outputPath', 'string'],
  '--output': ['outputPath', 'string'],
  '--preset': ['presetId', 'string'],
  '--quality': ['quality', 'string'],
  '--duration': ['durationSec', 'number'],
  '--fps': ['fps', 'number'],
  '--map-style': ['mapStyle', 'string'],
  '--color': ['colorMode', 'string'],
  '--camera': ['cameraMode', 'string'],
  '--pitch': ['pitch', 'number'],
  '--zoom-offset': ['zoomOffset', 'number'],
  '--exaggeration': ['exaggeration', 'number'],
  '--glow': ['glowIntensity', 'number'],
  '--smooth': ['trackSmoothness', 'number'],
  '--motion-blur': ['motionBlur', 'number'],
  '--units': ['units', 'string'],
  '--title': ['title', 'string'],
  '--sport': ['sport', 'string'],
  '--trim-start': ['trimStart', 'number'],
  '--trim-end': ['trimEnd', 'number'],
  '--split-unit': ['splitUnit', 'string'],
  '--split-size': ['splitLabelSize', 'number'],
  '--split-lead': ['splitLeadAheadSec', 'number'],
  '--split-fade': ['splitFadeInSec', 'number'],
  '--split-interval': ['splitInterval', 'number'],
  '--webgl': ['webgl', 'string'],
  '--browser-executable': ['browserExecutable', 'string']
});

const BOOLEAN_FLAG_MAP = Object.freeze({
  '--labels': ['showLabels', true],
  '--no-labels': ['showLabels', false],
  '--splits': ['showSplits', true],
  '--no-splits': ['showSplits', false],
  '--split-unit-text': ['showSplitUnitText', true],
  '--no-split-unit-text': ['showSplitUnitText', false],
  '--tail-fade': ['tailFade', true],
  '--no-tail-fade': ['tailFade', false],
  '--header': ['showHeader', true],
  '--no-header': ['showHeader', false],
  '--stats': ['showStats', true],
  '--no-stats': ['showStats', false],
  '--elevation-chart': ['showElevationChart', true],
  '--no-elevation-chart': ['showElevationChart', false],
  '--speed-chart': ['showSpeedChart', true],
  '--no-speed-chart': ['showSpeedChart', false],
  '--hr-chart': ['showHeartRateChart', true],
  '--no-hr-chart': ['showHeartRateChart', false],
  '--summary': ['showSummaryCard', true],
  '--no-summary': ['showSummaryCard', false]
});

const NUMERIC_RANGES = Object.freeze({
  durationSec: [5, 180],
  fps: [15, 60],
  splitLabelSize: [0.5, 2.5],
  splitInterval: [1, 50],
  splitLeadAheadSec: [-5, 10],
  splitFadeInSec: [0.05, 5],
  glowIntensity: [0, 2.5],
  trackSmoothness: [0, 2.0],
  exaggeration: [0, 2.5],
  pitch: [0, 60],
  zoomOffset: [-3, 3],
  motionBlur: [0, 100],
  trimStart: [0, 0.95],
  trimEnd: [0.05, 1]
});

export function buildTemplateConfig() {
  const cfg = {};
  for (const key of CONFIGURABLE_STATE_KEYS) {
    cfg[key] = DEFAULT_STUDIO_STATE[key];
  }
  return cfg;
}

export function formatCliHelp() {
  return `Flyover Studio CLI — Render 3D TCX/GPX flyover videos to Instagram-ready H.264 MP4

Usage:
  node cli.mjs <input.tcx> [options]
  node cli.mjs --config flyover.json [--out video.mp4]
  node cli.mjs --init-config [flyover.json]

Core Options:
  -i, --input <file>          Path to .tcx or .gpx activity file (or pass positionally)
  -c, --config <file>         JSON config file with Flyover Studio settings
  -o, --out <file>            Output .mp4 path (default: <input>-<ratio>.mp4)
  --init-config [file]        Write a starter JSON config file (or "-" for stdout)
  --webgl <mode>              WebGL backend: auto (default) | gpu | swiftshader
  --browser-executable <path> Custom Chrome/Chromium binary path
  -q, --quiet                 Suppress progress output
  -h, --help                  Show this help message

Style & Video Overrides (override config.json values):
  --preset <id>               reels_9_16 | portrait_4_5 | square_1_1 | landscape_16_9
  --quality <tier>            full (1080p) | fast (720p)
  --duration <sec>            Video duration in seconds (5–180, default: 30)
  --fps <n>                   Frame rate (15–60, default: 30)
  --map-style <style>         satellite | dark | topo | light
  --color <mode>              orange | pace | elevation | hr | cyan | lime | magenta
  --camera <mode>             chase | orbit | overview
  --pitch <deg>               Camera pitch angle (0–60, default: 54)
  --zoom-offset <n>           Zoom offset (-3.0 to 3.0, default: 0)
  --exaggeration <n>          3D terrain exaggeration (0–2.5, default: 1.4)
  --glow <n>                  Track glow intensity (0–2.5, default: 1.2)
  --smooth <n>                Track smoothness (0–2.0, default: 0.4)
  --motion-blur <0-100>       Camera motion blur percent (default: 45)
  --units <system>            metric | imperial
  --title <text>              Override activity title
  --sport <text>              Override activity sport label
  --trim-start <0-0.95>       Start trim fraction (default: 0)
  --trim-end <0.05-1>         End trim fraction (default: 1)

Split Label & HUD Overrides:
  --split-unit <km|mi>        Distance split unit (default: km)
  --split-size <0.5-2.5>      Split label size multiplier (default: 2.0)
  --split-lead <-5..10>       Split reveal lead time in seconds (default: 0.2)
  --split-fade <0.05..5>      Split fade-in duration in seconds (default: 0.6)
  --split-interval <n>        Show every Nth split (default: 1)
  --[no-]splits               Show/hide split labels
  --[no-]split-unit-text      Show/hide unit suffix ("1 km" vs "1")
  --[no-]labels               Show/hide map place & road labels
  --[no-]tail-fade            Enable/disable comet head-to-tail fade
  --[no-]header               Show/hide activity header card
  --[no-]stats                Show/hide live telemetry cards
  --[no-]elevation-chart      Show/hide elevation profile chart (default: off)
  --[no-]speed-chart          Show/hide speed/pace chart (default: on)
  --[no-]hr-chart             Show/hide heart rate chart (default: on)
  --[no-]summary              Show/hide finale summary card

Examples:
  node cli.mjs public/samples/alpe-dhuez-climb.tcx --quality fast --duration 15 --out alpe.mp4
  node cli.mjs --init-config flyover.json
  node cli.mjs run.tcx --config flyover.json --color cyan --out run-reel.mp4
`;
}

function parseNumericArg(flag, raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error(`Flag ${flag} requires a finite number (got "${raw}")`);
  }
  return num;
}

export function parseCliArgs(argv) {
  const parsed = {
    help: false,
    quiet: false,
    initConfigPath: null,
    input: null,
    configPath: null,
    outputPath: null,
    webgl: 'auto',
    browserExecutable: null,
    overrides: {}
  };

  const stateKeySet = new Set(CONFIGURABLE_STATE_KEYS);

  for (let i = 0; i < argv.length; i += 1) {
    let token = argv[i];
    let inlineVal = null;

    if (token.startsWith('--') && token.includes('=')) {
      const eqIdx = token.indexOf('=');
      inlineVal = token.slice(eqIdx + 1);
      token = token.slice(0, eqIdx);
    }

    if (token === '-h' || token === '--help') {
      parsed.help = true;
      continue;
    }
    if (token === '-q' || token === '--quiet') {
      parsed.quiet = true;
      continue;
    }
    if (token === '--init-config') {
      if (inlineVal !== null) {
        parsed.initConfigPath = inlineVal || 'flyover.config.json';
      } else if (i + 1 < argv.length && (argv[i + 1] === '-' || !argv[i + 1].startsWith('-'))) {
        parsed.initConfigPath = argv[++i];
      } else {
        parsed.initConfigPath = 'flyover.config.json';
      }
      continue;
    }

    if (BOOLEAN_FLAG_MAP[token]) {
      const [key, val] = BOOLEAN_FLAG_MAP[token];
      parsed.overrides[key] = val;
      continue;
    }

    if (VALUE_FLAG_MAP[token]) {
      const [key, type] = VALUE_FLAG_MAP[token];
      const raw = inlineVal !== null ? inlineVal : argv[++i];
      if (raw === undefined) {
        throw new Error(`Missing value for ${token}`);
      }
      const val = type === 'number' ? parseNumericArg(token, raw) : raw;
      if (stateKeySet.has(key)) {
        parsed.overrides[key] = val;
      } else {
        parsed[key] = val;
      }
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Unknown flag: ${token}. Run with --help to see supported options.`);
    }

    if (!parsed.input) {
      parsed.input = token;
    } else {
      throw new Error(`Unexpected positional argument "${token}". Use --out to specify the output file.`);
    }
  }

  return parsed;
}

function validateRenderConfig(state, webgl) {
  for (const [key, allowed] of Object.entries(VALID_ENUMS)) {
    const val = key === 'webgl' ? webgl : state[key];
    if (!allowed.includes(val)) {
      throw new Error(`Invalid ${key} "${val}". Allowed values: ${allowed.join(', ')}`);
    }
  }

  for (const [key, [min, max]] of Object.entries(NUMERIC_RANGES)) {
    const val = Number(state[key]);
    if (!Number.isFinite(val) || val < min || val > max) {
      throw new Error(`Invalid ${key} "${state[key]}". Expected a number between ${min} and ${max}.`);
    }
    state[key] = val;
  }

  if (state.trimEnd - state.trimStart < 0.05) {
    throw new Error(`trimEnd (${state.trimEnd}) must be at least 0.05 greater than trimStart (${state.trimStart}).`);
  }
}

export function resolveDefaultOutputPath(inputPath, presetId) {
  const preset = INSTAGRAM_PRESETS[presetId] || INSTAGRAM_PRESETS.reels_9_16;
  const ratio = preset.ratioLabel.replace(':', 'x');
  const stem = path.basename(inputPath, path.extname(inputPath)) || 'flyover';
  return path.resolve(process.cwd(), `${stem}-${ratio}.mp4`);
}

export async function loadAndResolveCliJob(argv, { cwd = process.cwd() } = {}) {
  const cli = parseCliArgs(argv);
  if (cli.help || cli.initConfigPath !== null) {
    return { ...cli, stateOverrides: null };
  }

  let fileConfig = {};
  let configDir = cwd;
  if (cli.configPath) {
    const absConfig = path.resolve(cwd, cli.configPath);
    configDir = path.dirname(absConfig);
    const rawText = await fs.readFile(absConfig, 'utf8');
    try {
      fileConfig = JSON.parse(rawText);
    } catch (err) {
      throw new Error(`Invalid JSON in config file "${cli.configPath}": ${err.message}`);
    }
    if (!fileConfig || typeof fileConfig !== 'object' || Array.isArray(fileConfig)) {
      throw new Error(`Config file "${cli.configPath}" must contain a JSON object.`);
    }
  }

  const stateKeySet = new Set(CONFIGURABLE_STATE_KEYS);
  const metaKeys = new Set(['input', 'output', 'out', 'webgl', 'browserExecutable', '$schema', 'comment']);
  const unknownKeys = Object.keys(fileConfig).filter((k) => !stateKeySet.has(k) && !metaKeys.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown config key(s) in "${cli.configPath}": ${unknownKeys.join(', ')}`);
  }

  const state = createStudioState();
  const stateOverrides = {};
  for (const key of CONFIGURABLE_STATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fileConfig, key)) {
      state[key] = fileConfig[key];
      stateOverrides[key] = fileConfig[key];
    }
    if (Object.prototype.hasOwnProperty.call(cli.overrides, key)) {
      state[key] = cli.overrides[key];
      stateOverrides[key] = cli.overrides[key];
    }
  }

  // Sync splitUnit with units if units was explicitly overridden without splitUnit
  if (
    (Object.prototype.hasOwnProperty.call(cli.overrides, 'units') ||
      Object.prototype.hasOwnProperty.call(fileConfig, 'units')) &&
    !Object.prototype.hasOwnProperty.call(cli.overrides, 'splitUnit') &&
    !Object.prototype.hasOwnProperty.call(fileConfig, 'splitUnit')
  ) {
    state.splitUnit = state.units === 'imperial' ? 'mi' : 'km';
    stateOverrides.splitUnit = state.splitUnit;
  }

  const webgl = cli.webgl !== 'auto' ? cli.webgl : fileConfig.webgl || 'auto';
  const browserExecutable = cli.browserExecutable || fileConfig.browserExecutable || null;
  validateRenderConfig(state, webgl);

  const rawInput = cli.input || fileConfig.input;
  if (!rawInput) {
    throw new Error('No input .tcx/.gpx file provided. Pass <input.tcx> or set "input" in config.json.');
  }
  const inputPath = cli.input ? path.resolve(cwd, rawInput) : path.resolve(configDir, rawInput);

  const rawOutput = cli.outputPath || fileConfig.output || fileConfig.out;
  const outputPath = rawOutput
    ? cli.outputPath
      ? path.resolve(cwd, rawOutput)
      : path.resolve(configDir, rawOutput)
    : resolveDefaultOutputPath(inputPath, state.presetId);

  return {
    help: false,
    quiet: cli.quiet,
    initConfigPath: null,
    inputPath,
    outputPath,
    webgl,
    browserExecutable,
    state,
    stateOverrides
  };
}
