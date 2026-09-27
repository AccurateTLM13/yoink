// background.js - Yoink Service Worker

let creatingOffscreen = null;
let offscreenIdleTimer = null;

function resetOffscreenIdleTimer() {
  if (offscreenIdleTimer) clearTimeout(offscreenIdleTimer);
  // Auto-close offscreen document after 45 seconds of idle inactivity to release GPU/RAM
  offscreenIdleTimer = setTimeout(async () => {
    try {
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
        console.log('Offscreen document closed after idle timeout.');
      }
    } catch (e) {
      console.warn('Error during offscreen idle cleanup:', e);
    }
  }, 45000);
}

/**
 * Ensures offscreen document is created and ready for heavy lifting.
 */
async function setupOffscreenDocument() {
  resetOffscreenIdleTimer();
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER', 'BLOBS', 'WORKERS', 'CLIPBOARD'],
      justification: 'Stitch image chunks, resize images, crop selections, and copy to clipboard.',
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

/**
 * Capture Tab and Process Format (WebP/JPEG/PNG)
 */
async function captureAndProcessTab(winId, settings) {
  const format = settings?.format || 'png';
  const quality = settings?.quality || 0.92;
  
  if (format === 'jpeg') {
    return await chrome.tabs.captureVisibleTab(winId, { format: 'jpeg', quality: Math.round(quality * 100) });
  } else {
    const dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: 'png' });
    if (format === 'webp') {
      await setupOffscreenDocument();
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'CONVERT_FORMAT',
          payload: { dataUrl, format: 'webp', quality }
        }, (response) => {
          resolve(response?.dataUrl || dataUrl);
        });
      });
    }
    return dataUrl;
  }
}

/**
 * Check if URL can be injected with content scripts
 */
function isInjectableUrl(url) {
  if (!url) return false;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
}

/**
 * Global Keyboard Shortcut Listener
 */
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Received shortcut command:', command);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !isInjectableUrl(tab.url)) return;

  const settings = await getSettings();

  try {
    if (command === 'capture_full_page') {
      await handleCaptureFullPage({ tabId: tab.id, title: tab.title, url: tab.url, settings });
    } else if (command === 'capture_visible') {
      await handleCaptureVisiblePart({ tabId: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url, settings });
    } else if (command === 'capture_selection') {
      await handleCaptureSelectionStart({ tabId: tab.id, settings });
    }
  } catch (err) {
    console.error('Shortcut execution failed:', err);
  }
});

/**
 * Message Dispatcher
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);

  if (message.action === 'CAPTURE_VISIBLE_PART') {
    handleCaptureVisiblePart(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'CAPTURE_SELECTION_START') {
    handleCaptureSelectionStart(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'CAPTURE_SELECTION_FINISH') {
    handleCaptureSelectionFinish(message.payload, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'CAPTURE_FULL_PAGE') {
    handleCaptureFullPage(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'CAPTURE_VISIBLE_TAB') {
    const winId = sender.tab ? sender.tab.windowId : undefined;
    chrome.tabs
      .captureVisibleTab(winId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'FINALIZE_STITCHING') {
    getSettings().then((settings) => {
      chrome.runtime.sendMessage({
        action: 'STITCH_CHUNKS',
        payload: { ...message.payload, settings },
      });
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'CAPTURE_COMPLETED') {
    handleCaptureCompleted(message.payload);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'CAPTURE_FAILED') {
    chrome.runtime.sendMessage({
      action: 'CAPTURE_FAILED',
      payload: message.payload,
    }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'CAPTURE_ALL_TABS') {
    handleCaptureAllTabs(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'CAPTURE_URL_LIST') {
    handleCaptureUrlList(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'CAPTURE_MULTI_SIZE') {
    handleCaptureMultiSize(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

/**
 * 1. Capture Visible Viewport
 */
async function handleCaptureVisiblePart({ tabId, windowId, title, url, settings }) {
  const currentSettings = settings || (await getSettings());
  const winId = windowId || (await chrome.windows.getCurrent()).id;

  const dataUrl = await captureAndProcessTab(winId, currentSettings);
  if (!dataUrl) throw new Error('Failed to capture visible tab');

  await setupOffscreenDocument();

  // Generate thumbnail and determine true physical dimensions directly in worker
  let width = 0;
  let height = 0;
  let thumbnailUrl = '';
  try {
    const thumbRes = await generateThumbnailInWorker(dataUrl);
    thumbnailUrl = thumbRes.thumbnailUrl || '';
    width = thumbRes.width || 0;
    height = thumbRes.height || 0;
  } catch (e) {
    console.warn('Failed to generate thumbnail for visible capture:', e);
  }

  const item = {
    id: `vis_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: title || 'Visible Viewport',
    url: url || '',
    dataUrl,
    thumbnailUrl: thumbnailUrl || dataUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: 'visible',
    format: currentSettings.format || 'png',
  };

  await saveHistoryItem(item);

  if (currentSettings.autoDownload !== false) {
    const filename = formatFilename(
      currentSettings.filenameTemplate || '{title}_{date}_{time}',
      item.title,
      item.url,
      'visible',
      currentSettings.format || 'png'
    );
    chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
    });
  }

  if (currentSettings.copyToClipboard) {
    try {
      chrome.runtime.sendMessage({
        action: 'COPY_TO_CLIPBOARD',
        payload: { dataUrl },
      });
    } catch (e) {
      console.warn('Auto copy to clipboard failed:', e);
    }
  }

  // Broadcast completion event to popup or Studio Hub
  chrome.runtime.sendMessage({
    action: 'CAPTURE_FINISHED',
    payload: { item },
  }).catch(() => {});

  return { success: true, dataUrl, item };
}

/**
 * 2. Selection Capture Start
 */
async function handleCaptureSelectionStart({ tabId, settings }) {
  if (!tabId) throw new Error('No active tab ID provided.');

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !isInjectableUrl(tab.url)) {
    throw new Error('Selection capture cannot run on internal browser pages. Please navigate to a standard website.');
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['content.js'],
  });

  await chrome.tabs.sendMessage(tabId, { action: 'START_SELECTION_CAPTURE' });
  return { success: true };
}

/**
 * 3. Selection Capture Finish (Crop & Process)
 */
async function handleCaptureSelectionFinish(payload, sender) {
  await setupOffscreenDocument();

  const winId = sender.tab ? sender.tab.windowId : undefined;
  const settings = await getSettings();
  const rawDataUrl = await captureAndProcessTab(winId, { format: 'png' });

  chrome.runtime.sendMessage({
    action: 'CROP_SELECTION',
    payload: {
      dataUrl: rawDataUrl,
      ...payload,
      settings,
    },
  });

  return { success: true };
}

/**
 * 4. Full Page Capture
 */
async function handleCaptureFullPage({ tabId, title, url, settings }) {
  if (!tabId) throw new Error('No active tab ID provided.');

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !isInjectableUrl(tab.url)) {
    throw new Error('Full page capture cannot run on internal browser pages. Please navigate to a standard website.');
  }

  await setupOffscreenDocument();

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['content.js'],
  });

  const currentSettings = settings || (await getSettings());
  await chrome.tabs.sendMessage(tabId, {
    action: 'START_SCROLL_CAPTURE',
    payload: {
      scrollDelay: currentSettings.scrollDelayMs || 600,
      hideSticky: currentSettings.hideStickyElements !== false,
    },
  });

  return { success: true };
}

/**
 * 5. Handle Final Processed Capture (from Offscreen document)
 */
async function handleCaptureCompleted({ dataUrl, thumbnailUrl, width, height, mode, title, url, settings }) {
  resetOffscreenIdleTimer();
  const currentSettings = settings || (await getSettings());

  let finalThumb = thumbnailUrl || '';
  let finalWidth = width || 0;
  let finalHeight = height || 0;

  if (!finalThumb && dataUrl) {
    try {
      const thumbRes = await generateThumbnailInWorker(dataUrl);
      finalThumb = thumbRes.thumbnailUrl || '';
      if (!finalWidth && thumbRes.width) finalWidth = thumbRes.width;
      if (!finalHeight && thumbRes.height) finalHeight = thumbRes.height;
    } catch {}
  }

  const item = {
    id: `${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: title || 'Screenshot Capture',
    url: url || '',
    dataUrl,
    thumbnailUrl: finalThumb || dataUrl,
    timestamp: Date.now(),
    width: finalWidth,
    height: finalHeight,
    mode: mode || 'full',
    format: currentSettings.format || 'png',
  };

  await saveHistoryItem(item);

  if (currentSettings.autoDownload !== false) {
    const filename = formatFilename(
      currentSettings.filenameTemplate || '{title}_{date}_{time}',
      item.title,
      item.url,
      mode || 'capture',
      currentSettings.format || 'png'
    );

    chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
    });
  }

  if (currentSettings.copyToClipboard) {
    try {
      chrome.runtime.sendMessage({
        action: 'COPY_TO_CLIPBOARD',
        payload: { dataUrl },
      });
    } catch (e) {
      console.warn('Auto copy to clipboard failed:', e);
    }
  }

  // Broadcast completion so App.tsx can show preview modal and update history!
  chrome.runtime.sendMessage({
    action: 'CAPTURE_FINISHED',
    payload: { item },
  }).catch(() => {});
}

/**
 * 6. Capture All Tabs in Current Window
 */
async function handleCaptureAllTabs({ settings }) {
  const currentSettings = settings || (await getSettings());
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const results = [];
  await setupOffscreenDocument();

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab.id || !tab.url || !isInjectableUrl(tab.url)) continue;

    try {
      // Broadcast progress
      chrome.runtime.sendMessage({
        action: 'CAPTURE_PROGRESS',
        payload: { current: i + 1, total: tabs.length, message: `Capturing tab ${i + 1}/${tabs.length}: ${tab.title}` },
      }).catch(() => {});

      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 600));

      const dataUrl = await captureAndProcessTab(tab.windowId, currentSettings);
      if (dataUrl) {
        let thumbnailUrl = '';
        let width = tab.width || 0;
        let height = tab.height || 0;

        try {
          const tRes = await generateThumbnailInWorker(dataUrl);
          thumbnailUrl = tRes.thumbnailUrl || '';
          if (tRes.width) width = tRes.width;
          if (tRes.height) height = tRes.height;
        } catch {}

        const item = {
          id: `tab_${Date.now()}_${tab.id}`,
          title: tab.title || 'Tab Capture',
          url: tab.url,
          dataUrl,
          thumbnailUrl: thumbnailUrl || dataUrl,
          timestamp: Date.now(),
          width,
          height,
          mode: 'alltabs',
          format: currentSettings.format || 'png',
        };

        await saveHistoryItem(item);

        if (currentSettings.autoDownload !== false) {
          const filename = formatFilename(
            currentSettings.filenameTemplate || '{title}_{date}_{time}',
            item.title,
            item.url,
            'tab',
            currentSettings.format || 'png'
          );
          await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
        }

        results.push(item);
      }
    } catch (e) {
      console.error(`Failed to capture tab ${tab.id}:`, e);
    }
  }

  // Persist pending view for the popup
  try {
    await chrome.storage.local.set({
      pending_view: 'history',
      last_batch_count: results.length,
    });
  } catch (err) {
    console.error('Failed to set pending_view:', err);
  }

  // Pull the user directly into the History Gallery tab
  if (results.length > 0) {
    try {
      const galleryUrl = chrome.runtime.getURL(`index.html?view=history&batch=${results.length}`);
      await chrome.tabs.create({ url: galleryUrl, active: true });
    } catch (tabErr) {
      console.error('Failed to open history gallery tab:', tabErr);
    }
  }

  return { success: true, results };
}

/**
 * 7. Capture List of URLs
 */
async function handleCaptureUrlList({ urls, settings, delayMs = 3000 }) {
  const currentSettings = settings || (await getSettings());
  const results = [];
  await setupOffscreenDocument();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    if (!url || !url.startsWith('http')) continue;

    let win = null;
    try {
      chrome.runtime.sendMessage({
        action: 'CAPTURE_PROGRESS',
        payload: { current: i + 1, total: urls.length, message: `Loading URL ${i + 1}/${urls.length}: ${url}`, url },
      }).catch(() => {});

      // Create temporary window with populate: true to avoid undefined win.tabs
      win = await chrome.windows.create({
        url,
        width: 1440,
        height: 900,
        focused: true,
        populate: true,
      });

      const tabId = (win.tabs && win.tabs[0]) ? win.tabs[0].id : (await chrome.tabs.query({ windowId: win.id }))[0]?.id;

      if (tabId) {
        // Wait for complete loading
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 15000);
          function listener(tId, info) {
            if (tId === tabId && info.status === 'complete') {
              clearTimeout(timeout);
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          }
          chrome.tabs.onUpdated.addListener(listener);
        });
      }

      // Extra hydration delay
      await new Promise((r) => setTimeout(r, delayMs));

      const dataUrl = await captureAndProcessTab(win.id, currentSettings);

      if (dataUrl) {
        let thumbnailUrl = '';
        try {
          const tRes = await generateThumbnailInWorker(dataUrl);
          thumbnailUrl = tRes.thumbnailUrl || '';
        } catch {}

        const item = {
          id: `url_${Date.now()}_${i}`,
          title: `URL Capture ${i + 1}`,
          url,
          dataUrl,
          thumbnailUrl: thumbnailUrl || dataUrl,
          timestamp: Date.now(),
          width: 1440,
          height: 900,
          mode: 'urllist',
          format: currentSettings.format || 'png',
        };

        await saveHistoryItem(item);

        if (currentSettings.autoDownload !== false) {
          const filename = formatFilename(
            currentSettings.filenameTemplate || '{title}_{date}_{time}',
            `url_${i + 1}`,
            url,
            'urllist',
            currentSettings.format || 'png'
          );
          await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
        }

        results.push(item);
      }
    } catch (err) {
      console.error(`Failed to capture URL ${url}:`, err);
    } finally {
      if (win && win.id) {
        try {
          await chrome.windows.remove(win.id);
        } catch (closeErr) {}
      }
    }
  }

  // Persist pending view for the popup
  try {
    await chrome.storage.local.set({
      pending_view: 'history',
      last_batch_count: results.length,
    });
  } catch (err) {
    console.error('Failed to set pending_view:', err);
  }

  // Pull the user directly into the History Gallery tab
  if (results.length > 0) {
    try {
      const galleryUrl = chrome.runtime.getURL(`index.html?view=history&batch=${results.length}`);
      await chrome.tabs.create({ url: galleryUrl, active: true });
    } catch (tabErr) {
      console.error('Failed to open history gallery tab:', tabErr);
    }
  }

  return { success: true, results };
}

/**
 * 8. Multi-Resolution Capture
 */
async function handleCaptureMultiSize({ url, resolutions, settings }) {
  const currentSettings = settings || (await getSettings());
  const results = [];
  await setupOffscreenDocument();

  if (!resolutions || resolutions.length === 0) return { success: false, results: [] };

  const firstRes = resolutions[0];
  let win = null;

  try {
    win = await chrome.windows.create({
      url,
      state: 'normal',
      width: firstRes.width,
      height: firstRes.height,
      focused: false,
      populate: true,
    });

    const tabId = (win.tabs && win.tabs[0]) ? win.tabs[0].id : (await chrome.tabs.query({ windowId: win.id }))[0]?.id;

    if (tabId) {
      // Wait for initial load
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 15000);
        function listener(tId, info) {
          if (tId === tabId && info.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
    }

    await new Promise((r) => setTimeout(r, 2000));

    for (let i = 0; i < resolutions.length; i++) {
      const res = resolutions[i];

      chrome.runtime.sendMessage({
        action: 'CAPTURE_PROGRESS',
        payload: { current: i + 1, total: resolutions.length, message: `Capturing ${res.name || `${res.width}x${res.height}`}`, name: res.name },
      }).catch(() => {});

      if (i > 0) {
        await chrome.windows.update(win.id, {
          width: res.width,
          height: res.height,
          state: 'normal',
        });
        await new Promise((r) => setTimeout(r, 1000));
      }

      try {
        const dataUrl = await captureAndProcessTab(win.id, currentSettings);
        if (dataUrl) {
          let thumbnailUrl = '';
          try {
            const tRes = await generateThumbnailInWorker(dataUrl);
            thumbnailUrl = tRes.thumbnailUrl || '';
          } catch {}

          const item = {
            id: `ms_${Date.now()}_${res.width}x${res.height}`,
            title: `Responsive ${res.name || `${res.width}x${res.height}`}`,
            url,
            dataUrl,
            thumbnailUrl: thumbnailUrl || dataUrl,
            timestamp: Date.now(),
            width: res.width,
            height: res.height,
            mode: 'multisize',
            format: currentSettings.format || 'png',
          };

          await saveHistoryItem(item);

          if (currentSettings.autoDownload !== false) {
            const filename = formatFilename(
              currentSettings.filenameTemplate || '{title}_{date}_{time}',
              `${res.name || 'responsive'}_${res.width}x${res.height}`,
              url,
              'multisize',
              currentSettings.format || 'png'
            );
            await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
          }

          results.push(item);
        }
      } catch (captureError) {
        console.error(`Failed capture at ${res.width}x${res.height}:`, captureError);
      }
    }
  } catch (err) {
    console.error('handleCaptureMultiSize error:', err);
  } finally {
    if (win && win.id) {
      try {
        await chrome.windows.remove(win.id);
      } catch (e) {}
    }
  }

  return { success: true, results };
}

/**
 * Helpers
 */
async function getSettings() {
  const DEFAULT = {
    format: 'png',
    quality: 0.92,
    scrollDelayMs: 600,
    hideStickyElements: true,
    autoDownload: true,
    copyToClipboard: false,
    filenameTemplate: '{title}_{date}_{time}',
  };

  try {
    const res = await chrome.storage.sync.get(['omnicapture_settings']);
    return { ...DEFAULT, ...(res?.omnicapture_settings || {}) };
  } catch (e) {
    return DEFAULT;
  }
}

/**
 * Worker-native high performance thumbnail generator
 * Uses OffscreenCanvas and createImageBitmap without depending on external frames or message ports.
 * Generates sharp, Retina-ready 720px HD card previews.
 */
async function generateThumbnailInWorker(dataUrl, targetWidth = 720) {
  if (!dataUrl) return { thumbnailUrl: '', width: 0, height: 0 };
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const origWidth = bitmap.width;
    const origHeight = bitmap.height;

    // For tall pages (e.g. full-page scrolls), capture the top hero region so thumbnail is sharp and informative
    const cropHeight = Math.min(origHeight, Math.round(origWidth * 0.75));
    const scale = Math.min(1, targetWidth / origWidth);
    const tw = Math.max(1, Math.round(origWidth * scale));
    const th = Math.max(1, Math.round(cropHeight * scale));

    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, origWidth, cropHeight, 0, 0, tw, th);
    bitmap.close();

    const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const buffer = await thumbBlob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    const thumbnailUrl = 'data:image/jpeg;base64,' + btoa(binary);
    return { thumbnailUrl, width: origWidth, height: origHeight };
  } catch (e) {
    console.warn('Worker thumbnail generation fallback:', e);
    return { thumbnailUrl: dataUrl, width: 0, height: 0 };
  }
}

async function saveHistoryItem(item) {
  try {
    // 1. Separate full resolution dataUrl under dedicated key to keep index lightweight
    if (item.dataUrl) {
      await chrome.storage.local.set({ [`yoink_full_${item.id}`]: item.dataUrl });
    }

    // 2. Ensure high-definition thumbnail exists
    let thumb = item.thumbnailUrl;
    if ((!thumb || thumb.length < 500) && item.dataUrl) {
      const generated = await generateThumbnailInWorker(item.dataUrl);
      thumb = generated.thumbnailUrl;
      if (!item.width && generated.width) item.width = generated.width;
      if (!item.height && generated.height) item.height = generated.height;
    }

    const effectiveThumb = thumb || item.dataUrl || '';

    // 3. Preserve full dataUrl on item so user views full-resolution pristine screenshots
    const metaItem = {
      ...item,
      thumbnailUrl: effectiveThumb,
      dataUrl: item.dataUrl || effectiveThumb,
    };

    const res = await chrome.storage.local.get(['omnicapture_history']);
    const list = Array.isArray(res?.omnicapture_history) ? res.omnicapture_history : [];
    const updated = [metaItem, ...list.filter((x) => x.id !== item.id)].slice(0, 40);
    await chrome.storage.local.set({ omnicapture_history: updated });
  } catch (e) {
    console.error('History save error in background:', e);
  }
}

function formatFilename(template, title, url, mode, format) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

  let domain = 'page';
  try {
    if (url) domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
  } catch {}

  const cleanTitle = (title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

  let filename = template
    .replace('{title}', cleanTitle)
    .replace('{date}', dateStr)
    .replace('{time}', timeStr)
    .replace('{domain}', domain)
    .replace('{type}', mode);

  if (!filename.toLowerCase().endsWith(`.${format}`)) {
    filename += `.${format}`;
  }

  return filename;
}
