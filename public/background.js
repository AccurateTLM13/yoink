// background.js - Yoink Service Worker (Manifest V3)
//
// Design rules:
// - Every listener is registered synchronously at the top level.
// - Every message is routed through an allow-list that checks the sender context.
// - Content scripts never receive screenshot pixels. Chunks stay in this worker.
// - The offscreen document answers via sendResponse. It never broadcasts results.
// - History writes are serialized. The history index never stores full images.

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');
const EXT_ORIGIN = chrome.runtime.getURL('');
const IDLE_ALARM = 'yoink-offscreen-idle';
const HISTORY_KEY = 'omnicapture_history';
const SETTINGS_KEY = 'omnicapture_settings';
const FULL_PREFIX = 'yoink_full_';
const MAX_HISTORY = 40;
const MAX_CHUNKS = 80;
// Chrome limit: MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2.
const MIN_CAPTURE_INTERVAL_MS = 550;

const DEFAULT_SETTINGS = Object.freeze({
  format: 'png',
  quality: 0.92,
  scrollDelayMs: 600,
  hideStickyElements: true,
  autoDownload: true,
  copyToClipboard: false,
  filenameTemplate: '{title}_{date}_{time}',
  captureDelaySec: 0,
});

// ---------------------------------------------------------------------------
// Volatile state (lost when the worker sleeps; nothing here must survive that)
// ---------------------------------------------------------------------------
let creatingOffscreen = null;
let activeJobs = 0;
let lastCaptureAt = 0;
let captureQueue = Promise.resolve();
let historyQueue = Promise.resolve();
/** tabId -> { dataUrls: (string|null)[] } */
const scrollSessions = new Map();

// ---------------------------------------------------------------------------
// Top-level listener registration (synchronous)
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  withHistoryLock(migrateStorage).catch((e) => console.error('Storage migration failed:', e));
});
chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab).catch((e) => console.error('Shortcut failed:', e));
});
chrome.runtime.onMessage.addListener(onMessage);
chrome.alarms.onAlarm.addListener((alarm) => {
  onAlarm(alarm).catch((e) => console.warn('Offscreen idle cleanup failed:', e));
});
chrome.tabs.onRemoved.addListener((tabId) => scrollSessions.delete(tabId));

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------
const ROUTES = {
  // Extension UI (popup or options tab)
  CAPTURE_VISIBLE_PART: { from: 'page', run: (p) => handleCaptureVisiblePart(p) },
  CAPTURE_SELECTION_START: { from: 'page', run: (p) => handleCaptureSelectionStart(p) },
  CAPTURE_ELEMENT_SCROLL_START: { from: 'page', run: (p) => handleCaptureElementScrollStart(p) },
  CAPTURE_FULL_PAGE: { from: 'page', run: (p) => handleCaptureFullPage(p) },
  CAPTURE_DESKTOP_START: { from: 'page', run: (p) => handleDesktopCapture(p) },
  CAPTURE_ALL_TABS: { from: 'page', run: (p) => handleCaptureAllTabs(p) },
  CAPTURE_URL_LIST: { from: 'page', run: (p) => handleCaptureUrlList(p) },
  CAPTURE_MULTI_SIZE: { from: 'page', run: (p) => handleCaptureMultiSize(p) },

  // Yoink content script (top frame only)
  CAPTURE_VISIBLE_TAB: { from: 'content', run: (p, s) => handleChunkCapture(p, s) },
  FINALIZE_STITCHING: { from: 'content', run: (p, s) => handleFinalizeStitching(p, s, 'full') },
  FINALIZE_ELEMENT_STITCHING: { from: 'content', run: (p, s) => handleFinalizeStitching(p, s, 'element') },
  CAPTURE_SELECTION_FINISH: { from: 'content', run: (p, s) => handleCaptureSelectionFinish(p, s) },
  CAPTURE_CANCELLED: {
    from: 'content',
    run: (p, s) => {
      scrollSessions.delete(s.tab.id);
      return { ok: true };
    },
  },
};

function senderKind(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return 'foreign';
  const url = sender.url || '';
  if (url.startsWith(OFFSCREEN_URL)) return 'offscreen';
  if (url.startsWith(EXT_ORIGIN)) return 'page';
  if (sender.tab && sender.tab.id >= 0 && sender.frameId === 0) return 'content';
  return 'foreign';
}

function onMessage(message, sender, sendResponse) {
  if (!message || typeof message.action !== 'string') return false;
  const route = Object.prototype.hasOwnProperty.call(ROUTES, message.action) ? ROUTES[message.action] : null;
  if (!route) return false;

  if (senderKind(sender) !== route.from) {
    console.warn(`Rejected "${message.action}" from unauthorized sender`, sender.url);
    sendResponse({ error: 'Unauthorized sender' });
    return false;
  }

  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  Promise.resolve()
    .then(() => route.run(payload, sender))
    .then(
      (result) => sendResponse(result ?? { ok: true }),
      (err) => sendResponse({ error: err?.message || String(err) })
    );
  return true;
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------
async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  return contexts.length > 0;
}

function ensureOffscreen() {
  scheduleOffscreenIdle();
  // Assign synchronously so concurrent callers share 1 creation attempt.
  if (!creatingOffscreen) {
    creatingOffscreen = (async () => {
      if (await hasOffscreen()) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS', 'CLIPBOARD', 'USER_MEDIA'],
        justification: 'Stitch and crop screenshots, encode images, read a desktop capture stream, and copy images to the clipboard.',
      });
    })().finally(() => {
      creatingOffscreen = null;
    });
  }
  return creatingOffscreen;
}

function scheduleOffscreenIdle() {
  chrome.alarms.create(IDLE_ALARM, { delayInMinutes: 1 });
}

async function onAlarm(alarm) {
  if (alarm.name !== IDLE_ALARM) return;
  if (activeJobs > 0 || scrollSessions.size > 0) {
    scheduleOffscreenIdle();
    return;
  }
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

async function withJob(fn) {
  activeJobs++;
  try {
    return await fn();
  } finally {
    activeJobs--;
    scheduleOffscreenIdle();
  }
}

async function callOffscreen(type, payload) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, payload });
  if (!res) throw new Error(`Offscreen document did not answer "${type}"`);
  if (res.error) throw new Error(res.error);
  return res;
}

// ---------------------------------------------------------------------------
// Capture primitives
// ---------------------------------------------------------------------------
function captureVisible(windowId, options) {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = lastCaptureAt + MIN_CAPTURE_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCaptureAt = Date.now();
      try {
        return await chrome.tabs.captureVisibleTab(windowId, options);
      } catch (e) {
        const quota = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(e?.message));
        if (!quota || attempt === 2) throw e;
      }
    }
    throw new Error('captureVisibleTab failed');
  };
  const p = captureQueue.then(run, run);
  captureQueue = p.catch(() => {});
  return p;
}

async function captureAndEncode(windowId, settings) {
  if (settings.format === 'jpeg') {
    return captureVisible(windowId, { format: 'jpeg', quality: Math.round(settings.quality * 100) });
  }
  const png = await captureVisible(windowId, { format: 'png' });
  if (settings.format !== 'webp') return png;
  const res = await callOffscreen('CONVERT_FORMAT', { dataUrl: png, format: 'webp', quality: settings.quality });
  return res.dataUrl;
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
async function handleCommand(command, tab) {
  if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !isInjectableUrl(tab.url)) return;

  const settings = await getSettings();
  const ctx = { tabId: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url, settings };

  if (command === 'capture_full_page') await handleCaptureFullPage(ctx);
  else if (command === 'capture_visible') await handleCaptureVisiblePart(ctx);
  else if (command === 'capture_selection') await handleCaptureSelectionStart(ctx);
}

// ---------------------------------------------------------------------------
// 1. Visible viewport
// ---------------------------------------------------------------------------
async function handleCaptureVisiblePart({ tabId, windowId, title, url, settings }) {
  const s = await getSettings(settings);
  await runCaptureCountdown(s.captureDelaySec);

  let winId = windowId;
  let tabTitle = title;
  let tabUrl = url;
  if (tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) {
      winId = winId ?? tab.windowId;
      tabTitle = tabTitle || tab.title;
      tabUrl = tabUrl || tab.url;
    }
  }

  const dataUrl = await withJob(() => captureAndEncode(winId, s));
  const item = await finishCapture({
    dataUrl,
    mode: 'visible',
    idPrefix: 'vis',
    title: tabTitle || 'Visible Viewport',
    url: tabUrl,
    settings: s,
  });
  return { success: true, dataUrl, item };
}

// ---------------------------------------------------------------------------
// 2. Selection, element and full-page starters
// ---------------------------------------------------------------------------
async function getInjectableTab(tabId, label) {
  if (!tabId) throw new Error('No active tab ID provided.');
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !isInjectableUrl(tab.url)) {
    throw new Error(`${label} cannot run on internal browser pages. Please navigate to a standard website.`);
  }
  return tab;
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
}

async function handleCaptureSelectionStart({ tabId }) {
  const tab = await getInjectableTab(tabId, 'Selection capture');
  await injectContentScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, { action: 'START_SELECTION_CAPTURE' });
  return { success: true };
}

async function handleCaptureElementScrollStart({ tabId, settings }) {
  const tab = await getInjectableTab(tabId, 'Scrolling element capture');
  const s = await getSettings(settings);
  await injectContentScript(tab.id);
  ensureOffscreen().catch(() => {});
  await chrome.tabs.sendMessage(tab.id, {
    action: 'START_ELEMENT_SCROLL_CAPTURE',
    payload: { scrollDelay: s.scrollDelayMs },
  });
  return { success: true };
}

async function handleCaptureFullPage({ tabId, settings }) {
  const tab = await getInjectableTab(tabId, 'Full page capture');
  const s = await getSettings(settings);
  await runCaptureCountdown(s.captureDelaySec);
  await injectContentScript(tab.id);
  ensureOffscreen().catch(() => {});
  await chrome.tabs.sendMessage(tab.id, {
    action: 'START_SCROLL_CAPTURE',
    payload: { scrollDelay: s.scrollDelayMs, hideSticky: s.hideStickyElements },
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// 3. Content-script pipeline (chunks stay in the worker)
// ---------------------------------------------------------------------------
async function handleChunkCapture(payload, sender) {
  const tabId = sender.tab.id;
  const index = Math.max(0, Math.floor(Number(payload.index) || 0));
  if (index === 0) scrollSessions.set(tabId, { dataUrls: [] });

  const session = scrollSessions.get(tabId);
  if (!session) throw new Error('No active scroll session');
  if (session.dataUrls.length >= MAX_CHUNKS) throw new Error('Chunk limit reached');
  if (!sender.tab.active) throw new Error('Tab is not visible');

  const dataUrl = await captureVisible(sender.tab.windowId, { format: 'png' });
  session.dataUrls.push(dataUrl);
  return { ok: true, index: session.dataUrls.length - 1 };
}

function handleFinalizeStitching(payload, sender, kind) {
  const tabId = sender.tab.id;
  const session = scrollSessions.get(tabId);
  scrollSessions.delete(tabId);

  runPipeline(kind, async () => {
    if (!session || session.dataUrls.length === 0) throw new Error('No image chunks received for stitching');
    const s = await getSettings();
    const meta = Array.isArray(payload.chunks) ? payload.chunks : [];
    const jobId = crypto.randomUUID();

    const result = await withJob(async () => {
      await callOffscreen('STITCH_BEGIN', {
        jobId,
        kind,
        totalWidth: num(payload.totalWidth, 0),
        totalHeight: num(payload.totalHeight, 0),
        dpr: num(payload.dpr, 1),
        cropRect: kind === 'element' ? sanitizeRect(payload.cropRect) : null,
        settings: s,
      });
      for (const m of meta) {
        const i = Math.floor(Number(m?.index));
        const dataUrl = session.dataUrls[i];
        if (!dataUrl) continue;
        await callOffscreen('STITCH_ADD', { jobId, dataUrl, yOffset: num(m.yOffset, 0) });
        session.dataUrls[i] = null; // Release memory as soon as the chunk is drawn.
      }
      return callOffscreen('STITCH_END', { jobId });
    });

    const fallbackTitle = kind === 'element' ? 'Scrolling Element Capture' : 'Full Page Capture';
    await finishCapture({
      ...result,
      mode: kind,
      title: str(payload.title, 200) || fallbackTitle,
      url: sender.url || sender.tab.url,
      settings: s,
    });
  });

  return { success: true };
}

function handleCaptureSelectionFinish(payload, sender) {
  const rect = sanitizeRect(payload);
  if (!rect) throw new Error('Invalid selection bounds');

  runPipeline('selection', async () => {
    const s = await getSettings();
    const raw = await captureVisible(sender.tab.windowId, { format: 'png' });
    // Build the payload explicitly. Never spread untrusted input over trusted fields.
    const result = await withJob(() =>
      callOffscreen('CROP_SELECTION', { dataUrl: raw, ...rect, dpr: num(payload.dpr, 1), settings: s })
    );
    await finishCapture({
      ...result,
      mode: 'selection',
      title: str(payload.title, 200) || sender.tab.title || 'Selection Capture',
      url: sender.url || sender.tab.url,
      settings: s,
    });
  });

  return { success: true };
}

function runPipeline(mode, fn) {
  fn().catch((err) => {
    console.error(`${mode} capture failed:`, err);
    broadcast('CAPTURE_FAILED', { error: err?.message || 'Capture failed', mode });
  });
}

// ---------------------------------------------------------------------------
// 4. Shared completion: history, download, clipboard, UI notification
// ---------------------------------------------------------------------------
async function finishCapture(o) {
  const s = o.settings;
  let thumbnailUrl = o.thumbnailUrl || '';
  let width = o.width || 0;
  let height = o.height || 0;

  if (!thumbnailUrl || !width || !height) {
    const t = await generateThumbnail(o.dataUrl);
    thumbnailUrl = thumbnailUrl || t.thumbnailUrl;
    width = width || t.width;
    height = height || t.height;
  }

  const item = {
    id: `${o.idPrefix || o.mode}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    title: o.title || 'Screenshot Capture',
    url: o.url || '',
    dataUrl: o.dataUrl,
    thumbnailUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: o.mode,
    format: s.format,
  };

  await saveHistoryItem(item);

  if (s.autoDownload) {
    const filename = formatFilename(
      s.filenameTemplate,
      o.filenameTitle || item.title,
      item.url,
      o.downloadMode || o.mode,
      s.format,
      width,
      height
    );
    await downloadSafe(item.dataUrl, filename);
  }

  if (s.copyToClipboard && !o.skipClipboard) {
    callOffscreen('COPY_TO_CLIPBOARD', { dataUrl: item.dataUrl })
      .then((r) => {
        if (!r.success) console.warn('Auto copy to clipboard failed');
      })
      .catch((e) => console.warn('Auto copy to clipboard failed:', e));
  }

  if (!o.silent) broadcast('CAPTURE_FINISHED', { item });
  return item;
}

async function downloadSafe(url, filename) {
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  } catch (e) {
    console.warn('Download failed:', e);
  }
}

function broadcast(action, payload) {
  chrome.runtime.sendMessage({ action, payload }).catch(() => {});
}

/** Strips the full image so batch responses stay under the 64 MiB message limit. */
function slimItem(item) {
  return { ...item, dataUrl: '' };
}

// ---------------------------------------------------------------------------
// 5. Desktop capture
// ---------------------------------------------------------------------------
async function handleDesktopCapture({ settings }) {
  const s = await getSettings(settings);
  await runCaptureCountdown(s.captureDelaySec);
  await ensureOffscreen();

  // No target tab: the stream id is then bound to the extension origin,
  // which is the origin of the offscreen document that consumes it.
  const streamId = await new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], (id) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!id) return reject(new Error('Screen capture cancelled'));
      resolve(id);
    });
  });

  const frame = await withJob(() => callOffscreen('CAPTURE_DESKTOP_FRAME', { streamId, settings: s }));
  return finishCapture({
    ...frame,
    mode: 'desktop',
    idPrefix: 'desktop',
    title: 'Desktop Screen Capture',
    url: 'desktop://display',
    settings: s,
  });
}

// ---------------------------------------------------------------------------
// 6. Batch modes (need the optional <all_urls> host permission)
// ---------------------------------------------------------------------------
async function requireAllUrls(label) {
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!granted) {
    throw new Error(`${label} needs access to all sites. Allow access from the Yoink popup and try again.`);
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    // The tab can finish loading before the listener is attached.
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') finish();
    }, finish);
  });
}

async function openGallery(count) {
  await chrome.storage.local
    .set({ pending_view: 'history', last_batch_count: count })
    .catch((e) => console.error('Failed to set pending_view:', e));
  if (count > 0) {
    await chrome.tabs
      .create({ url: chrome.runtime.getURL(`index.html?view=history&batch=${count}`), active: true })
      .catch((e) => console.error('Failed to open history gallery tab:', e));
  }
}

async function handleCaptureAllTabs({ settings }) {
  await requireAllUrls('Capture all tabs');
  const s = await getSettings(settings);
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true, windowType: 'normal' });
  const original = tabs.find((t) => t.active);
  const results = [];

  try {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (!tab.id || !isInjectableUrl(tab.url)) continue;

      broadcast('CAPTURE_PROGRESS', {
        current: i + 1,
        total: tabs.length,
        message: `Capturing tab ${i + 1}/${tabs.length}: ${tab.title || ''}`,
      });

      try {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.discarded || tab.status !== 'complete') await waitForTabComplete(tab.id, 15000);
        await sleep(600);
        const dataUrl = await withJob(() => captureAndEncode(tab.windowId, s));
        const item = await finishCapture({
          dataUrl,
          mode: 'alltabs',
          idPrefix: 'tab',
          downloadMode: 'tab',
          title: tab.title || 'Tab Capture',
          url: tab.url,
          settings: s,
          silent: true,
          skipClipboard: true,
        });
        results.push(slimItem(item));
      } catch (e) {
        console.error(`Failed to capture tab ${tab.id}:`, e);
      }
    }
  } finally {
    if (original?.id) await chrome.tabs.update(original.id, { active: true }).catch(() => {});
  }

  await openGallery(results.length);
  return { success: true, results };
}

async function handleCaptureUrlList({ urls, settings, delayMs }) {
  await requireAllUrls('URL batch capture');
  const s = await getSettings(settings);
  const list = (Array.isArray(urls) ? urls : []).map(normalizeHttpUrl).filter(Boolean).slice(0, 100);
  const hydrationDelay = clampNum(delayMs, 0, 30000, 3000);
  const results = [];

  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    let win = null;
    try {
      broadcast('CAPTURE_PROGRESS', {
        current: i + 1,
        total: list.length,
        message: `Loading URL ${i + 1}/${list.length}: ${url}`,
        url,
      });

      win = await chrome.windows.create({ url, type: 'normal', width: 1440, height: 900, focused: true });
      const tabId = win.tabs?.[0]?.id ?? (await chrome.tabs.query({ windowId: win.id }))[0]?.id;
      if (tabId) await waitForTabComplete(tabId, 15000);
      await sleep(hydrationDelay);

      const dataUrl = await withJob(() => captureAndEncode(win.id, s));
      const item = await finishCapture({
        dataUrl,
        mode: 'urllist',
        idPrefix: 'url',
        title: `URL Capture ${i + 1}`,
        filenameTitle: `url_${i + 1}`,
        url,
        settings: s,
        silent: true,
        skipClipboard: true,
      });
      results.push(slimItem(item));
    } catch (err) {
      console.error(`Failed to capture URL ${url}:`, err);
    } finally {
      if (win?.id) await chrome.windows.remove(win.id).catch(() => {});
    }
  }

  await openGallery(results.length);
  return { success: true, results };
}

async function handleCaptureMultiSize({ url, resolutions, settings }) {
  await requireAllUrls('Multi-size capture');
  const s = await getSettings(settings);
  const target = normalizeHttpUrl(url);
  if (!target) throw new Error('Enter a valid http(s) URL.');

  const sizes = (Array.isArray(resolutions) ? resolutions : [])
    .map((r) => ({
      name: typeof r?.name === 'string' ? r.name.slice(0, 40) : '',
      width: Math.round(clampNum(r?.width, 320, 7680, 0)),
      height: Math.round(clampNum(r?.height, 240, 4320, 0)),
    }))
    .filter((r) => r.width && r.height)
    .slice(0, 20);
  if (sizes.length === 0) return { success: false, results: [] };

  const results = [];
  let win = null;
  try {
    win = await chrome.windows.create({
      url: target,
      type: 'normal',
      state: 'normal',
      width: sizes[0].width,
      height: sizes[0].height,
      focused: true,
    });
    const tabId = win.tabs?.[0]?.id ?? (await chrome.tabs.query({ windowId: win.id }))[0]?.id;
    if (tabId) await waitForTabComplete(tabId, 15000);
    await sleep(2000);

    for (let i = 0; i < sizes.length; i++) {
      const res = sizes[i];
      const label = res.name || `${res.width}x${res.height}`;
      broadcast('CAPTURE_PROGRESS', {
        current: i + 1,
        total: sizes.length,
        message: `Capturing ${label}`,
        name: res.name,
      });

      if (i > 0) {
        await chrome.windows.update(win.id, { width: res.width, height: res.height, state: 'normal' });
        await sleep(1000);
      }

      try {
        const dataUrl = await withJob(() => captureAndEncode(win.id, s));
        const item = await finishCapture({
          dataUrl,
          mode: 'multisize',
          idPrefix: 'ms',
          title: `Responsive ${label}`,
          filenameTitle: `${res.name || 'responsive'}_${res.width}x${res.height}`,
          url: target,
          width: res.width,
          height: res.height,
          settings: s,
          silent: true,
          skipClipboard: true,
        });
        results.push(slimItem(item));
      } catch (e) {
        console.error(`Failed capture at ${label}:`, e);
      }
    }
  } finally {
    if (win?.id) await chrome.windows.remove(win.id).catch(() => {});
  }

  return { success: true, results };
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------
async function runCaptureCountdown(seconds) {
  const total = Math.round(clampNum(seconds, 0, 30, 0));
  if (total === 0) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
    for (let sec = total; sec > 0; sec--) {
      await chrome.action.setBadgeText({ text: String(sec) });
      broadcast('CAPTURE_PROGRESS', { message: `Capturing in ${sec}s…` });
      await sleep(1000);
    }
  } finally {
    await chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Settings (validated)
// ---------------------------------------------------------------------------
async function getSettings(override) {
  if (override && typeof override === 'object') return sanitizeSettings(override);
  try {
    const res = await chrome.storage.sync.get(SETTINGS_KEY);
    return sanitizeSettings(res?.[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    format: ['png', 'jpeg', 'webp'].includes(s.format) ? s.format : 'png',
    quality: clampNum(s.quality, 0.1, 1, DEFAULT_SETTINGS.quality),
    scrollDelayMs: clampNum(s.scrollDelayMs, MIN_CAPTURE_INTERVAL_MS, 5000, DEFAULT_SETTINGS.scrollDelayMs),
    hideStickyElements: s.hideStickyElements !== false,
    autoDownload: s.autoDownload !== false,
    copyToClipboard: s.copyToClipboard === true,
    filenameTemplate:
      typeof s.filenameTemplate === 'string' && s.filenameTemplate.trim()
        ? s.filenameTemplate.slice(0, 120)
        : DEFAULT_SETTINGS.filenameTemplate,
    captureDelaySec: Math.round(clampNum(s.captureDelaySec, 0, 30, 0)),
  };
}

// ---------------------------------------------------------------------------
// History storage (serialized, lightweight index)
// ---------------------------------------------------------------------------
function withHistoryLock(fn) {
  const p = historyQueue.then(fn, fn);
  historyQueue = p.catch(() => {});
  return p;
}

function saveHistoryItem(item) {
  return withHistoryLock(async () => {
    const res = await chrome.storage.local.get(HISTORY_KEY);
    const list = Array.isArray(res?.[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    const merged = [{ ...item, dataUrl: '' }, ...list.filter((x) => x && x.id !== item.id)];
    const kept = merged.slice(0, MAX_HISTORY);
    const evicted = merged.slice(MAX_HISTORY).map((x) => FULL_PREFIX + x.id);

    await chrome.storage.local.set({ [FULL_PREFIX + item.id]: item.dataUrl, [HISTORY_KEY]: kept });
    if (evicted.length) await chrome.storage.local.remove(evicted);
  }).catch((e) => console.error('History save failed:', e));
}

/** One-time repair: move full images out of the index and delete orphaned blobs. */
async function migrateStorage() {
  const keys = chrome.storage.local.getKeys
    ? await chrome.storage.local.getKeys()
    : Object.keys(await chrome.storage.local.get(null));
  const res = await chrome.storage.local.get(HISTORY_KEY);
  const list = Array.isArray(res?.[HISTORY_KEY]) ? res[HISTORY_KEY].filter(Boolean) : [];

  const keySet = new Set(keys);
  const toSet = {};
  const slim = list.slice(0, MAX_HISTORY).map((item) => {
    const k = FULL_PREFIX + item.id;
    if (item.dataUrl && !keySet.has(k)) {
      toSet[k] = item.dataUrl;
      keySet.add(k);
    }
    return { ...item, dataUrl: '' };
  });

  const live = new Set(slim.map((i) => FULL_PREFIX + i.id));
  const orphans = [...keySet].filter((k) => k.startsWith(FULL_PREFIX) && !live.has(k));

  await chrome.storage.local.set({ ...toSet, [HISTORY_KEY]: slim });
  if (orphans.length) await chrome.storage.local.remove(orphans);
}

// ---------------------------------------------------------------------------
// Thumbnail (worker-native, no offscreen document needed)
// ---------------------------------------------------------------------------
async function generateThumbnail(dataUrl, targetWidth = 720) {
  if (!dataUrl) return { thumbnailUrl: '', width: 0, height: 0 };
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const cropHeight = Math.min(height, Math.round(width * 0.75));
    const scale = Math.min(1, targetWidth / width);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(cropHeight * scale));

    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, cropHeight, 0, 0, tw, th);
    bitmap.close();

    const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const bytes = new Uint8Array(await thumbBlob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return { thumbnailUrl: `data:image/jpeg;base64,${btoa(binary)}`, width, height };
  } catch (e) {
    console.warn('Thumbnail generation failed:', e);
    // Never fall back to the full image: that would bloat the history index.
    return { thumbnailUrl: '', width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeRect(r) {
  if (!r || typeof r !== 'object') return null;
  const x = Number(r.x);
  const y = Number(r.y);
  const width = Number(r.width);
  const height = Number(r.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function isInjectableUrl(url) {
  if (!url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'file:'].includes(u.protocol)) return false;
  if (u.hostname === 'chromewebstore.google.com') return false;
  if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return false;
  return true;
}

function normalizeHttpUrl(v) {
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function formatFilename(template, title, url, mode, format, width, height) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  let domain = 'page';
  try {
    if (url) domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_') || 'page';
  } catch {}

  const cleanTitle = (title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const w = width ? String(Math.round(width)) : '';
  const h = height ? String(Math.round(height)) : '';

  // Keep in sync with src/utils/capture.ts.
  let filename = template
    .split('{title}').join(cleanTitle)
    .split('{date}').join(dateStr)
    .split('{time}').join(timeStr)
    .split('{domain}').join(domain)
    .split('{type}').join(mode)
    .split('{width}').join(w)
    .split('{height}').join(h)
    // The template is user input: remove path separators and reserved characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 150);

  if (!filename) filename = 'capture';
  if (!filename.toLowerCase().endsWith(`.${format}`)) filename += `.${format}`;
  return filename;
}
