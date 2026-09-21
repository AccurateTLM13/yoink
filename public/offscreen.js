// offscreen.js - Yoink Image Processing Engine
// Each operation creates its own OffscreenCanvas so concurrent calls cannot
// overwrite each other's in-progress canvas state.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'STITCH_CHUNKS') {
    stitchChunks(message.payload);
  }

  if (message.action === 'CROP_SELECTION') {
    cropSelection(message.payload);
  }

  if (message.action === 'CONVERT_FORMAT') {
    convertFormat(message.payload).then((dataUrl) => sendResponse({ dataUrl }));
    return true;
  }
});

/**
 * 1. Stitch Full Page Chunks into Single Canvas
 * Creates a dedicated OffscreenCanvas — safe to run concurrently.
 */
async function stitchChunks({ chunks, totalWidth, totalHeight, title, url, settings }) {
  const MAX_DIMENSION = 16000;
  const canvasWidth = totalWidth;
  const canvasHeight = Math.min(totalHeight, MAX_DIMENSION);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  for (const chunk of chunks) {
    if (chunk.yOffset >= MAX_DIMENSION) break;
    const img = await loadImage(chunk.dataUrl);
    ctx.drawImage(img, 0, chunk.yOffset);
  }

  const format = settings?.format || 'png';
  const quality = settings?.quality || 0.92;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

  const blob = await canvas.convertToBlob({ type: mime, quality });
  const finalDataUrl = await blobToDataUrl(blob);

  chrome.runtime.sendMessage({
    action: 'CAPTURE_COMPLETED',
    payload: {
      dataUrl: finalDataUrl,
      width: canvasWidth,
      height: canvasHeight,
      mode: 'full',
      title: title || 'Full Page Capture',
      url: url || '',
      settings,
    },
  });
}

/**
 * 2. Crop Selection Region
 * Creates a dedicated OffscreenCanvas — safe to run concurrently.
 */
async function cropSelection({ dataUrl, x, y, width, height, dpr = 1, title, url, settings }) {
  const cropX = Math.round(x * dpr);
  const cropY = Math.round(y * dpr);
  const cropWidth = Math.round(width * dpr);
  const cropHeight = Math.round(height * dpr);

  const canvas = new OffscreenCanvas(cropWidth, cropHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cropWidth, cropHeight);

  const img = await loadImage(dataUrl);
  ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const format = settings?.format || 'png';
  const quality = settings?.quality || 0.92;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

  const blob = await canvas.convertToBlob({ type: mime, quality });
  const finalDataUrl = await blobToDataUrl(blob);

  chrome.runtime.sendMessage({
    action: 'CAPTURE_COMPLETED',
    payload: {
      dataUrl: finalDataUrl,
      width: cropWidth,
      height: cropHeight,
      mode: 'selection',
      title: title || 'Selection Capture',
      url: url || '',
      settings,
    },
  });
}

/**
 * 3. Convert Image Format / Compression
 * Creates a dedicated OffscreenCanvas — safe to run concurrently.
 */
async function convertFormat({ dataUrl, format = 'png', quality = 0.92 }) {
  const img = await loadImage(dataUrl);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);

  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const blob = await canvas.convertToBlob({ type: mime, quality });
  return blobToDataUrl(blob);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Loads a dataUrl into an ImageBitmap (works in offscreen / worker contexts).
 */
async function loadImage(src) {
  const res = await fetch(src);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/**
 * Converts a Blob to a base64 dataUrl string.
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
