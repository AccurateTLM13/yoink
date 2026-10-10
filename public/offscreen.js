// offscreen.js - Yoink Image Processing Engine
//
// Accepts tasks only from Yoink extension contexts (never content scripts).
// Every task answers via sendResponse. Nothing is broadcast.

const EXT_ORIGIN = chrome.runtime.getURL('');
const MAX_DIMENSION = 16000;
// Stay under Chrome's maximum canvas area (~268M px) with headroom.
const MAX_AREA = 16000 * 8192;
const JOB_TTL_MS = 2 * 60 * 1000;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,/;

/** jobId -> stitch job */
const jobs = new Map();

const HANDLERS = {
  STITCH_BEGIN: stitchBegin,
  STITCH_ADD: stitchAdd,
  STITCH_END: stitchEnd,
  CROP_SELECTION: cropSelection,
  CONVERT_FORMAT: convertFormat,
  COPY_TO_CLIPBOARD: writeToClipboard,
  CAPTURE_DESKTOP_FRAME: captureDesktopFrame,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;
  if (sender.id !== chrome.runtime.id || sender.tab || !(sender.url || '').startsWith(EXT_ORIGIN)) return false;

  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, message.type) ? HANDLERS[message.type] : null;
  if (!handler) {
    sendResponse({ error: `Unknown offscreen task "${message.type}"` });
    return false;
  }

  Promise.resolve()
    .then(() => handler(message.payload || {}))
    .then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
  return true;
});

// ---------------------------------------------------------------------------
// Incremental stitching (1 chunk per message keeps each message small)
// ---------------------------------------------------------------------------
function stitchBegin({ jobId, kind, totalWidth, totalHeight, dpr, cropRect, settings }) {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      releaseCanvas(job.canvas);
      jobs.delete(id);
    }
  }
  if (typeof jobId !== 'string' || !jobId) throw new Error('Missing job id');
  jobs.set(jobId, {
    createdAt: now,
    kind: kind === 'element' ? 'element' : 'full',
    totalWidth: Number(totalWidth) || 0,
    totalHeight: Number(totalHeight) || 0,
    dpr: Number(dpr) || 1,
    cropRect,
    settings,
    canvas: null,
    ctx: null,
    scale: 1,
    src: null,
    bottom: 0,
  });
  return { ok: true };
}

function initJobCanvas(job, img) {
  job.scale = job.totalWidth > 0 && img.width > 0 ? img.width / job.totalWidth : job.dpr;
  let width;
  let height;

  if (job.kind === 'full') {
    width = img.width;
    height = Math.round(job.totalHeight * job.scale) || img.height;
  } else {
    const r = job.cropRect;
    if (!r) throw new Error('Missing crop rectangle for element capture');
    const x = clamp(Math.round(r.x * job.scale), 0, img.width - 1);
    const y = clamp(Math.round(r.y * job.scale), 0, img.height - 1);
    const w = Math.max(1, Math.min(Math.round(r.width * job.scale), img.width - x));
    const h = Math.max(1, Math.min(Math.round(r.height * job.scale), img.height - y));
    job.src = { x, y, w, h };
    width = w;
    height = Math.max(h, Math.round(job.totalHeight * job.scale));
  }

  height = Math.max(1, Math.min(height, MAX_DIMENSION, Math.floor(MAX_AREA / width)));
  job.canvas = new OffscreenCanvas(width, height);
  job.ctx = job.canvas.getContext('2d');
}

async function stitchAdd({ jobId, dataUrl, yOffset }) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Unknown stitch job');

  const img = await loadBitmap(dataUrl);
  try {
    if (!job.canvas) initJobCanvas(job, img);
    const destY = Math.round((Number(yOffset) || 0) * job.scale);
    if (destY < job.canvas.height) {
      if (job.kind === 'full') {
        job.ctx.drawImage(img, 0, destY);
        job.bottom = Math.max(job.bottom, Math.min(job.canvas.height, destY + img.height));
      } else {
        const h = Math.min(job.src.h, job.canvas.height - destY);
        job.ctx.drawImage(img, job.src.x, job.src.y, job.src.w, h, 0, destY, job.src.w, h);
        job.bottom = Math.max(job.bottom, destY + h);
      }
    }
  } finally {
    img.close?.();
  }
  return { ok: true };
}

async function stitchEnd({ jobId }) {
  const job = jobs.get(jobId);
  jobs.delete(jobId);
  if (!job?.canvas) throw new Error('No image chunks received for stitching');

  let canvas = job.canvas;
  // Trim blank space when the chunk limit stopped the scan early.
  if (job.bottom > 0 && job.bottom < canvas.height) {
    const trimmed = new OffscreenCanvas(canvas.width, job.bottom);
    trimmed.getContext('2d').drawImage(canvas, 0, 0);
    releaseCanvas(canvas);
    canvas = trimmed;
  }

  try {
    return await encodeCanvas(canvas, job.settings);
  } finally {
    releaseCanvas(canvas);
  }
}

// ---------------------------------------------------------------------------
// Crop, convert, clipboard
// ---------------------------------------------------------------------------
async function cropSelection({ dataUrl, x, y, width, height, dpr, settings }) {
  const img = await loadBitmap(dataUrl);
  const scale = Number(dpr) || 1;
  let canvas = null;
  try {
    const cx = clamp(Math.round(x * scale), 0, img.width - 1);
    const cy = clamp(Math.round(y * scale), 0, img.height - 1);
    const cw = Math.max(1, Math.min(Math.round(width * scale), img.width - cx));
    const ch = Math.max(1, Math.min(Math.round(height * scale), img.height - cy));
    canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  } finally {
    img.close?.();
  }
  try {
    return await encodeCanvas(canvas, settings);
  } finally {
    releaseCanvas(canvas);
  }
}

async function convertFormat({ dataUrl, format, quality }) {
  const img = await loadBitmap(dataUrl);
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  img.close?.();
  try {
    const { mime, q } = encoding({ format, quality });
    const blob = await canvas.convertToBlob({ type: mime, quality: q });
    return { dataUrl: await blobToDataUrl(blob) };
  } finally {
    releaseCanvas(canvas);
  }
}

async function writeToClipboard({ dataUrl }) {
  try {
    let blob = await (await fetch(assertImageDataUrl(dataUrl))).blob();
    if (blob.type !== 'image/png') {
      const img = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(img.width, img.height);
      canvas.getContext('2d').drawImage(img, 0, 0);
      img.close();
      blob = await canvas.convertToBlob({ type: 'image/png' });
      releaseCanvas(canvas);
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return { success: true };
  } catch (e) {
    console.warn('writeToClipboard failed in offscreen document:', e);
    return { success: false, error: e?.message || 'Clipboard write failed' };
  }
}

// ---------------------------------------------------------------------------
// Desktop capture
// ---------------------------------------------------------------------------
async function captureDesktopFrame({ streamId, settings }) {
  if (typeof streamId !== 'string' || !streamId) throw new Error('Missing desktop stream id');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: 7680,
        maxHeight: 4320,
      },
    },
  });

  const video = document.createElement('video');
  let timer = null;
  try {
    video.muted = true;
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Desktop stream timeout')), 10000);
      video.onloadedmetadata = () => video.play().then(resolve, reject);
      video.onerror = () => reject(new Error('Video stream failed to load'));
    });
    await new Promise((r) => setTimeout(r, 120));

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Desktop stream returned no frames');

    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    try {
      return await encodeCanvas(canvas, settings);
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.onloadedmetadata = null;
    video.onerror = null;
    video.srcObject = null;
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------
function encoding(settings) {
  const format = settings?.format;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const qn = Number(settings?.quality);
  return { mime, q: Number.isFinite(qn) ? clamp(qn, 0.1, 1) : 0.92 };
}

async function encodeCanvas(canvas, settings) {
  const { mime, q } = encoding(settings);
  const blob = await canvas.convertToBlob({ type: mime, quality: q });
  return {
    dataUrl: await blobToDataUrl(blob),
    thumbnailUrl: await makeThumbnail(canvas),
    width: canvas.width,
    height: canvas.height,
  };
}

async function makeThumbnail(source, targetWidth = 720) {
  try {
    const sw = source.width;
    const sh = source.height;
    if (!sw || !sh) return '';
    const cropHeight = Math.min(sh, Math.round(sw * 0.75));
    const scale = Math.min(1, targetWidth / sw);
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(cropHeight * scale));
    const thumb = new OffscreenCanvas(tw, th);
    const ctx = thumb.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, sw, cropHeight, 0, 0, tw, th);
    const blob = await thumb.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    releaseCanvas(thumb);
    return await blobToDataUrl(blob);
  } catch (e) {
    console.warn('Thumbnail generation failed:', e);
    return '';
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to encode image'));
    reader.readAsDataURL(blob);
  });
}

function assertImageDataUrl(src) {
  if (typeof src !== 'string' || !DATA_IMAGE_RE.test(src)) {
    throw new Error('Only data:image URLs are accepted');
  }
  return src;
}

async function loadBitmap(src) {
  const blob = await (await fetch(assertImageDataUrl(src))).blob();
  return createImageBitmap(blob);
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
