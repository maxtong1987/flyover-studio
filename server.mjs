import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FfmpegEncodeManager, sanitizeFilename } from './lib/encoder.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3456);
const MAX_FRAME_BATCH_BYTES = 50 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.tcx': 'application/xml; charset=utf-8',
  '.gpx': 'application/xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readBodyBuffer(req, maxBytes = MAX_FRAME_BATCH_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Request payload too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const buf = await readBodyBuffer(req, 1024 * 1024);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('Invalid JSON request body');
    err.statusCode = 400;
    throw err;
  }
}

async function serveStaticFile(req, res, pathname) {
  const cleanRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, cleanRel);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(resolved, 'index.html');
    try {
      const idxStat = await fsp.stat(indexPath);
      return streamStaticPath(req, res, indexPath, idxStat.size);
    } catch {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
  }

  return streamStaticPath(req, res, resolved, stat.size);
}

function streamStaticPath(req, res, filePath, size) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': size,
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function parseByteRange(rangeHeader, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : totalSize - 1;
  if (!match[1] && match[2]) {
    start = Math.max(0, totalSize - Number(match[2]));
    end = totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
    return null;
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

function requireJobId(url, res) {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    sendJson(res, 400, { error: 'Missing jobId query parameter' });
    return null;
  }
  return jobId;
}

async function serveMp4Download(req, res, url, encoderManager) {
  const jobId = decodeURIComponent(url.pathname.slice('/api/encode/download/'.length));
  const job = encoderManager.getJob(jobId);
  if (!job || job.status !== 'ready') {
    sendJson(res, 404, { error: 'Video not ready or expired' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(job.outputPath);
  } catch {
    sendJson(res, 404, { error: 'Output file missing' });
    return;
  }

  const totalSize = stat.size;
  const isAttachment = url.searchParams.get('download') === '1';
  const safeName = sanitizeFilename(job.filename);
  const baseHeaders = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...(isAttachment ? { 'Content-Disposition': `attachment; filename="${safeName}"` } : {})
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, totalSize);
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
      res.end();
      return;
    }

    const { start, end } = range;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Content-Length': end - start + 1
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(job.outputPath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': totalSize
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(job.outputPath).pipe(res);
}

export function createAppServer() {
  const encoderManager = new FfmpegEncodeManager();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const { pathname } = url;

      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, encoder: encoderManager.encoderName });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/encode/start') {
        const body = await readJsonBody(req);
        const result = encoderManager.startJob({
          width: body.width,
          height: body.height,
          fps: body.fps,
          filenameHint: body.filename
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/encode/frames') {
        const jobId = requireJobId(url, res);
        if (!jobId) return;
        const buf = await readBodyBuffer(req, MAX_FRAME_BATCH_BYTES);
        const result = await encoderManager.appendFrames(jobId, buf, req.headers['content-type']);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/encode/finish') {
        const jobId = requireJobId(url, res);
        if (!jobId) return;
        const result = await encoderManager.finishJob(jobId);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/encode/cancel') {
        const jobId = requireJobId(url, res);
        if (!jobId) return;
        const canceled = await encoderManager.cancelJob(jobId);
        sendJson(res, 200, { canceled });
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/api/encode/download/')) {
        await serveMp4Download(req, res, url, encoderManager);
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStaticFile(req, res, pathname);
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      const status = err?.statusCode || 500;
      sendJson(res, status, { error: err?.message || 'Internal server error' });
    }
  });

  server.encoderManager = encoderManager;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`Flyover Studio listening at http://localhost:${PORT} (encoder: ${server.encoderManager.encoderName})`);
  });

  const shutdown = async () => {
    await server.encoderManager.disposeAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
