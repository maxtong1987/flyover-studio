import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolvePlaywrightBrowsersPath } from '../lib/cli-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const browsersPath = resolvePlaywrightBrowsersPath(rootDir);
const pwCli = path.join(rootDir, 'node_modules', 'playwright', 'cli.js');

console.log(`Installing Chromium into ${browsersPath}…`);
execFileSync(process.execPath, [pwCli, 'install', 'chromium'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  }
});
