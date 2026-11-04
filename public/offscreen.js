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
  SLICE_IMAGE: sliceImageTask,
  PROCESS_CAPTURE: processCapture,
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
function stitchBegin({ jobId, kind, totalWidth, totalHeight, dpr, cropRect, settings, proofContext }) {
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
    proofContext,
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
  job.ctx = job.canvas.getContext('2d', { willReadFrequently: true });
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
    trimmed.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
    releaseCanvas(canvas);
    canvas = trimmed;
  }

  try {
    return await encodeCanvas(canvas, job.settings, job.proofContext);
  } finally {
    releaseCanvas(canvas);
  }
}

// ---------------------------------------------------------------------------
// Crop, convert, clipboard
// ---------------------------------------------------------------------------
async function cropSelection({ dataUrl, x, y, width, height, dpr, settings, proofContext }) {
  const img = await loadBitmap(dataUrl);
  const scale = Number(dpr) || 1;
  let canvas = null;
  try {
    const cx = clamp(Math.round(x * scale), 0, img.width - 1);
    const cy = clamp(Math.round(y * scale), 0, img.height - 1);
    const cw = Math.max(1, Math.min(Math.round(width * scale), img.width - cx));
    const ch = Math.max(1, Math.min(Math.round(height * scale), img.height - cy));
    canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  } finally {
    img.close?.();
  }
  try {
    return await encodeCanvas(canvas, settings, proofContext);
  } finally {
    releaseCanvas(canvas);
  }
}

async function processCapture({ dataUrl, settings, proofContext }) {
  const img = await loadBitmap(dataUrl);
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  img.close?.();
  try {
    return await encodeCanvas(canvas, settings, proofContext);
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
      const img = await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
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
async function captureDesktopFrame({ streamId, settings, proofContext }) {
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
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, w, h);
    try {
      return await encodeCanvas(canvas, settings, proofContext);
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
// Encoding helpers & Slicing
// ---------------------------------------------------------------------------
function encoding(settings) {
  const format = settings?.format;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  let qn = Number(settings?.quality);
  if (settings?.losslessWebp && format === 'webp') {
    qn = 1.0;
  }
  return { mime, q: Number.isFinite(qn) ? clamp(qn, 0.1, 1) : 0.92 };
}

async function sliceImageTask({ dataUrl, maxSliceHeight = 4000, settings, proofContext }) {
  const img = await loadBitmap(dataUrl);
  try {
    const w = img.width;
    const h = img.height;
    const limit = Math.max(500, Math.min(Number(maxSliceHeight) || 4000, 16000));
    if (h <= limit) {
      return { slices: [{ dataUrl, part: 1, total: 1 }] };
    }
    const slices = [];
    const totalParts = Math.ceil(h / limit);
    for (let part = 0; part < totalParts; part++) {
      const y = part * limit;
      const sliceHeight = Math.min(limit, h - y);
      const canvas = new OffscreenCanvas(w, sliceHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (settings?.format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, sliceHeight);
      }
      ctx.drawImage(img, 0, y, w, sliceHeight, 0, 0, w, sliceHeight);
      try {
        const encodedSlice = await encodeCanvas(canvas, settings, proofContext);
        slices.push({
          dataUrl: encodedSlice.dataUrl,
          part: part + 1,
          total: totalParts,
        });
      } finally {
        releaseCanvas(canvas);
      }
    }
    return { slices };
  } finally {
    img.close?.();
  }
}

async function encodeCanvas(canvas, settings, proofContext) {
  let targetCanvas = canvas;
  let stampedCanvas = null;

  try {
    const useProof = settings?.enableProof !== false && proofContext?.identity?.privateKeyJwk;
    const useVisualStamp = settings?.proofVisualStamp === true && proofContext?.identity?.keyFingerprint;
    const timestamp = Date.now();

    if (useVisualStamp && targetCanvas.height + 60 <= MAX_DIMENSION) {
      stampedCanvas = drawVisualStampOffscreen(targetCanvas, {
        url: proofContext.url,
        author: settings?.proofAuthor || proofContext.author || '',
        keyFingerprint: proofContext.identity.keyFingerprint,
        timestamp,
      });
      targetCanvas = stampedCanvas;
    }

    let pixelManifest = null;
    if (useProof) {
      try {
        pixelManifest = await signAndWatermarkOffscreenCanvas(targetCanvas, {
          identity: proofContext.identity,
          url: proofContext.url || '',
          title: proofContext.title || 'Screenshot',
          author: settings?.proofAuthor || proofContext.author || '',
          timestamp,
        });
      } catch (err) {
        console.warn('Yoink Proof canvas signing skipped:', err);
      }
    }

    const { mime, q } = encoding(settings);
    const blob = await targetCanvas.convertToBlob({ type: mime, quality: q });
    let dataUrl;
    let finalManifest = pixelManifest;

    if (pixelManifest) {
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      const cleanBytes = stripYoinkAndColorChunksOffscreen(rawBytes);
      const bh = bytesToBase64UrlOffscreen(
        new Uint8Array(await crypto.subtle.digest('SHA-256', cleanBytes))
      );
      finalManifest = await signContainerManifestOffscreen(
        pixelManifest,
        bh,
        proofContext.identity.privateKeyJwk
      );
      const taggedBytes = injectContainerMetadataOffscreen(cleanBytes, mime, finalManifest);
      dataUrl = bytesToDataUrlOffscreen(taggedBytes, mime);
    } else {
      dataUrl = await blobToDataUrl(blob);
    }

    return {
      dataUrl,
      thumbnailUrl: await makeThumbnail(targetCanvas),
      width: targetCanvas.width,
      height: targetCanvas.height,
      proofKeyId: finalManifest?.kid || undefined,
      proofSigned: !!finalManifest,
    };
  } finally {
    if (stampedCanvas) releaseCanvas(stampedCanvas);
  }
}

// ---------------------------------------------------------------------------
// Yoink Proof™ Engine (ECDSA P-256 + LSB Watermark + IPTC/XMP Metadata)
// ---------------------------------------------------------------------------
const IPTC_SCREEN_CAPTURE_URI = 'http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture';
const WATERMARK_CARRIER_PIXELS = 4096;
const MAGIC_BYTES = new Uint8Array([0x59, 0x4e, 0x4b, 0x50]); // "YNKP"
const PROOF_VERSION = 1;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Offscreen(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesToBase64Offscreen(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function bytesToBase64UrlOffscreen(bytes) {
  return bytesToBase64Offscreen(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToDataUrlOffscreen(bytes, mime) {
  return `data:${mime};base64,${bytesToBase64Offscreen(bytes)}`;
}

function drawVisualStampOffscreen(sourceCanvas, info) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const scale = Math.max(1, Math.min(2, w / 1000));
  const barHeight = Math.round(30 * scale);

  const out = new OffscreenCanvas(w, h + barHeight);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);

  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, h, w, barHeight);

  ctx.fillStyle = '#27272a';
  ctx.fillRect(0, h, w, Math.max(1, Math.round(scale)));

  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, h, Math.round(4 * scale), barHeight);

  const fontSize = Math.max(10, Math.round(11 * scale));
  ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.textBaseline = 'middle';
  const midY = h + barHeight / 2;

  const badgeText = '✓ YOINK PROOF';
  const padX = Math.round(12 * scale);
  ctx.fillStyle = '#10b981';
  ctx.fillText(badgeText, padX, midY);

  const badgeW = ctx.measureText(badgeText).width;
  const cleanUrl = String(info.url || 'local-capture').replace(/^https?:\/\//, '').slice(0, 55);
  ctx.fillStyle = '#e4e4e7';
  ctx.font = `400 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillText(`  •  ${cleanUrl}`, padX + badgeW, midY);

  const iso = new Date(info.timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const authorPart = info.author ? `${String(info.author).trim()}  •  ` : '';
  const rightText = `${authorPart}${iso}  •  KEY #${info.keyFingerprint}  •  IPTC:screenCapture`;
  const rightW = ctx.measureText(rightText).width;
  if (w - rightW - padX > padX + badgeW + 120) {
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(rightText, w - rightW - padX, midY);
  }

  return out;
}

function canonicalManifestStringOffscreen(m) {
  const parts = [
    `YNKP${m.v}`,
    m.src,
    m.alg,
    m.kid,
    m.pub,
    m.ph,
    String(m.ts),
    `${m.w}x${m.h}`,
    m.u,
    m.t,
    m.a,
  ];
  if (m.bh) {
    parts.push(m.bh);
  }
  return parts.join('|');
}

async function signContainerManifestOffscreen(baseManifest, bh, privateKeyJwk) {
  const unsigned = {
    v: baseManifest.v,
    src: baseManifest.src,
    alg: baseManifest.alg,
    kid: baseManifest.kid,
    pub: baseManifest.pub,
    ph: baseManifest.ph,
    bh,
    ts: baseManifest.ts,
    w: baseManifest.w,
    h: baseManifest.h,
    u: baseManifest.u,
    t: baseManifest.t,
    a: baseManifest.a,
  };

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(canonicalManifestStringOffscreen(unsigned))
  );

  return {
    ...unsigned,
    sig: bytesToBase64UrlOffscreen(new Uint8Array(sigBuf)),
  };
}

async function signAndWatermarkOffscreenCanvas(canvas, { identity, url, title, author, timestamp }) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = imageData.data;

  const totalPixels = Math.min(Math.floor(rgba.length / 4), width * height);
  const carrierCount = Math.min(totalPixels, WATERMARK_CARRIER_PIXELS);

  // Normalize Alpha to 255 across all pixels before hashing so premultiplied alpha never mutates RGB
  for (let i = 3; i < rgba.length; i += 4) {
    rgba[i] = 255;
  }

  // Compute masked pixel SHA-256 hash
  const buf = new Uint8Array(8 + totalPixels * 4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, width >>> 0, false);
  view.setUint32(4, height >>> 0, false);
  buf.set(rgba.subarray(0, totalPixels * 4), 8);

  const carrierEndByte = 8 + carrierCount * 4;
  for (let i = 8; i < carrierEndByte; i += 4) {
    buf[i] = buf[i] & 0xfe;
    buf[i + 1] = buf[i + 1] & 0xfe;
    buf[i + 2] = buf[i + 2] & 0xfe;
    buf[i + 3] = 0xff;
  }

  const ph = bytesToBase64UrlOffscreen(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)));

  const unsigned = {
    v: PROOF_VERSION,
    src: IPTC_SCREEN_CAPTURE_URI,
    alg: 'ES256',
    kid: identity.keyFingerprint,
    pub: identity.pubRawB64Url,
    ph,
    ts: timestamp,
    w: width,
    h: height,
    u: String(url || '').slice(0, 180),
    t: String(title || 'Screenshot').slice(0, 100),
    a: String(author || '').trim().slice(0, 60),
  };

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    identity.privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(canonicalManifestStringOffscreen(unsigned))
  );

  const manifest = {
    ...unsigned,
    sig: bytesToBase64UrlOffscreen(new Uint8Array(sigBuf)),
  };

  // Embed LSB watermark into carrier pixels
  const payloadBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const packetLen = 11 + payloadBytes.length;
  const totalBits = packetLen * 8;
  const requiredPixels = Math.ceil(totalBits / 3);

  if (requiredPixels <= carrierCount) {
    const packet = new Uint8Array(packetLen);
    packet.set(MAGIC_BYTES, 0);
    packet[4] = PROOF_VERSION;
    const pView = new DataView(packet.buffer);
    pView.setUint16(5, payloadBytes.length, false);
    pView.setUint32(7, crc32Offscreen(payloadBytes), false);
    packet.set(payloadBytes, 11);

    let bitIdx = 0;
    for (let p = 0; p < requiredPixels && bitIdx < totalBits; p++) {
      const base = p * 4;
      for (let c = 0; c < 3 && bitIdx < totalBits; c++) {
        const bytePos = bitIdx >>> 3;
        const bitOffset = 7 - (bitIdx & 7);
        const bit = (packet[bytePos] >>> bitOffset) & 1;
        rgba[base + c] = (rgba[base + c] & 0xfe) | bit;
        bitIdx++;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  return manifest;
}

function stripYoinkAndColorChunksOffscreen(bytes) {
  if (
    bytes.length > 33 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const keptRanges = [[0, 8]];
    let totalLen = 8;
    let offset = 8;

    while (offset + 12 <= bytes.length) {
      const len = view.getUint32(offset, false);
      const chunkEnd = offset + 12 + len;
      if (chunkEnd > bytes.length) {
        keptRanges.push([offset, bytes.length]);
        totalLen += bytes.length - offset;
        break;
      }
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );

      let skip = false;
      if (type === 'sRGB' || type === 'gAMA' || type === 'cHRM' || type === 'iCCP') {
        skip = true;
      } else if (type === 'tEXt' || type === 'iTXt') {
        const keySlice = bytes.subarray(offset + 8, Math.min(offset + 8 + len, offset + 40));
        const keyStr = new TextDecoder().decode(keySlice);
        if (
          keyStr.startsWith('XML:com.adobe.xmp\0') ||
          keyStr.startsWith('DigitalSourceType\0') ||
          keyStr.startsWith('yoink-proof\0')
        ) {
          skip = true;
        }
      }

      if (!skip) {
        keptRanges.push([offset, chunkEnd]);
        totalLen += chunkEnd - offset;
      }

      offset = chunkEnd;
      if (type === 'IEND') break;
    }

    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const [start, end] of keptRanges) {
      out.set(bytes.subarray(start, end), pos);
      pos += end - start;
    }
    return out;
  }

  return bytes;
}

function escapeXmlOffscreen(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildXmpPacketOffscreen(manifest) {
  const manifestB64 = bytesToBase64Offscreen(new TextEncoder().encode(JSON.stringify(manifest)));
  const isoDate = new Date(manifest.ts).toISOString();
  const creator = escapeXmlOffscreen(manifest.a || `Yoink Verified User (${manifest.kid})`);

  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"',
    ' xmlns:yoink="https://yoink.capture/ns/1.0/"',
    ' xmp:CreatorTool="Yoink Chrome Extension (Verified Screen Capture)"',
    ` xmp:CreateDate="${isoDate}"`,
    ` Iptc4xmpExt:DigitalSourceType="${IPTC_SCREEN_CAPTURE_URI}"`,
    ` yoink:DigitalSourceType="${IPTC_SCREEN_CAPTURE_URI}"`,
    ` yoink:KeyFingerprint="${escapeXmlOffscreen(manifest.kid)}"`,
    ` yoink:PixelHash="${escapeXmlOffscreen(manifest.ph)}"`,
    ` yoink:Signature="${escapeXmlOffscreen(manifest.sig)}"`,
    ` yoink:ProofManifest="${manifestB64}">`,
    `<dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('');
}

function makePngChunkOffscreen(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32Offscreen(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

function makePngTextChunkOffscreen(keyword, value) {
  const keyBytes = new TextEncoder().encode(keyword);
  const valBytes = new TextEncoder().encode(value);
  const data = new Uint8Array(keyBytes.length + 1 + valBytes.length);
  data.set(keyBytes, 0);
  data[keyBytes.length] = 0;
  data.set(valBytes, keyBytes.length + 1);
  return makePngChunkOffscreen('tEXt', data);
}

function makePngItxtChunkOffscreen(keyword, value) {
  const keyBytes = new TextEncoder().encode(keyword);
  const valBytes = new TextEncoder().encode(value);
  const data = new Uint8Array(keyBytes.length + 5 + valBytes.length);
  data.set(keyBytes, 0);
  data.set(valBytes, keyBytes.length + 5);
  return makePngChunkOffscreen('iTXt', data);
}

function injectContainerMetadataOffscreen(bytes, mime, manifest) {
  const manifestJson = JSON.stringify(manifest);
  const xmp = buildXmpPacketOffscreen(manifest);

  if (
    mime === 'image/png' &&
    bytes.length > 33 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const ihdrLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false);
    const insertOffset = 8 + 12 + ihdrLen;
    if (insertOffset <= bytes.length) {
      const xmpChunk = makePngItxtChunkOffscreen('XML:com.adobe.xmp', xmp);
      const iptcChunk = makePngTextChunkOffscreen('DigitalSourceType', IPTC_SCREEN_CAPTURE_URI);
      const proofChunk = makePngTextChunkOffscreen('yoink-proof', manifestJson);

      const out = new Uint8Array(bytes.length + xmpChunk.length + iptcChunk.length + proofChunk.length);
      let pos = 0;
      out.set(bytes.subarray(0, insertOffset), pos);
      pos += insertOffset;
      out.set(xmpChunk, pos);
      pos += xmpChunk.length;
      out.set(iptcChunk, pos);
      pos += iptcChunk.length;
      out.set(proofChunk, pos);
      pos += proofChunk.length;
      out.set(bytes.subarray(insertOffset), pos);
      return out;
    }
  }

  if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const comPayload = new TextEncoder().encode(`YOINK_PROOF:${manifestJson}`);
    const comLen = comPayload.length + 2;
    const comSegment = new Uint8Array(2 + comLen);
    comSegment[0] = 0xff;
    comSegment[1] = 0xfe;
    comSegment[2] = (comLen >>> 8) & 0xff;
    comSegment[3] = comLen & 0xff;
    comSegment.set(comPayload, 4);

    const xmpNamespace = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
    const xmpBytes = new TextEncoder().encode(xmp);
    const app1BodyLen = xmpNamespace.length + xmpBytes.length + 2;
    let app1Segment = new Uint8Array(0);
    if (app1BodyLen < 65500) {
      app1Segment = new Uint8Array(2 + app1BodyLen);
      app1Segment[0] = 0xff;
      app1Segment[1] = 0xe1;
      app1Segment[2] = (app1BodyLen >>> 8) & 0xff;
      app1Segment[3] = app1BodyLen & 0xff;
      app1Segment.set(xmpNamespace, 4);
      app1Segment.set(xmpBytes, 4 + xmpNamespace.length);
    }

    const out = new Uint8Array(bytes.length + comSegment.length + app1Segment.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(comSegment, 2);
    out.set(app1Segment, 2 + comSegment.length);
    out.set(bytes.subarray(2), 2 + comSegment.length + app1Segment.length);
    return out;
  }

  if (
    mime === 'image/webp' &&
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    const xmpBytes = new TextEncoder().encode(xmp);
    const paddedLen = xmpBytes.length + (xmpBytes.length & 1);
    const xmpChunk = new Uint8Array(8 + paddedLen);
    xmpChunk[0] = 0x58;
    xmpChunk[1] = 0x4d;
    xmpChunk[2] = 0x50;
    xmpChunk[3] = 0x20;
    new DataView(xmpChunk.buffer).setUint32(4, xmpBytes.length, true);
    xmpChunk.set(xmpBytes, 8);

    const out = new Uint8Array(bytes.length + xmpChunk.length);
    out.set(bytes, 0);
    out.set(xmpChunk, bytes.length);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return out;
  }

  return bytes;
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
  return createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
