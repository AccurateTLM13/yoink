// offscreen.js - Yoink Image Processing Engine

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
 * 1. Stitch Full Page Chunks into Single Canvas with VRAM Reclamation
 */
async function stitchChunks({ chunks, totalWidth, totalHeight, title, url, settings }) {
  const canvas = document.getElementById('stitchCanvas');
  const MAX_DIMENSION = 16000;

  canvas.width = totalWidth;
  canvas.height = Math.min(totalHeight, MAX_DIMENSION);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const chunk of chunks) {
    if (chunk.yOffset >= MAX_DIMENSION) break;

    const img = await loadBitmap(chunk.dataUrl);
    ctx.drawImage(img, 0, chunk.yOffset);
    if (img.close) img.close(); // Close ImageBitmap to free native memory
  }

  const format = settings?.format || 'png';
  const quality = settings?.quality || 0.92;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

  const finalDataUrl = canvas.toDataURL(mime, quality);

  // Immediately release canvas graphics memory
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;

  chrome.runtime.sendMessage({
    action: 'CAPTURE_COMPLETED',
    payload: {
      dataUrl: finalDataUrl,
      width: totalWidth,
      height: Math.min(totalHeight, MAX_DIMENSION),
      mode: 'full',
      title: title || 'Full Page Capture',
      url: url || '',
      settings,
    },
  });
}

/**
 * 2. Crop Selection Region with VRAM Reclamation
 */
async function cropSelection({ dataUrl, x, y, width, height, dpr = 1, title, url, settings }) {
  const canvas = document.getElementById('stitchCanvas');
  const img = await loadBitmap(dataUrl);

  const cropX = Math.round(x * dpr);
  const cropY = Math.round(y * dpr);
  const cropWidth = Math.round(width * dpr);
  const cropHeight = Math.round(height * dpr);

  canvas.width = cropWidth;
  canvas.height = cropHeight;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  if (img.close) img.close();

  const format = settings?.format || 'png';
  const quality = settings?.quality || 0.92;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

  const finalDataUrl = canvas.toDataURL(mime, quality);

  // Immediately release canvas graphics memory
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;

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
 * 3. Convert Image Format / Compression with VRAM Reclamation
 */
async function convertFormat({ dataUrl, format = 'png', quality = 0.92 }) {
  const canvas = document.getElementById('stitchCanvas');
  const img = await loadBitmap(dataUrl);

  canvas.width = img.width;
  canvas.height = img.height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  if (img.close) img.close();

  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const result = canvas.toDataURL(mime, quality);

  // Release canvas graphics memory
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;

  return result;
}

/**
 * High-performance off-thread ImageBitmap decoder
 */
async function loadBitmap(src) {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      return await createImageBitmap(blob);
    } catch {
      // Fallback to Image element
    }
  }
  return await loadImage(src);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
