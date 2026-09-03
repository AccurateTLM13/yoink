// background.js - Yoink Service Worker

let creatingOffscreen = null;

/**
 * Ensures offscreen document is created and ready for heavy lifting.
 */
async function setupOffscreenDocument() {
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
      reasons: ['DOM_PARSER', 'BLOBS', 'WORKERS'],
      justification: 'Stitch image chunks, resize images, and crop selections.',
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
 * Global Keyboard Shortcut Listener
 */
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Received shortcut command:', command);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || tab.url?.startsWith('chrome://')) return;

  const settings = await getSettings();

  if (command === 'capture_full_page') {
    handleCaptureFullPage({ tabId: tab.id, title: tab.title, url: tab.url, settings });
  } else if (command === 'capture_visible') {
    handleCaptureVisiblePart({ tabId: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url, settings });
  } else if (command === 'capture_selection') {
    handleCaptureSelectionStart({ tabId: tab.id, settings });
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

  const item = {
    id: `vis_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: title || 'Visible Viewport',
    url: url || '',
    dataUrl,
    timestamp: Date.now(),
    width: 0,
    height: 0,
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

  return { success: true, dataUrl, item };
}

/**
 * 2. Selection Capture Start
 */
async function handleCaptureSelectionStart({ tabId, settings }) {
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
async function handleCaptureCompleted({ dataUrl, width, height, mode, title, url, settings }) {
  const currentSettings = settings || (await getSettings());

  const item = {
    id: `${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: title || 'Screenshot Capture',
    url: url || '',
    dataUrl,
    timestamp: Date.now(),
    width: width || 0,
    height: height || 0,
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
}

/**
 * 6. Capture All Tabs in Current Window
 */
async function handleCaptureAllTabs({ settings }) {
  const currentSettings = settings || (await getSettings());
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const results = [];

  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) continue;

    try {
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 600));

      const dataUrl = await captureAndProcessTab(tab.windowId, currentSettings);
      if (dataUrl) {
        const item = {
          id: `tab_${Date.now()}_${tab.id}`,
          title: tab.title || 'Tab Capture',
          url: tab.url,
          dataUrl,
          timestamp: Date.now(),
          width: 0,
          height: 0,
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

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    if (!url || !url.startsWith('http')) continue;

    try {
      // Create temporary window
      const win = await chrome.windows.create({
        url,
        width: 1440,
        height: 900,
        focused: true,
      });

      const tabId = win.tabs[0].id;

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

      // Extra hydration delay
      await new Promise((r) => setTimeout(r, delayMs));

      const dataUrl = await captureAndProcessTab(win.id, currentSettings);
      await chrome.windows.remove(win.id);

      if (dataUrl) {
        const item = {
          id: `url_${Date.now()}_${i}`,
          title: `URL Capture ${i + 1}`,
          url,
          dataUrl,
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

  if (!resolutions || resolutions.length === 0) return { success: false };

  const firstRes = resolutions[0];
  const win = await chrome.windows.create({
    url,
    state: 'normal',
    width: firstRes.width,
    height: firstRes.height,
    focused: false,
  });

  const tabId = win.tabs[0].id;

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

  await new Promise((r) => setTimeout(r, 2000));

  for (let i = 0; i < resolutions.length; i++) {
    const res = resolutions[i];

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
        const item = {
          id: `ms_${Date.now()}_${res.width}x${res.height}`,
          title: `Responsive ${res.name || `${res.width}x${res.height}`}`,
          url,
          dataUrl,
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

  try {
    await chrome.windows.remove(win.id);
  } catch (e) {}

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

async function saveHistoryItem(item) {
  try {
    const res = await chrome.storage.local.get(['omnicapture_history']);
    const list = Array.isArray(res?.omnicapture_history) ? res.omnicapture_history : [];
    const updated = [item, ...list.filter((x) => x.id !== item.id)].slice(0, 40);
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
