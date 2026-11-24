#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAppServer } from './server.mjs';
import { formatBytes, getTargetDimensions } from './public/js/studio-state.mjs';
import {
  buildTemplateConfig,
  formatCliHelp,
  loadAndResolveCliJob,
  resolvePlaywrightBrowsersPath
} from './lib/cli-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep Playwright browsers strictly inside the project directory by default
// (venv-style isolation), while honoring container/user overrides like /ms-playwright.
process.env.PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath(__dirname);

export function buildChromiumArgs(webglMode) {
  const baseArgs = ['--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--no-sandbox'];

  if (webglMode === 'swiftshader') {
    return [...baseArgs, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  }

  return [...baseArgs, '--enable-webgl', '--use-gl=angle'];
}

export function resolveEffectiveWebglOrder(webglMode, { hasDri = fsSync.existsSync('/dev/dri') } = {}) {
  if (webglMode === 'swiftshader') return ['swiftshader'];
  if (webglMode === 'gpu') return ['gpu'];
  return hasDri ? ['gpu', 'swiftshader'] : ['swiftshader'];
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'Playwright is not installed locally in this project. Run:\n' +
        '  npm run cli:setup\n' +
        'to install Playwright + Chromium inside this project folder (no global installs).'
    );
  }
}

async function launchBrowser(playwright, { webglMode, browserExecutable }) {
  const launchOpts = {
    headless: true,
    args: buildChromiumArgs(webglMode)
  };
  if (browserExecutable) {
    launchOpts.executablePath = browserExecutable;
  }

  try {
    return await playwright.chromium.launch(launchOpts);
  } catch (err) {
    if (String(err?.message || '').includes("Executable doesn't exist")) {
      throw new Error(
        `Chromium browser not found in "${process.env.PLAYWRIGHT_BROWSERS_PATH}". Run:\n` +
          '  npm run cli:setup'
      );
    }
    throw err;
  }
}

async function runSingleBrowserAttempt({
  playwright,
  baseUrl,
  xmlText,
  fileName,
  stateOverrides,
  stageWidth,
  stageHeight,
  webglMode,
  browserExecutable,
  onProgress
}) {
  const browser = await launchBrowser(playwright, { webglMode, browserExecutable });
  try {
    const context = await browser.newContext({
      viewport: { width: stageWidth, height: stageHeight },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.exposeFunction('__flyoverProgress', (info) => onProgress(info));
    await page.goto(`${baseUrl}/render.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__flyoverReady === true && typeof window.maplibregl !== 'undefined',
      { timeout: 60000 }
    );

    const result = await page.evaluate(
      (payload) => window.runFlyoverRender(payload),
      { xmlText, fileName, stateOverrides }
    );

    if (pageErrors.length > 0 && !result?.jobId) {
      throw new Error(`Renderer page error: ${pageErrors.join('; ')}`);
    }

    return result;
  } finally {
    await browser.close();
  }
}

async function startEphemeralServer() {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    cleanup: async () => {
      await server.encoderManager.disposeAll();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function writeStarterConfig(targetPath) {
  const json = `${JSON.stringify(buildTemplateConfig(), null, 2)}\n`;
  if (targetPath === '-') {
    process.stdout.write(json);
    return;
  }
  const absTarget = path.resolve(process.cwd(), targetPath);
  await fs.mkdir(path.dirname(absTarget), { recursive: true });
  await fs.writeFile(absTarget, json, 'utf8');
  process.stdout.write(`Wrote starter config to ${absTarget}\n`);
}

function createProgressReporter(quiet) {
  let lastPct = -1;
  let lastMsg = '';
  return {
    get lastPercent() {
      return lastPct;
    },
    report({ percent = 0, message = '' }) {
      const pct = Math.max(0, Math.min(100, Math.round(percent)));
      if (pct === lastPct && message === lastMsg) return;
      lastPct = pct;
      lastMsg = message;
      if (!quiet) {
        process.stderr.write(`  [${String(pct).padStart(3)}%] ${message}\n`);
      }
    }
  };
}

async function renderWithWebglFallback({
  playwright,
  baseUrl,
  xmlText,
  fileName,
  job,
  stageWidth,
  stageHeight,
  log
}) {
  const progress = createProgressReporter(job.quiet);
  const webglOrder = resolveEffectiveWebglOrder(job.webgl);
  let lastErr = null;

  for (let idx = 0; idx < webglOrder.length; idx += 1) {
    const webglMode = webglOrder[idx];
    try {
      log(`  WebGL backend: ${webglMode}`);
      return await runSingleBrowserAttempt({
        playwright,
        baseUrl,
        xmlText,
        fileName,
        stateOverrides: job.stateOverrides,
        stageWidth,
        stageHeight,
        webglMode,
        browserExecutable: job.browserExecutable,
        onProgress: (info) => progress.report(info)
      });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isWebglStartupFailure =
        progress.lastPercent < 1 || /webgl|gpu|context|browser|target closed/i.test(msg);
      if (idx + 1 < webglOrder.length && isWebglStartupFailure) {
        log(`  WebGL "${webglMode}" failed (${msg}); falling back to "${webglOrder[idx + 1]}"…`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Render failed');
}

export async function runCli(argv = process.argv.slice(2)) {
  const job = await loadAndResolveCliJob(argv);

  if (job.help) {
    process.stdout.write(formatCliHelp());
    return 0;
  }

  if (job.initConfigPath !== null) {
    await writeStarterConfig(job.initConfigPath);
    return 0;
  }

  const log = (msg) => {
    if (!job.quiet) process.stderr.write(`${msg}\n`);
  };

  let xmlText;
  try {
    xmlText = await fs.readFile(job.inputPath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read input file "${job.inputPath}": ${err.message}`);
  }

  const playwright = await importPlaywright();
  const { server, baseUrl, cleanup } = await startEphemeralServer();

  const onSignal = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const fileName = path.basename(job.inputPath);
    const { presetId, quality, durationSec, fps, colorMode, mapStyle } = job.state;
    const { width: stageWidth, height: stageHeight } = getTargetDimensions(job.state);

    log(`Flyover Studio CLI — ${fileName}`);
    log(`  Preset: ${presetId} (${quality}) · ${durationSec}s @ ${fps}fps · Style: ${mapStyle} · Color: ${colorMode}`);
    log(`  Encoder: ${server.encoderManager.encoderName} · Output: ${job.outputPath}`);

    const result = await renderWithWebglFallback({
      playwright,
      baseUrl,
      xmlText,
      fileName,
      job,
      stageWidth,
      stageHeight,
      log
    });

    const encodedJob = server.encoderManager.getJob(result.jobId);
    if (!encodedJob?.outputPath) {
      throw new Error('Encoded MP4 file not found on backend encoder.');
    }

    await fs.mkdir(path.dirname(job.outputPath), { recursive: true });
    await fs.copyFile(encodedJob.outputPath, job.outputPath);

    process.stdout.write(
      `Saved ${job.outputPath} (${result.width}×${result.height}, ${result.fps}fps, ${result.durationSec}s, ${formatBytes(result.sizeBytes)})\n`
    );
    return 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Error: ${err?.message || err}\n`);
      process.exit(1);
    });
}
