import { drawMotionBlurTaps } from './canvas-utils.mjs';

const JPEG_QUALITY = 0.85;
const CANVAS_POOL_SIZE = 8;
const UPLOAD_BATCH_SIZE = 24;
const MAX_INFLIGHT_BATCHES = 2;

function throwIfAborted(abortSignal) {
  if (abortSignal?.aborted) {
    throw new DOMException('Export canceled', 'AbortError');
  }
}

async function fetchJsonOrThrow(url, init, fallbackMessage) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `${fallbackMessage} (${res.status})`);
  }
  return res.json();
}

function packFrameBatch(frameBuffers) {
  let totalBytes = 0;
  for (const buf of frameBuffers) {
    totalBytes += 4 + buf.byteLength;
  }
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const buf of frameBuffers) {
    view.setUint32(offset, buf.byteLength, false);
    offset += 4;
    out.set(buf, offset);
    offset += buf.byteLength;
  }
  return out;
}

function createCanvasSlot(width, height) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: false });
  return { canvas, ctx, inUse: Promise.resolve() };
}

async function encodeCanvasToJpegBytes(canvas, quality = JPEG_QUALITY) {
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode composite frame to JPEG'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/jpeg',
      quality
    );
  });
}

async function checkServerEncoder() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

function sanitizeDownloadStem(title, ratioLabel) {
  const stem = String(title || 'flyover')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const ratio = String(ratioLabel || '9x16').replace(':', 'x');
  return `${stem || 'flyover'}-ig-${ratio}.mp4`;
}

async function compositeExportFrame({
  slot,
  frameIdx,
  totalFrames,
  width,
  height,
  timeline,
  settings,
  mapScene,
  evaluateFrameFn,
  renderHudFn
}) {
  const progress = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 1;
  const frameState = evaluateFrameFn(timeline, progress, settings);
  await mapScene.renderExportFrame(frameState, timeline, settings);
  const motionFlow = mapScene.computeCameraMotionFlow(timeline, progress, settings, evaluateFrameFn);

  slot.ctx.clearRect(0, 0, width, height);
  drawMotionBlurTaps(slot.ctx, mapScene.getCanvas(), motionFlow, width, height, { includeBaseTap: true });
  renderHudFn(slot.ctx, {
    width,
    height,
    timeline,
    frameState,
    settings,
    projectPoint: (lon, lat, ele) =>
      mapScene.project3DPoint(lon, lat, ele, frameState.camera, frameState.telemetry.ele, width, height),
    motionFlow: null,
    isExporting: true,
    clear: false
  });
}

async function maybeReportProgress(frameIdx, totalFrames, renderStartMs, verb, onProgress) {
  if (frameIdx % 8 !== 7 && frameIdx !== totalFrames - 1) return;
  const elapsedSec = Math.max(0.05, (performance.now() - renderStartMs) / 1000);
  const rate = (frameIdx + 1) / elapsedSec;
  const curFps = Math.round(rate);
  const etaSec = Math.max(0, Math.ceil((totalFrames - (frameIdx + 1)) / Math.max(1, rate)));
  onProgress({
    phase: 'rendering',
    percent: 12 + ((frameIdx + 1) / totalFrames) * 83,
    message: `${verb} frame ${frameIdx + 1} / ${totalFrames} (${curFps} fps · ~${etaSec}s left)…`
  });
  await new Promise((r) => setTimeout(r, 0));
}

function createBatchUploader(jobId, abortSignal) {
  let uploadError = null;
  let uploadChain = Promise.resolve();
  const pendingUploads = [];

  return {
    get error() {
      return uploadError;
    },
    async enqueue(chunkPromises) {
      if (chunkPromises.length === 0) return;
      while (pendingUploads.length >= MAX_INFLIGHT_BATCHES) {
        await pendingUploads[0];
        if (uploadError) throw uploadError;
      }

      const batchBuffersPromise = Promise.all(chunkPromises);
      const uploadTask = uploadChain.then(async () => {
        const buffers = await batchBuffersPromise;
        throwIfAborted(abortSignal);
        const packed = packFrameBatch(buffers);
        await fetchJsonOrThrow(
          `/api/encode/frames?jobId=${encodeURIComponent(jobId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: packed,
            signal: abortSignal
          },
          'Frame upload failed'
        );
      });

      uploadChain = uploadTask;
      const removeTracked = (tracked) => {
        const idx = pendingUploads.indexOf(tracked);
        if (idx !== -1) pendingUploads.splice(idx, 1);
      };
      const tracked = uploadTask.then(
        () => removeTracked(tracked),
        (err) => {
          if (!uploadError) uploadError = err;
          removeTracked(tracked);
        }
      );
      pendingUploads.push(tracked);
    },
    async flush() {
      await uploadChain;
      if (uploadError) throw uploadError;
    },
    async settleQuietly() {
      await uploadChain.catch(() => {});
    }
  };
}

async function exportViaWebCodecs({
  width,
  height,
  fps,
  totalFrames,
  durationSec,
  filename,
  timeline,
  settings,
  mapScene,
  evaluateFrameFn,
  renderHudFn,
  onProgress,
  abortSignal
}) {
  if (typeof window.VideoEncoder === 'undefined' || typeof window.VideoFrame === 'undefined') {
    throw new Error('Neither backend FFmpeg encoder nor browser WebCodecs API is available.');
  }

  const { Muxer, ArrayBufferTarget } = await import(
    'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.4/build/mp4-muxer.mjs'
  );

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  let encodeError = null;
  const encoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
    }
  });

  const codecCandidates = ['avc1.4D4029', 'avc1.42E01F', 'avc1.640028'];
  let chosenCodec = null;
  for (const codec of codecCandidates) {
    const support = await window.VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: 8_000_000,
      framerate: fps
    });
    if (support?.supported) {
      chosenCodec = codec;
      break;
    }
  }
  if (!chosenCodec) {
    throw new Error('Browser WebCodecs does not support H.264 AVC encoding at this resolution.');
  }

  encoder.configure({ codec: chosenCodec, width, height, bitrate: 8_000_000, framerate: fps });

  const slot = createCanvasSlot(width, height);
  const frameDurationUs = Math.round(1_000_000 / fps);
  const renderStartMs = performance.now();

  for (let i = 0; i < totalFrames; i += 1) {
    if (abortSignal?.aborted) {
      encoder.close();
      throw new DOMException('Export canceled', 'AbortError');
    }
    if (encodeError) throw encodeError;

    await compositeExportFrame({
      slot,
      frameIdx: i,
      totalFrames,
      width,
      height,
      timeline,
      settings,
      mapScene,
      evaluateFrameFn,
      renderHudFn
    });

    const vf = new window.VideoFrame(slot.canvas, {
      timestamp: i * frameDurationUs,
      duration: frameDurationUs
    });
    encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();

    while (encoder.encodeQueueSize > 8) {
      await new Promise((r) => setTimeout(r, 4));
    }

    await maybeReportProgress(i, totalFrames, renderStartMs, 'Encoding', onProgress);
  }

  onProgress({ phase: 'finalizing', percent: 96, message: 'Finalizing MP4 container…' });
  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);
  onProgress({ phase: 'done', percent: 100, message: 'Instagram MP4 ready!' });

  return {
    videoUrl: blobUrl,
    downloadUrl: blobUrl,
    filename,
    width,
    height,
    fps,
    durationSec,
    frameCount: totalFrames,
    sizeBytes: blob.size,
    encoder: chosenCodec,
    engine: 'webcodecs-mp4'
  };
}

async function exportViaServerFfmpeg({
  width,
  height,
  fps,
  totalFrames,
  durationSec,
  filename,
  timeline,
  settings,
  mapScene,
  evaluateFrameFn,
  renderHudFn,
  onProgress,
  abortSignal
}) {
  const { jobId } = await fetchJsonOrThrow(
    '/api/encode/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width, height, fps, filename }),
      signal: abortSignal
    },
    'Failed to start encoder'
  );

  let finished = false;
  const uploader = createBatchUploader(jobId, abortSignal);
  const cancelRemoteJob = async () => {
    if (finished) return;
    await fetch(`/api/encode/cancel?jobId=${encodeURIComponent(jobId)}`, { method: 'POST' }).catch(() => {});
  };

  try {
    const pool = Array.from({ length: CANVAS_POOL_SIZE }, () => createCanvasSlot(width, height));
    const pendingJpegs = [];
    const renderStartMs = performance.now();

    for (let i = 0; i < totalFrames; i += 1) {
      throwIfAborted(abortSignal);
      if (uploader.error) throw uploader.error;

      const slot = pool[i % CANVAS_POOL_SIZE];
      await slot.inUse;

      await compositeExportFrame({
        slot,
        frameIdx: i,
        totalFrames,
        width,
        height,
        timeline,
        settings,
        mapScene,
        evaluateFrameFn,
        renderHudFn
      });

      const jpegPromise = encodeCanvasToJpegBytes(slot.canvas, JPEG_QUALITY);
      slot.inUse = jpegPromise.then(
        () => {},
        () => {}
      );
      pendingJpegs.push(jpegPromise);

      if (pendingJpegs.length >= UPLOAD_BATCH_SIZE) {
        await uploader.enqueue(pendingJpegs.splice(0, UPLOAD_BATCH_SIZE));
      }

      await maybeReportProgress(i, totalFrames, renderStartMs, 'Rendering & encoding', onProgress);
    }

    if (pendingJpegs.length > 0) {
      await uploader.enqueue(pendingJpegs.splice(0, pendingJpegs.length));
    }

    onProgress({
      phase: 'finalizing',
      percent: 96,
      message: 'Finalizing Instagram H.264 MP4 (+faststart)…'
    });

    await uploader.flush();

    const meta = await fetchJsonOrThrow(
      `/api/encode/finish?jobId=${encodeURIComponent(jobId)}`,
      { method: 'POST', signal: abortSignal },
      'Finalize failed'
    );
    finished = true;

    onProgress({ phase: 'done', percent: 100, message: 'Instagram MP4 ready!' });

    return {
      jobId: meta.jobId,
      videoUrl: meta.downloadUrl,
      downloadUrl: `${meta.downloadUrl}?download=1`,
      filename: meta.filename,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      durationSec,
      frameCount: meta.frameCount,
      sizeBytes: meta.sizeBytes,
      encoder: meta.encoder,
      engine: 'ffmpeg-h264'
    };
  } catch (err) {
    await uploader.settleQuietly();
    await cancelRemoteJob();
    throw err;
  }
}

/**
 * Exports a deterministic 3D flyover MP4 video formatted for Instagram.
 */
export async function exportInstagramVideo({
  timeline,
  settings,
  mapScene,
  evaluateFrameFn,
  renderHudFn,
  onProgress = () => {},
  abortSignal = null
}) {
  const width = Math.floor(Number(settings.stageWidth || 1080) / 2) * 2;
  const height = Math.floor(Number(settings.stageHeight || 1920) / 2) * 2;
  const fps = Number(settings.fps || 30);
  const durationSec = Number(settings.durationSec || 30);
  const totalFrames = Math.max(15, Math.round(durationSec * fps));
  const filename = sanitizeDownloadStem(settings.title || timeline.title, settings.ratioLabel);

  mapScene.setExportMode(true);

  try {
    onProgress({ phase: 'prewarm', percent: 1, message: 'Caching 3D terrain & satellite tiles…' });
    await mapScene.prewarmRouteTiles(
      timeline,
      settings,
      evaluateFrameFn,
      (frac) => {
        onProgress({
          phase: 'prewarm',
          percent: Math.round(frac * 12),
          message: `Pre-loading 3D map tiles (${Math.round(frac * 100)}%)…`
        });
      },
      abortSignal
    );

    const commonArgs = {
      width,
      height,
      fps,
      totalFrames,
      durationSec,
      filename,
      timeline,
      settings,
      mapScene,
      evaluateFrameFn,
      renderHudFn,
      onProgress,
      abortSignal
    };

    const health = await checkServerEncoder();
    return health ? await exportViaServerFfmpeg(commonArgs) : await exportViaWebCodecs(commonArgs);
  } finally {
    mapScene.setExportMode(false);
  }
}
