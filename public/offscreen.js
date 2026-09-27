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

  if (message.action === 'GENERATE_THUMBNAIL') {
    generateThumbnail(message.payload).then((res) => sendResponse(res));
    return true;
  }

  if (message.action === 'COPY_TO_CLIPBOARD') {
    writeToClipboard(message.payload).then((success) => sendResponse({ success }));
    return true;
  }
});

/**
 * 1. Stitch Full Page Chunks into Single Canvas with DPR Scaling & VRAM Reclamation
 */
async function stitchChunks({ chunks, totalWidth, totalHeight, dpr = 1, title, url, settings }) {
  const canvas = document.getElementById('stitchCanvas');
  const MAX_DIMENSION = 16000;

  try {
    if (!chunks || chunks.length === 0) {
      throw new Error('No image chunks received for stitching');
    }

    // Load first chunk to detect actual physical DPR
    const firstImg = await loadBitmap(chunks[0].dataUrl);
    const detectedDpr = (totalWidth > 0 && firstImg.width > 0)
      ? (firstImg.width / totalWidth)
      : (dpr || 1);

    const physicalWidth = firstImg.width || Math.round(totalWidth * detectedDpr);
    const physicalHeight = Math.min(Math.round(totalHeight * detectedDpr), MAX_DIMENSION);

    canvas.width = physicalWidth;
    canvas.height = physicalHeight;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw first chunk
    ctx.drawImage(firstImg, 0, 0);
    if (firstImg.close) firstImg.close();

    // Draw remaining chunks
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      const yPos = Math.round(chunk.yOffset * detectedDpr);
      if (yPos >= MAX_DIMENSION) break;

      const img = await loadBitmap(chunk.dataUrl);
      ctx.drawImage(img, 0, yPos);
      if (img.close) img.close();
    }

    const format = settings?.format || 'png';
    const quality = settings?.quality || 0.92;
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

    const thumbnailUrl = createThumbnailFromCanvas(canvas);
    const finalDataUrl = canvas.toDataURL(mime, quality);

    // Release canvas memory
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;

    chrome.runtime.sendMessage({
      action: 'CAPTURE_COMPLETED',
      payload: {
        dataUrl: finalDataUrl,
        thumbnailUrl,
        width: physicalWidth,
        height: physicalHeight,
        mode: 'full',
        title: title || 'Full Page Capture',
        url: url || '',
        settings,
      },
    });
  } catch (err) {
    console.error('stitchChunks error:', err);
    chrome.runtime.sendMessage({
      action: 'CAPTURE_FAILED',
      payload: { error: err.message || 'Stitching failed', mode: 'full' },
    });
  }
}

/**
 * 2. Crop Selection Region with Clamping & VRAM Reclamation
 */
async function cropSelection({ dataUrl, x, y, width, height, dpr = 1, title, url, settings }) {
  const canvas = document.getElementById('stitchCanvas');
  try {
    const img = await loadBitmap(dataUrl);
    const safeDpr = dpr || 1;

    // Guard coordinates and clamp strictly against image boundaries to prevent IndexSizeError
    const cropX = Math.max(0, Math.min(img.width - 1, Math.round(x * safeDpr)));
    const cropY = Math.max(0, Math.min(img.height - 1, Math.round(y * safeDpr)));
    const cropWidth = Math.max(1, Math.min(Math.round(width * safeDpr), img.width - cropX));
    const cropHeight = Math.max(1, Math.min(Math.round(height * safeDpr), img.height - cropY));

    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    if (img.close) img.close();

    const format = settings?.format || 'png';
    const quality = settings?.quality || 0.92;
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

    const thumbnailUrl = createThumbnailFromCanvas(canvas);
    const finalDataUrl = canvas.toDataURL(mime, quality);

    // Release canvas memory
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;

    chrome.runtime.sendMessage({
      action: 'CAPTURE_COMPLETED',
      payload: {
        dataUrl: finalDataUrl,
        thumbnailUrl,
        width: cropWidth,
        height: cropHeight,
        mode: 'selection',
        title: title || 'Selection Capture',
        url: url || '',
        settings,
      },
    });
  } catch (err) {
    console.error('cropSelection error:', err);
    chrome.runtime.sendMessage({
      action: 'CAPTURE_FAILED',
      payload: { error: err.message || 'Crop selection failed', mode: 'selection' },
    });
  }
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
 * 4. Generate downscaled thumbnail and return image dimensions
 */
async function generateThumbnail({ dataUrl, maxDim = 320 }) {
  try {
    const img = await loadBitmap(dataUrl);
    const origWidth = img.width;
    const origHeight = img.height;

    const scale = Math.min(1, maxDim / Math.max(origWidth, origHeight));
    const tw = Math.max(1, Math.round(origWidth * scale));
    const th = Math.max(1, Math.round(origHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, tw, th);
    if (img.close) img.close();

    const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
    return { thumbnailUrl, width: origWidth, height: origHeight };
  } catch (e) {
    console.warn('generateThumbnail failed:', e);
    return { thumbnailUrl: '', width: 0, height: 0 };
  }
}

/**
 * 5. Write image directly to user clipboard
 */
async function writeToClipboard({ dataUrl }) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    let pngBlob = blob;

    if (blob.type !== 'image/png') {
      const img = await loadBitmap(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (img.close) img.close();
      pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlob }),
    ]);
    return true;
  } catch (e) {
    console.warn('writeToClipboard failed in offscreen:', e);
    return false;
  }
}

/**
 * Quick helper to downscale canvas to thumbnail dataUrl
 */
function createThumbnailFromCanvas(sourceCanvas, targetWidth = 720) {
  try {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (sw === 0 || sh === 0) return '';

    // For tall pages (e.g. full-page scrolls), capture the top hero region so thumbnail is sharp and informative
    const cropHeight = Math.min(sh, Math.round(sw * 0.75));
    const scale = Math.min(1, targetWidth / sw);
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(cropHeight * scale));

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = tw;
    thumbCanvas.height = th;
    const tCtx = thumbCanvas.getContext('2d');
    if (!tCtx) return '';

    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = 'high';
    tCtx.drawImage(sourceCanvas, 0, 0, sw, cropHeight, 0, 0, tw, th);
    return thumbCanvas.toDataURL('image/jpeg', 0.92);
  } catch (e) {
    console.warn('createThumbnailFromCanvas error:', e);
    return '';
  }
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
