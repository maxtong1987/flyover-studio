import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const TMP_DIR = '/tmp';
const JOB_TTL_MS = 30 * 60 * 1000;

/**
 * Detects an available H.264 encoder in the local ffmpeg binary.
 * Prefers libx264 and falls back to libopenh264.
 * @returns {string}
 */
export function detectH264Encoder() {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (/\blibx264\b/.test(out)) return 'libx264';
    if (/\blibopenh264\b/.test(out)) return 'libopenh264';
  } catch {
    // Fall back to libx264 so any spawn error surfaces clearly when encoding starts.
  }
  return 'libx264';
}

function clampEvenDim(value, fallback) {
  const num = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  const clamped = Math.max(128, Math.min(3840, num));
  return Math.floor(clamped / 2) * 2;
}

function clampFps(value) {
  const num = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 30;
  return Math.max(10, Math.min(60, num));
}

export function sanitizeFilename(name) {
  const base = String(name || 'flyover-instagram')
    .replace(/\.mp4$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'flyover-instagram'}.mp4`;
}

export function unpackFrameBatch(payloadBuffer, contentType = 'image/jpeg') {
  const frames = [];
  if (String(contentType).includes('application/octet-stream')) {
    let offset = 0;
    while (offset + 4 <= payloadBuffer.length) {
      const len = payloadBuffer.readUInt32BE(offset);
      offset += 4;
      if (len === 0 || offset + len > payloadBuffer.length) {
        throw new Error('Malformed packed frame batch');
      }
      frames.push(payloadBuffer.subarray(offset, offset + len));
      offset += len;
    }
    if (offset !== payloadBuffer.length) {
      throw new Error('Trailing bytes in packed frame batch');
    }
  } else if (payloadBuffer.length > 0) {
    frames.push(payloadBuffer);
  }
  return frames;
}

function serializeReadyJob(job) {
  return {
    jobId: job.jobId,
    width: job.width,
    height: job.height,
    fps: job.fps,
    frameCount: job.frameCount,
    sizeBytes: job.sizeBytes,
    filename: job.filename,
    encoder: job.encoder,
    downloadUrl: `/api/encode/download/${job.jobId}`
  };
}

async function writeChunkWithBackpressure(proc, chunk) {
  if (!proc.stdin || proc.stdin.destroyed || proc.stdin.writableEnded) {
    throw new Error('FFmpeg stdin is closed');
  }
  const canContinue = proc.stdin.write(chunk);
  if (canContinue) return;

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      proc.stdin.off('drain', onDrain);
      proc.stdin.off('error', onError);
      proc.off('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = (code) => {
      cleanup();
      reject(new Error(`FFmpeg exited prematurely with code ${code}`));
    };
    proc.stdin.once('drain', onDrain);
    proc.stdin.once('error', onError);
    proc.once('close', onClose);
  });
}

export class FfmpegEncodeManager {
  constructor() {
    this.encoderName = detectH264Encoder();
    this.jobs = new Map();
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredJobs().catch(() => {});
    }, 5 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Starts a new FFmpeg H.264 MP4 encoding job consuming MJPEG frames on stdin.
   */
  startJob({ width = 1080, height = 1920, fps = 30, filenameHint = 'flyover-instagram.mp4' } = {}) {
    const cleanW = clampEvenDim(width, 1080);
    const cleanH = clampEvenDim(height, 1920);
    const cleanFps = clampFps(fps);
    const jobId = crypto.randomUUID();
    const outputPath = path.join(TMP_DIR, `flyover-${jobId}.mp4`);
    const filename = sanitizeFilename(filenameHint);
    const encoderName = this.encoderName;

    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-threads', '4',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(cleanFps), '-i', 'pipe:0',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-c:v', encoderName,
      ...(encoderName === 'libx264'
        ? ['-preset', 'superfast', '-crf', '20', '-profile:v', 'main', '-level', '4.1', '-bf', '0']
        : ['-b:v', '8M']),
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-g', String(cleanFps * 2),
      '-c:a', 'aac', '-b:a', '128k', '-shortest',
      '-movflags', '+faststart',
      outputPath
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const stderrChunks = [];
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    const exitPromise = new Promise((resolve, reject) => {
      proc.once('error', (err) => reject(err));
      proc.once('close', (code, signal) => {
        const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
        resolve({ code, signal, stderrText });
      });
    });

    const job = {
      jobId,
      width: cleanW,
      height: cleanH,
      fps: cleanFps,
      filename,
      outputPath,
      encoder: encoderName,
      proc,
      exitPromise,
      frameCount: 0,
      status: 'encoding',
      sizeBytes: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      writeChain: Promise.resolve()
    };

    this.jobs.set(jobId, job);
    return {
      jobId,
      width: cleanW,
      height: cleanH,
      fps: cleanFps,
      encoder: encoderName,
      filename
    };
  }

  /**
   * Appends either a packed batch (application/octet-stream: [uint32BE len][bytes]...)
   * or a single JPEG frame buffer to the active job's stdin pipe.
   */
  async appendFrames(jobId, payloadBuffer, contentType = 'image/jpeg') {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown encode job: ${jobId}`);
    }
    if (job.status !== 'encoding') {
      throw new Error(`Job ${jobId} is not accepting frames (status: ${job.status})`);
    }

    const frames = unpackFrameBatch(payloadBuffer, contentType);
    if (frames.length === 0) {
      return { accepted: 0, frameCount: job.frameCount };
    }

    // Serialize writes to preserve frame ordering under concurrent requests.
    const writeTask = job.writeChain.then(async () => {
      for (const frameBuf of frames) {
        await writeChunkWithBackpressure(job.proc, frameBuf);
        job.frameCount += 1;
      }
      job.updatedAt = Date.now();
    });
    job.writeChain = writeTask.catch(() => {});
    await writeTask;

    return { accepted: frames.length, frameCount: job.frameCount };
  }

  /**
   * Closes FFmpeg stdin, awaits completion, and returns output MP4 metadata.
   */
  async finishJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown encode job: ${jobId}`);
    }
    if (job.status === 'ready') {
      return serializeReadyJob(job);
    }
    if (job.status !== 'encoding') {
      throw new Error(`Job ${jobId} cannot finish from status: ${job.status}`);
    }

    job.status = 'finalizing';
    await job.writeChain;

    if (job.proc.stdin && !job.proc.stdin.destroyed && !job.proc.stdin.writableEnded) {
      job.proc.stdin.end();
    }

    const { code, signal, stderrText } = await job.exitPromise;
    if (code !== 0) {
      job.status = 'failed';
      await fs.unlink(job.outputPath).catch(() => {});
      throw new Error(`FFmpeg failed (code=${code}, signal=${signal}): ${stderrText || 'unknown error'}`);
    }

    const stat = await fs.stat(job.outputPath);
    job.sizeBytes = stat.size;
    job.status = 'ready';
    job.updatedAt = Date.now();

    return serializeReadyJob(job);
  }

  /**
   * Cancels an active or completed job and deletes its temporary output file.
   */
  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.status = 'canceled';
    if (job.proc && job.proc.exitCode === null) {
      try {
        job.proc.stdin?.destroy();
        job.proc.kill('SIGTERM');
      } catch {
        // Ignore already-exited processes.
      }
    }
    this.jobs.delete(jobId);
    await fs.unlink(job.outputPath).catch(() => {});
    return true;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  async cleanupExpiredJobs() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.updatedAt < cutoff) {
        await this.cancelJob(jobId);
      }
    }
  }

  async disposeAll() {
    clearInterval(this.cleanupTimer);
    const ids = [...this.jobs.keys()];
    await Promise.all(ids.map((id) => this.cancelJob(id)));
  }
}
