/* jshint esversion: 11, expr: true, asi: true */
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
const PROOF_IDENTITY_KEY = 'yoink_proof_identity';
const FOLDER_STATUS_KEY = 'yoink_folder_status';
const FULL_PREFIX = 'yoink_full_';
const MAX_CHUNKS = 80;
const MAX_TOTAL_CHUNKS = 240;
const MAX_SEGMENTS = 10;
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
  optimalQualityMode: false,
  scaleFactor: 1,
  autoSliceLongPages: false,
  maxSliceHeight: 4000,
  losslessWebp: false,
  enableProof: true,
  proofAuthor: '',
  proofVisualStamp: false,
  saveLocationMode: 'downloads',
  customSaveFolderName: '',
  captureAllWindows: false,
});

// ---------------------------------------------------------------------------
// Volatile state (lost when the worker sleeps; nothing here must survive that)
// ---------------------------------------------------------------------------
let creatingOffscreen = null;
let activeJobs = 0;
let lastCaptureAt = 0;
let captureQueue = Promise.resolve();
let historyQueue = Promise.resolve();
/** tabId -> { jobId, kind, settings, chunkCount, streamedCount, dataUrls, originalZoom } */
const scrollSessions = new Map();

async function abortScrollSession(tabId) {
  const session = scrollSessions.get(tabId);
  if (!session) return;
  scrollSessions.delete(tabId);
  if (session.originalZoom != null) {
    chrome.tabs.setZoom(tabId, session.originalZoom).catch(() => {});
  }
  if (session.jobId) {
    await callOffscreen('STITCH_ABORT', { jobId: session.jobId }).catch(() => {});
  }
  if (Array.isArray(session.completedSegments)) {
    for (const seg of session.completedSegments) {
      if (seg?.id) {
        await mutateHistory('delete', { id: seg.id }).catch(() => {});
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Top-level listener registration (synchronous)
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  withHistoryLock(migrateStorage).catch((e) => console.error('Storage migration failed:', e));
});
chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab).catch((e) => recordCaptureFailure(command, e));
});
chrome.runtime.onMessage.addListener(onMessage);
chrome.alarms.onAlarm.addListener((alarm) => {
  onAlarm(alarm).catch((e) => console.warn('Offscreen idle cleanup failed:', e));
});
chrome.tabs.onRemoved.addListener((tabId) => abortScrollSession(tabId));

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
  YOINK_PAGE_MEDIA: { from: 'page', run: (p) => handleYoinkPageMedia(p) },
  CANCEL_MEDIA_SCAN: { from: 'page', run: (p) => handleCancelMediaScan(p) },
  HISTORY_ADD: { from: 'page', run: async (p) => ({ history: await saveHistoryItem(p.item) }) },
  HISTORY_UPDATE: { from: 'page', run: (p) => mutateHistory('update', p) },
  HISTORY_DELETE: { from: 'page', run: (p) => mutateHistory('delete', p) },
  HISTORY_CLEAR: { from: 'page', run: () => mutateHistory('clear', {}) },

  // Yoink content script (top frame only)
  CAPTURE_VISIBLE_TAB: { from: 'content', run: (p, s) => handleChunkCapture(p, s) },
  FINALIZE_STITCHING: { from: 'content', run: (p, s) => handleFinalizeStitching(p, s, 'full') },
  FINALIZE_ELEMENT_STITCHING: { from: 'content', run: (p, s) => handleFinalizeStitching(p, s, 'element') },
  CAPTURE_SELECTION_FINISH: { from: 'content', run: (p, s) => handleCaptureSelectionFinish(p, s) },
  CAPTURE_ABORTED: {
    from: 'content',
    run: async (p, s) => {
      const session = scrollSessions.get(s.tab.id);
      scrollSessions.delete(s.tab.id);
      if (session?.originalZoom != null) chrome.tabs.setZoom(s.tab.id, session.originalZoom).catch(() => {});
      const mode = p.mode === 'element' ? 'element' : 'full';
      await recordCaptureFailure(mode, new Error(str(p.error, 300) || 'Capture was interrupted.'));
      return { ok: true };
    },
  },
  CAPTURE_CANCELLED: {
    from: 'content',
    run: async (p, s) => {
      await abortScrollSession(s.tab.id);
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

async function captureAndEncode(windowId, settings, meta = {}) {
  const png = await captureVisible(windowId, { format: 'png' });
  const proofContext = await buildProofContext(settings, meta.url, meta.title);
  const res = await callOffscreen('PROCESS_CAPTURE', { dataUrl: png, settings, proofContext });
  return typeof res === 'object' && res ? { ...res, dataUrl: res.dataUrl || png } : res;
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
async function handleCaptureVisiblePart({ tabId, windowId, title, url, returnToTabId, settings }) {
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
      if (!tab.active && chrome.tabs.update) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        await sleep(300);
      }
    }
  }

  let encoded;
  try {
    encoded = await withJob(() =>
      captureAndEncode(winId, s, { title: tabTitle || 'Visible Viewport', url: tabUrl || '' })
    );
  } finally {
    if (returnToTabId && returnToTabId !== tabId && chrome.tabs.update) {
      await chrome.tabs.update(returnToTabId, { active: true }).catch(() => {});
    }
  }

  const item = await finishCapture({
    ...encoded,
    mode: 'visible',
    idPrefix: 'vis',
    title: tabTitle || 'Visible Viewport',
    url: tabUrl,
    settings: s,
  });
  return { success: true, dataUrl: encoded.dataUrl, item };
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
  if (!tab.active && chrome.tabs.update) {
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    await sleep(250);
  }
  return tab;
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
}

async function handleCaptureSelectionStart({ tabId, returnToTabId, settings }) {
  const tab = await getInjectableTab(tabId, 'Selection capture');
  const s = await getSettings(settings);
  scrollSessions.set(tab.id, {
    jobId: null,
    kind: 'selection',
    settings: s,
    chunkCount: 0,
    streamedCount: 0,
    dataUrls: [],
    originalZoom: null,
    returnToTabId: returnToTabId || null,
  });
  await injectContentScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, { action: 'START_SELECTION_CAPTURE' });
  return { success: true };
}

async function handleCaptureElementScrollStart({ tabId, returnToTabId, settings }) {
  const tab = await getInjectableTab(tabId, 'Scrolling element capture');
  const s = await getSettings(settings);
  scrollSessions.set(tab.id, {
    jobId: null,
    kind: 'element',
    settings: s,
    chunkCount: 0,
    streamedCount: 0,
    dataUrls: [],
    originalZoom: null,
    returnToTabId: returnToTabId || null,
  });
  await injectContentScript(tab.id);
  ensureOffscreen().catch(() => {});
  await chrome.tabs.sendMessage(tab.id, {
    action: 'START_ELEMENT_SCROLL_CAPTURE',
    payload: { scrollDelay: s.scrollDelayMs },
  });
  return { success: true };
}

async function handleCaptureFullPage({ tabId, returnToTabId, settings }) {
  const tab = await getInjectableTab(tabId, 'Full page capture');
  const s = await getSettings(settings);
  await runCaptureCountdown(s.captureDelaySec);
  await injectContentScript(tab.id);
  ensureOffscreen().catch(() => {});

  let originalZoom = null;
  if (s.scaleFactor && s.scaleFactor > 1) {
    try {
      originalZoom = (await chrome.tabs.getZoom(tab.id)) || 1;
      await chrome.tabs.setZoom(tab.id, originalZoom * s.scaleFactor);
      await sleep(250);
    } catch (e) {
      console.warn('Could not set zoom for high-DPI capture:', e);
    }
  }

  abortScrollSession(tab.id);
  scrollSessions.set(tab.id, {
    jobId: null,
    kind: 'full',
    settings: s,
    chunkCount: 0,
    streamedCount: 0,
    dataUrls: [],
    originalZoom,
    returnToTabId: returnToTabId || null,
  });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'START_SCROLL_CAPTURE',
      payload: { scrollDelay: s.scrollDelayMs, hideSticky: s.hideStickyElements },
    });
  } catch (err) {
    abortScrollSession(tab.id);
    throw err;
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// 3. Content-script pipeline (chunks stream directly to offscreen canvas)
// ---------------------------------------------------------------------------
async function startStitchSegmentSession(stitchMeta, segmentOriginCssY, autoSegment) {
  const jobId = crypto.randomUUID();
  await callOffscreen('STITCH_BEGIN', {
    jobId,
    ...stitchMeta,
    segmentOriginCssY: segmentOriginCssY || 0,
    autoSegment: autoSegment === true,
  });
  return jobId;
}

async function handleChunkCapture(payload, sender) {
  const tabId = sender.tab.id;
  const index = Math.max(0, Math.floor(Number(payload.index) || 0));
  const kind = payload.kind === 'element' ? 'element' : 'full';
  const yOffset = num(payload.yOffset, 0);

  if (index === 0) {
    const existing = scrollSessions.get(tabId);
    if (existing?.jobId) {
      callOffscreen('STITCH_ABORT', { jobId: existing.jobId }).catch(() => {});
    }
    const s = existing?.settings || (await getSettings());
    const capTitle = str(payload.title, 200) || (kind === 'element' ? 'Scrolling Element Capture' : 'Full Page Capture');
    const capUrl = sender.url || sender.tab.url || '';
    const proofContext = await buildProofContext(s, capUrl, capTitle);
    const stitchMeta = {
      kind,
      totalWidth: num(payload.totalWidth, 0),
      totalHeight: num(payload.totalHeight, 0),
      dpr: num(payload.dpr, 1),
      cropRect: kind === 'element' ? sanitizeRect(payload.cropRect) : null,
      settings: s,
      proofContext,
    };

    const jobId = await startStitchSegmentSession(stitchMeta, 0, kind === 'full');
    scrollSessions.set(tabId, {
      jobId,
      kind,
      settings: s,
      stitchMeta,
      chunkCount: 0,
      segmentChunkCount: 0,
      streamedCount: 0,
      dataUrls: [],
      completedSegments: [],
      capTitle,
      capUrl,
      originalZoom: existing?.originalZoom ?? null,
      returnToTabId: existing?.returnToTabId ?? null,
    });
  }

  const session = scrollSessions.get(tabId);
  if (!session) throw new Error('No active scroll session');
  if (kind === 'element' && session.chunkCount >= MAX_CHUNKS) throw new Error('Chunk limit reached');
  if (session.chunkCount >= MAX_TOTAL_CHUNKS || session.completedSegments.length >= MAX_SEGMENTS) {
    return { ok: true, index: session.chunkCount, limitReached: true };
  }
  if (kind === 'full' && session.segmentChunkCount >= MAX_CHUNKS && session.completedSegments.length + 1 >= MAX_SEGMENTS) {
    return { ok: true, index: session.chunkCount, limitReached: true };
  }
  if (!sender.tab.active) throw new Error('Tab is not visible');

  const dataUrl = await captureVisible(sender.tab.windowId, { format: 'png' });
  const capturedIndex = session.chunkCount++;

  if (session.jobId) {
    const addToCurrentJob = () =>
      withJob(() =>
        callOffscreen('STITCH_ADD', {
          jobId: session.jobId,
          dataUrl,
          yOffset,
        })
      );

    const rotateSegment = async (nextOriginY) => {
      const segResult = await withJob(() =>
        callOffscreen('STITCH_END', { jobId: session.jobId, segmented: true })
      );
      const segId = `${kind}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      await saveHistoryItem({
        id: segId,
        title: session.capTitle || (kind === 'element' ? 'Scrolling Element Capture' : 'Full Page Capture'),
        url: session.capUrl || '',
        dataUrl: segResult.dataUrl,
        thumbnailUrl: segResult.thumbnailUrl || '',
        timestamp: Date.now(),
        width: segResult.width || 0,
        height: segResult.height || 0,
        mode: kind,
        format: session.settings.format,
        proofKeyId: segResult.proofKeyId || undefined,
        proofSigned: segResult.proofSigned === true,
        warning: segResult.warning || undefined,
      });
      // Release encoded dataUrl from scrollSessions RAM immediately; finalization streams from storage.
      session.completedSegments.push({
        id: segId,
        width: segResult.width || 0,
        height: segResult.height || 0,
        thumbnailUrl: segResult.thumbnailUrl || '',
        proofKeyId: segResult.proofKeyId || undefined,
        proofSigned: segResult.proofSigned === true,
        warning: segResult.warning || undefined,
      });
      if (session.completedSegments.length >= MAX_SEGMENTS) {
        session.jobId = null;
        return false;
      }
      session.jobId = await startStitchSegmentSession(session.stitchMeta, nextOriginY, kind === 'full');
      session.segmentChunkCount = 0;
      return true;
    };

    if (kind === 'full' && session.segmentChunkCount >= MAX_CHUNKS) {
      await rotateSegment(yOffset);
    }

    let addRes = await addToCurrentJob();
    if (addRes?.segmentFull && kind === 'full') {
      const nextOrigin = num(addRes.nextSegmentOriginCssY, yOffset);
      const continued = await rotateSegment(nextOrigin);
      if (!continued) {
        return { ok: true, index: capturedIndex, limitReached: true };
      }
      addRes = await addToCurrentJob();
    }

    session.segmentChunkCount = (session.segmentChunkCount || 0) + 1;
    session.streamedCount++;
  } else {
    session.dataUrls.push(dataUrl);
  }

  return {
    ok: true,
    index: capturedIndex,
    limitReached: session.chunkCount >= MAX_TOTAL_CHUNKS,
  };
}

function handleFinalizeStitching(payload, sender, kind) {
  const tabId = sender.tab.id;
  const session = scrollSessions.get(tabId);
  scrollSessions.delete(tabId);

  if (session?.originalZoom != null) {
    chrome.tabs.setZoom(tabId, session.originalZoom).catch(() => {});
  }
  if (session?.returnToTabId && session.returnToTabId !== tabId && chrome.tabs.update) {
    chrome.tabs.update(session.returnToTabId, { active: true }).catch(() => {});
  }

  runPipeline(kind, async () => {
    if (!session || (session.streamedCount === 0 && session.dataUrls.length === 0 && !(session.completedSegments?.length))) {
      throw new Error('No image chunks received for stitching');
    }
    const s = await getSettings(session.settings);

    const fallbackTitle = kind === 'element' ? 'Scrolling Element Capture' : 'Full Page Capture';
    const capTitle = str(payload.title, 200) || session.capTitle || fallbackTitle;
    const capUrl = sender.url || sender.tab.url || session.capUrl || '';
    const proofContext = session.stitchMeta?.proofContext || (await buildProofContext(s, capUrl, capTitle));
    const completedSegments = Array.isArray(session.completedSegments) ? [...session.completedSegments] : [];

    if (session.jobId && session.streamedCount > 0) {
      const tail = await withJob(() =>
        callOffscreen('STITCH_END', { jobId: session.jobId, segmented: completedSegments.length > 0 })
      );
      completedSegments.push(tail);
    } else if (completedSegments.length === 0) {
      const meta = Array.isArray(payload.chunks) ? payload.chunks : [];
      const jobId = crypto.randomUUID();
      await withJob(async () => {
        await callOffscreen('STITCH_BEGIN', {
          jobId,
          kind,
          totalWidth: num(payload.totalWidth, 0),
          totalHeight: num(payload.totalHeight, 0),
          dpr: num(payload.dpr, 1),
          cropRect: kind === 'element' ? sanitizeRect(payload.cropRect) : null,
          settings: s,
          proofContext,
        });
        for (const m of meta) {
          const i = Math.floor(Number(m?.index));
          const dataUrl = session.dataUrls[i];
          if (!dataUrl) continue;
          await callOffscreen('STITCH_ADD', { jobId, dataUrl, yOffset: num(m.yOffset, 0) });
          session.dataUrls[i] = null;
        }
        const res = await callOffscreen('STITCH_END', { jobId });
        completedSegments.push(res);
      });
    }

    const totalParts = completedSegments.length;
    const missedCount = Number(payload.missedSections) || 0;
    const hasSegmentWarning = completedSegments.some((seg) => Boolean(seg?.warning));
    const isIncomplete = Boolean(
      payload.limitReached || payload.scrollStalled || missedCount > 0 || hasSegmentWarning
    );

    const notes = [];
    if (payload.limitReached) notes.push('Capture stopped at the maximum page-length safety limit.');
    if (payload.scrollStalled) notes.push('Page prevented further scrolling before reaching the bottom.');
    if (missedCount > 0) {
      notes.push(`${missedCount} section(s) could not be captured.`);
    }
    const extraNotice = notes.join(' ');

    const loadSegmentDataUrl = async (seg) => {
      if (seg?.dataUrl) return seg.dataUrl;
      if (seg?.id) {
        const key = FULL_PREFIX + seg.id;
        const stored = await chrome.storage.local.get(key);
        return stored?.[key] || '';
      }
      return '';
    };

    if (totalParts === 1) {
      const single = completedSegments[0];
      const singleDataUrl = await loadSegmentDataUrl(single);
      const combinedWarning = [single.warning, extraNotice].filter(Boolean).join(' ') || undefined;
      await finishCapture({
        ...single,
        dataUrl: singleDataUrl,
        warning: combinedWarning,
        mode: kind,
        title: capTitle,
        url: capUrl,
        settings: s,
      });
      return;
    }

    for (let idx = 0; idx < totalParts; idx++) {
      const seg = completedSegments[idx];
      const segDataUrl = await loadSegmentDataUrl(seg);
      const partNum = idx + 1;
      const splitNotice = isIncomplete
        ? `Partial segmented capture (Part ${partNum} of ${totalParts}): capture stopped before completing the entire page.`
        : `Oversized page was automatically split into ${totalParts} parts (Part ${partNum} of ${totalParts}) to capture the full page.`;
      const combinedWarning = [splitNotice, extraNotice, seg.warning].filter(Boolean).join(' ');
      await finishCapture({
        ...seg,
        dataUrl: segDataUrl,
        mode: kind,
        title: `${capTitle} (Part ${partNum} of ${totalParts})`,
        filenameTitle: capTitle,
        downloadSuffix: `_part${partNum}_of_${totalParts}`,
        skipAutoSlice: true,
        url: capUrl,
        settings: s,
        warning: combinedWarning,
        silent: idx < totalParts - 1,
        skipClipboard: idx < totalParts - 1,
      });
    }
  });

  return { success: true };
}

function handleCaptureSelectionFinish(payload, sender) {
  const rect = sanitizeRect(payload);
  if (!rect) throw new Error('Invalid selection bounds');
  const tabId = sender.tab.id;
  const session = scrollSessions.get(tabId);
  scrollSessions.delete(tabId);

  runPipeline('selection', async () => {
    const s = await getSettings(session?.settings);
    const capTitle = str(payload.title, 200) || sender.tab.title || 'Selection Capture';
    const capUrl = sender.url || sender.tab.url || '';
    const proofContext = await buildProofContext(s, capUrl, capTitle);
    const raw = await captureVisible(sender.tab.windowId, { format: 'png' });
    if (session?.returnToTabId && session.returnToTabId !== tabId && chrome.tabs.update) {
      chrome.tabs.update(session.returnToTabId, { active: true }).catch(() => {});
    }
    const result = await withJob(() =>
      callOffscreen('CROP_SELECTION', {
        dataUrl: raw,
        ...rect,
        dpr: num(payload.dpr, 1),
        settings: s,
        proofContext,
      })
    );
    await finishCapture({
      ...result,
      mode: 'selection',
      title: capTitle,
      url: capUrl,
      settings: s,
    });
  });

  return { success: true };
}

function runPipeline(mode, fn) {
  fn().catch((err) => {
    console.error(`${mode} capture failed:`, err);
    recordCaptureFailure(mode, err);
  });
}

async function recordCaptureFailure(mode, error) {
  const detail = { mode, error: String(error?.message || 'Capture failed').slice(0, 300) };
  await chrome.storage.local.set({ yoink_last_capture_error: detail }).catch(() => {});
  broadcast('CAPTURE_FAILED', detail);
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
    id: o.id || `${o.idPrefix || o.mode}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    title: o.title || 'Screenshot Capture',
    url: o.url || '',
    dataUrl: o.dataUrl,
    thumbnailUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: o.mode,
    format: s.format,
    ...(o.viewport ? { viewport: o.viewport } : {}),
    proofKeyId: o.proofKeyId || undefined,
    proofSigned: o.proofSigned === true,
    warning: o.warning || undefined,
  };

  let historyError = null;
  try {
    await saveHistoryItem(item);
  } catch (error) {
    historyError = error;
  }
  let downloaded = false;
  let downloadWarning = '';

  if (s.autoDownload) {
    let filename = formatFilename(
      s.filenameTemplate,
      o.filenameTitle || item.title,
      item.url,
      o.downloadMode || o.mode,
      s.format,
      width,
      height
    );
    if (o.downloadSuffix) filename = filename.replace(/(\.[a-z0-9]+)$/i, `${o.downloadSuffix}$1`);
    if (item.warning && !o.downloadSuffix) filename = filename.replace(/(\.[a-z0-9]+)$/i, '_partial$1');

    try {
      if (s.autoSliceLongPages && !o.skipAutoSlice && o.mode === 'full' && height > (s.maxSliceHeight || 4000)) {
        try {
          const sliceProofContext = await buildProofContext(s, item.url, item.title);
          const sliceRes = await callOffscreen('SLICE_IMAGE', {
            dataUrl: item.dataUrl,
            maxSliceHeight: s.maxSliceHeight || 4000,
            settings: s,
            proofContext: sliceProofContext,
          });
          if (sliceRes && Array.isArray(sliceRes.slices) && sliceRes.slices.length > 1) {
            for (const slice of sliceRes.slices) {
              const partFn = filename.replace(/(\.[a-z0-9]+)$/i, `_part${slice.part}_of_${slice.total}$1`);
              await downloadSafe(slice.dataUrl, partFn, s);
              await sleep(150);
            }
          } else {
            await downloadSafe(item.dataUrl, filename, s);
          }
        } catch (err) {
          if (s.saveLocationMode === 'folder') throw err;
          console.warn('Auto-slice download failed, falling back to full image download:', err);
          await downloadSafe(item.dataUrl, filename, s);
          downloadWarning = 'Some slices could not be saved. The full image was downloaded instead.';
        }
      } else {
        await downloadSafe(item.dataUrl, filename, s);
      }
      downloaded = true;
    } catch (error) {
      downloadWarning =
        s.saveLocationMode === 'folder'
          ? `${error?.message || 'Could not save to selected folder.'} Saved to Gallery — open Yoink to grant access or download manually.`
          : `Download could not be confirmed: ${error?.message || 'Unknown error'}. Check Downloads and try again from the gallery.`;
    }
  }

  if (historyError && !downloaded) {
    throw new Error(`Capture could not be saved to the gallery${s.autoDownload ? ' or confirmed in Downloads' : ''}. Check available storage and try again.`);
  }
  const warnings = [item.warning, historyError ? 'Downloaded, but the gallery could not save this capture.' : '', downloadWarning].filter(Boolean);
  item.warning = warnings.join(' ') || undefined;
  if (historyError) item.historySaved = false;
  if (!historyError && item.warning) {
    await saveHistoryItem(item).catch((error) => console.warn('Could not save capture warning:', error));
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

async function downloadSafe(url, filename, settings) {
  const mode = settings?.saveLocationMode || 'downloads';
  if (mode === 'folder') {
    const res = await callOffscreen('SAVE_TO_FOLDER', { url, filename });
    if (res?.ok) {
      await chrome.storage.local.set({
        [FOLDER_STATUS_KEY]: {
          state: 'ready',
          folderName: res.folderName || settings?.customSaveFolderName || '',
          updatedAt: Date.now(),
        },
      }).catch(() => {});
      return;
    }
    const reason = res?.reason || 'error';
    const folderName = res?.folderName || settings?.customSaveFolderName || '';
    const errMsg = res?.message || res?.error || 'Could not save to selected folder.';
    await chrome.storage.local.set({
      [FOLDER_STATUS_KEY]: {
        state: reason,
        folderName,
        error: errMsg,
        updatedAt: Date.now(),
      },
    }).catch(() => {});
    throw new Error(errMsg);
  }

  const saveAs = mode === 'ask';
  const id = await chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
  if (!chrome.downloads?.onChanged || !chrome.downloads?.search) return;
  await new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(new Error(error)); else resolve();
    };
    const onChanged = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted') finish(delta.error?.current || 'Download interrupted');
    };
    const timer = setTimeout(() => finish('Timed out while checking download status'), 60000);
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then((items) => {
      const item = items[0];
      if (item?.state === 'complete') finish();
      else if (item?.state === 'interrupted') finish(item.error || 'Download interrupted');
    }, (error) => finish(error?.message || 'Could not check download status'));
  });
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

  const streamId = await new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], (id) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!id) return reject(new Error('Screen capture cancelled'));
      resolve(id);
    });
  });

  const proofContext = await buildProofContext(s, 'desktop://display', 'Desktop Screen Capture');
  const frame = await withJob(() =>
    callOffscreen('CAPTURE_DESKTOP_FRAME', { streamId, settings: s, proofContext })
  );
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
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error); else resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error('Page did not finish loading in time.')), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') finish();
    }, (error) => finish(error));
  });
}

async function handleCaptureAllTabs({ settings, tabIds, allWindows }) {
  await requireAllUrls('Capture all tabs');
  const s = await getSettings(settings);
  const includeAllWindows = allWindows === true || s.captureAllWindows === true;
  const allTabs = await chrome.tabs.query(
    includeAllWindows ? { windowType: 'normal' } : { lastFocusedWindow: true, windowType: 'normal' }
  );
  const tabs = Array.isArray(tabIds) ? allTabs.filter((tab) => tabIds.includes(tab.id)) : allTabs;

  // Record active tab per window so multi-window sweeps restore every window cleanly
  const originalActiveByWindow = new Map();
  for (const t of allTabs) {
    if (t.active && t.id && t.windowId != null && !originalActiveByWindow.has(t.windowId)) {
      originalActiveByWindow.set(t.windowId, t.id);
    }
  }
  const originalFallback = allTabs.find((t) => t.active);

  const results = [];
  const captured = [];
  const failures = [];
  const skipped = [];

  try {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (!tab.id || !isInjectableUrl(tab.url)) {
        skipped.push({
          target: tab.title || tab.url || 'Unknown tab',
          reason: 'Restricted browser page cannot be captured.',
          tabId: tab.id,
        });
        continue;
      }

      broadcast('CAPTURE_PROGRESS', {
        current: i + 1,
        total: tabs.length,
        message: `Capturing tab ${i + 1}/${tabs.length}: ${tab.title || ''}`,
      });

      try {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.discarded || tab.status !== 'complete') await waitForTabComplete(tab.id, 15000);
        await sleep(600);
        const encoded = await withJob(() =>
          captureAndEncode(tab.windowId, s, { title: tab.title || 'Tab Capture', url: tab.url || '' })
        );
        const item = await finishCapture({
          ...encoded,
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
        captured.push({ target: item.title || tab.url || 'Tab', reason: tab.url || 'Captured', tabId: tab.id });
      } catch (e) {
        const msg = e?.message || 'Capture failed';
        failures.push({ target: tab.title || tab.url || String(tab.id), reason: msg, error: msg, tabId: tab.id });
      }
    }
  } finally {
    if (originalActiveByWindow.size > 0) {
      for (const origTabId of originalActiveByWindow.values()) {
        await chrome.tabs.update(origTabId, { active: true }).catch(() => {});
      }
    } else if (originalFallback?.id) {
      await chrome.tabs.update(originalFallback.id, { active: true }).catch(() => {});
    }
  }

  return { success: true, results, captured, failures, skipped };
}

async function handleCaptureUrlList({ urls, settings, delayMs }) {
  await requireAllUrls('URL batch capture');
  const s = await getSettings(settings);
  const requested = Array.isArray(urls) ? urls : [];
  const results = [];
  const failures = [];
  const skipped = [];
  const list = [];

  for (const raw of requested) {
    const url = normalizeHttpUrl(raw);
    if (!url) {
      failures.push({ target: String(raw).slice(0, 200), reason: 'Invalid URL.', error: 'Invalid URL.' });
    } else if (list.length >= 100) {
      skipped.push({ target: url, reason: 'Batch limit is 100 URLs.' });
    } else {
      list.push(url);
    }
  }

  const hydrationDelay = clampNum(delayMs, 0, 30000, 3000);

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

      const encoded = await withJob(() =>
        captureAndEncode(win.id, s, { title: `URL Capture ${i + 1}`, url })
      );
      const item = await finishCapture({
        ...encoded,
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
      const msg = err?.message || 'Capture failed';
      failures.push({ target: url, reason: msg, error: msg });
    } finally {
      if (win?.id) await chrome.windows.remove(win.id).catch(() => {});
    }
  }

  return { success: true, results, failures, skipped };
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
  if (sizes.length === 0) {
    return {
      success: false,
      results: [],
      failures: [{ target: 'Viewports', reason: 'No valid viewport sizes were provided.', error: 'No valid viewport sizes were provided.' }],
      skipped: [],
    };
  }

  const results = [];
  const failures = [];
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

      try {
        let viewport;
        for (let attempt = 0; attempt < 3; attempt++) {
          const measured = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }),
          });
          viewport = measured[0]?.result;
          if (!viewport) throw new Error('Could not measure the page viewport.');
          if (viewport.width === res.width && viewport.height === res.height) break;
          const current = await chrome.windows.get(win.id);
          await chrome.windows.update(win.id, {
            width: Math.max(320, current.width + res.width - viewport.width),
            height: Math.max(240, current.height + res.height - viewport.height),
            state: 'normal',
          });
          await sleep(1000);
        }
        const finalMeasurement = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }),
        });
        viewport = finalMeasurement[0]?.result;
        if (!viewport) throw new Error('Could not measure the page viewport.');
        const encoded = await withJob(() =>
          captureAndEncode(win.id, s, { title: `Responsive ${label}`, url: target })
        );
        const item = await finishCapture({
          ...encoded,
          mode: 'multisize',
          idPrefix: 'ms',
          title: `Responsive ${label}`,
          filenameTitle: `${res.name || 'responsive'}_${res.width}x${res.height}`,
          url: target,
          viewport: { ...viewport, requestedWidth: res.width, requestedHeight: res.height },
          width: encoded.width || res.width,
          height: encoded.height || res.height,
          settings: s,
          silent: true,
          skipClipboard: true,
        });
        results.push(slimItem(item));
      } catch (e) {
        const msg = e?.message || 'Capture failed';
        failures.push({ target: label, reason: msg, error: msg });
      }
    }
  } finally {
    if (win?.id) await chrome.windows.remove(win.id).catch(() => {});
  }

  return { success: true, results, failures, skipped: [] };
}

// ---------------------------------------------------------------------------
// 8. Yoink Page Media (Images, SVGs, CSS Backgrounds, OpenGraph, Clean <video> Frames)
// ---------------------------------------------------------------------------
async function handleCancelMediaScan({ tabId }) {
  if (!tabId) return { ok: false };
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: () => {
        window.__yoinkMediaScanSeq = (Number(window.__yoinkMediaScanSeq) || 0) + 1;
      },
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function handleYoinkPageMedia({ tabId }) {
  let targetTab = null;

  if (tabId) {
    targetTab = await chrome.tabs.get(tabId).catch(() => null);
  }

  if (!targetTab || !isInjectableUrl(targetTab.url)) {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTabs[0] && isInjectableUrl(activeTabs[0].url)) {
      targetTab = activeTabs[0];
    } else {
      const allWindowTabs = await chrome.tabs.query({ currentWindow: true });
      const candidates = allWindowTabs.filter((t) => t.id && isInjectableUrl(t.url));
      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        targetTab = candidates[0];
      }
    }
  }

  if (!targetTab || !targetTab.id || !isInjectableUrl(targetTab.url)) {
    throw new Error('No open website tab found to yoink media from. Open any website tab and try again.');
  }

  const execRes = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id, allFrames: false },
    func: extractAllPageMediaInTab,
  });

  const rawResult = execRes?.[0]?.result;
  const items = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.items) ? rawResult.items : [];
  const diagnostics =
    rawResult && !Array.isArray(rawResult) && rawResult.diagnostics
      ? rawResult.diagnostics
      : { crossOriginFrames: 0, taintedCanvases: 0, protectedVideos: 0, scanTruncated: false, cancelled: false, scannedElements: 0 };

  return {
    success: true,
    items,
    diagnostics,
    tabId: targetTab.id,
    tabTitle: targetTab.title || 'Webpage',
    tabUrl: targetTab.url || '',
  };
}

async function extractAllPageMediaInTab() {
  const CHUNK_SIZE = 200;
  const MAX_SCAN_MS = 4500;
  const MAX_ROOTS = 64;
  const scanSeq = (Number(window.__yoinkMediaScanSeq) || 0) + 1;
  window.__yoinkMediaScanSeq = scanSeq;

  const getNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  const scanStart = getNow();
  const isCancelled = () => Number(window.__yoinkMediaScanSeq) !== scanSeq;
  const isOverBudget = () => getNow() - scanStart >= MAX_SCAN_MS;
  const yieldToMain = () =>
    typeof setTimeout === 'function' ? new Promise((resolve) => setTimeout(resolve, 0)) : Promise.resolve();

  const seen = new Set();
  const items = [];
  const diagnostics = {
    crossOriginFrames: 0,
    taintedCanvases: 0,
    protectedVideos: 0,
    scanTruncated: false,
    cancelled: false,
    scannedElements: 0,
  };
  const pageUrl = window.location.href;
  const pageTitle = document.title || 'Webpage';
  let counter = 0;

  const resolveUrlWithBase = (raw, baseUrl) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed === 'none' || trimmed === 'about:blank') return null;
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
    try {
      return new URL(trimmed, baseUrl || pageUrl).href;
    } catch {
      return null;
    }
  };

  const pickBestSrcsetWithBase = (srcset, baseUrl) => {
    if (!srcset || typeof srcset !== 'string') return null;
    const parts = srcset.split(/,\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
    let bestUrl = null;
    let bestScore = -1;
    for (const part of parts) {
      const tokens = part.split(/\s+/);
      const u = tokens[0];
      if (!u) continue;
      let score = 1;
      if (tokens.length > 1) {
        const desc = tokens[tokens.length - 1].toLowerCase();
        if (desc.endsWith('w')) {
          const w = parseFloat(desc.slice(0, -1));
          if (Number.isFinite(w) && w > 0) score = w;
        } else if (desc.endsWith('x')) {
          const x = parseFloat(desc.slice(0, -1));
          if (Number.isFinite(x) && x > 0) score = x * 1000;
        }
      }
      const resolved = resolveUrlWithBase(u, baseUrl);
      if (resolved && score >= bestScore) {
        bestScore = score;
        bestUrl = resolved;
      }
    }
    return { url: bestUrl, score: bestScore };
  };

  const inferFmt = (url, category) => {
    if (category === 'svg') return 'svg';
    const lower = String(url || '').toLowerCase();
    if (lower.startsWith('data:image/svg')) return 'svg';
    if (lower.startsWith('data:image/png')) return 'png';
    if (lower.startsWith('data:image/jpeg') || lower.startsWith('data:image/jpg')) return 'jpeg';
    if (lower.startsWith('data:image/webp')) return 'webp';
    if (lower.startsWith('data:image/gif')) return 'gif';
    if (lower.startsWith('data:image/avif')) return 'avif';
    try {
      const parsed = new URL(url, pageUrl);
      const path = parsed.pathname.toLowerCase();
      const fmt = (parsed.searchParams.get('format') || parsed.searchParams.get('fm') || '').toLowerCase();
      if (path.endsWith('.svg') || fmt === 'svg') return 'svg';
      if (path.endsWith('.png') || fmt === 'png') return 'png';
      if (path.endsWith('.webp') || fmt === 'webp') return 'webp';
      if (path.endsWith('.gif') || fmt === 'gif') return 'gif';
      if (path.endsWith('.avif') || fmt === 'avif') return 'avif';
      if (path.endsWith('.jpg') || path.endsWith('.jpeg') || fmt === 'jpg' || fmt === 'jpeg') return 'jpeg';
    } catch {}
    if (category === 'video' || category === 'canvas') return 'png';
    return 'unknown';
  };

  const deriveName = (url, hint, category, idx) => {
    const cleanHint = String(hint || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (cleanHint.length >= 2) return cleanHint;
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        const u = new URL(url, pageUrl);
        const segs = u.pathname.split('/').filter(Boolean);
        const last = segs[segs.length - 1];
        if (last) {
          const withoutExt = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '');
          const cleaned = withoutExt.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
          if (cleaned.length >= 2) return cleaned;
        }
      } catch {}
    }
    return `${category.toUpperCase()}_Asset_${idx}`;
  };

  const addItem = ({ url, nameHint, category, width, height, sourceTag, svgCode }) => {
    if (!url || seen.has(url)) return;
    if (url.startsWith('data:image/gif;base64,R0lGOD')) return;
    seen.add(url);
    counter++;
    items.push({
      id: `yoink_${category}_${counter}_${Date.now()}`,
      url,
      name: deriveName(url, nameHint, category, counter),
      category,
      format: inferFmt(url, category),
      width: Math.round(Number(width) || 0),
      height: Math.round(Number(height) || 0),
      sourceTag,
      svgCode,
      pageUrl,
      pageTitle,
    });
  };

  // Recursively gather documents, open shadow roots, and accessible same-origin iframes
  const roots = [];
  const visitedRoots = new Set();
  const rootQueue = [{ root: document, ownerDoc: document, baseUrl: pageUrl, isDocument: true }];

  while (rootQueue.length > 0) {
    if (roots.length >= MAX_ROOTS || isOverBudget()) {
      diagnostics.scanTruncated = true;
      break;
    }
    const entry = rootQueue.shift();
    if (!entry?.root || visitedRoots.has(entry.root)) continue;
    visitedRoots.add(entry.root);
    roots.push(entry);

    let allInRoot = [];
    try {
      allInRoot = Array.from(entry.root.querySelectorAll('*'));
    } catch {}

    for (let rIdx = 0; rIdx < allInRoot.length; rIdx++) {
      const el = allInRoot[rIdx];
      if (el.shadowRoot && !visitedRoots.has(el.shadowRoot)) {
        rootQueue.push({
          root: el.shadowRoot,
          ownerDoc: entry.ownerDoc,
          baseUrl: entry.baseUrl,
          isDocument: false,
        });
      }
      if (String(el.tagName || '').toUpperCase() === 'IFRAME') {
        try {
          const frameDoc = el.contentDocument;
          if (frameDoc && !visitedRoots.has(frameDoc)) {
            const frameUrl = frameDoc.location?.href || entry.baseUrl;
            rootQueue.push({
              root: frameDoc,
              ownerDoc: frameDoc,
              baseUrl: frameUrl,
              isDocument: true,
            });
          } else if (!frameDoc) {
            diagnostics.crossOriginFrames++;
          }
        } catch {
          diagnostics.crossOriginFrames++;
        }
      }
      if ((rIdx + 1) % (CHUNK_SIZE * 4) === 0) {
        if (isOverBudget()) {
          diagnostics.scanTruncated = true;
          break;
        }
        await yieldToMain();
        if (isCancelled()) {
          diagnostics.cancelled = true;
          return { items, diagnostics };
        }
      }
    }
    if (diagnostics.scanTruncated) break;
  }

  const LAZY_ATTRS = [
    'data-hi-res-src',
    'data-full-src',
    'data-zoom-image',
    'data-original',
    'data-src',
    'data-lazy-src',
    'data-lazy',
    'data-url',
    'data-image',
  ];
  const LAZY_SRCSET_ATTRS = ['srcset', 'data-srcset', 'data-lazy-srcset'];

  const getComputed = (el, pseudo) => {
    try {
      const view = el?.ownerDocument?.defaultView || window;
      return view.getComputedStyle(el, pseudo);
    } catch {
      return window.getComputedStyle(el, pseudo);
    }
  };

  const pickBestFromLazySrcset = (el, baseUrl, bestUrl, bestScore) => {
    let nextUrl = bestUrl;
    let nextScore = bestScore;
    let foundSrcset = false;
    for (const attr of LAZY_SRCSET_ATTRS) {
      const rawSrcset = el.getAttribute(attr);
      if (rawSrcset) {
        foundSrcset = true;
        const picked = pickBestSrcsetWithBase(rawSrcset, baseUrl);
        if (picked?.url && picked.score >= nextScore) {
          nextUrl = picked.url;
          nextScore = picked.score;
        }
      }
    }
    return { bestUrl: nextUrl, bestScore: nextScore, foundSrcset };
  };

  const resolveSvgInheritedStyles = (origEl, cloneEl) => {
    try {
      const cs = getComputed(origEl);
      if (!cs) return;
      const currentColor = cs.color && cs.color !== 'inherit' ? cs.color : '';
      const stylePairs = [];
      const props = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-rule', 'clip-rule'];
      for (const prop of props) {
        let val = cs[prop] || (typeof cs.getPropertyValue === 'function' ? cs.getPropertyValue(prop) : '');
        if (!val || (val === 'none' && prop === 'stroke')) continue;
        if (val === 'currentColor' && currentColor) val = currentColor;
        if (val) stylePairs.push(`${prop}:${val}`);
      }
      if (origEl.getAttribute('fill') === 'currentColor' && currentColor) {
        cloneEl.setAttribute('fill', currentColor);
      }
      if (origEl.getAttribute('stroke') === 'currentColor' && currentColor) {
        cloneEl.setAttribute('stroke', currentColor);
      }
      if (currentColor) {
        stylePairs.unshift(`color:${currentColor}`);
      }
      if (stylePairs.length > 0 && cloneEl.setAttribute) {
        const existingStyle = cloneEl.getAttribute('style') || '';
        cloneEl.setAttribute('style', existingStyle ? `${existingStyle};${stylePairs.join(';')}` : stylePairs.join(';'));
      }
    } catch {}
  };

  const inlineExternalSvgSymbols = (origSvg, cloneSvg, ownerDoc, root) => {
    try {
      const uses = Array.from(origSvg.querySelectorAll('use'));
      if (uses.length === 0) return;
      const defs = ownerDoc.createElementNS ? ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'defs') : null;
      if (!defs) return;
      let added = 0;
      const addedIds = new Set();
      for (const u of uses) {
        const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
        if (!href.startsWith('#')) continue;
        const targetId = href.slice(1);
        if (!targetId || addedIds.has(targetId)) continue;
        const refNode =
          (root.getElementById ? root.getElementById(targetId) : null) ||
          (root.querySelector ? root.querySelector(`[id="${targetId}"]`) : null) ||
          (ownerDoc.getElementById ? ownerDoc.getElementById(targetId) : null);
        if (refNode && !origSvg.querySelector?.(`#${targetId}`)) {
          defs.appendChild(refNode.cloneNode(true));
          addedIds.add(targetId);
          added++;
        }
      }
      if (added > 0 && cloneSvg.insertBefore) {
        cloneSvg.insertBefore(defs, cloneSvg.firstChild || null);
      }
    } catch {}
  };

  const seenSvgHashes = new Set();
  const urlRegex = /url\(\s*(?:(['"])(.*?)\1|([^)'"]+))\s*\)/gi;
  const SKIP_BG_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'BASE',
    'BR', 'WBR', 'PATH', 'CIRCLE', 'RECT', 'POLYGON', 'POLYLINE', 'LINE', 'ELLIPSE',
    'G', 'DEFS', 'SYMBOL', 'USE', 'CLIPPATH', 'MASK', 'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'PATTERN',
  ]);
  const REPLACED_TAGS = new Set([
    'IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT',
    'AUDIO', 'SOURCE', 'TRACK', 'EMBED', 'OBJECT', 'PICTURE',
  ]);

  for (const { root, ownerDoc, baseUrl, isDocument } of roots) {
    if (isCancelled()) {
      diagnostics.cancelled = true;
      return { items, diagnostics };
    }
    if (isOverBudget()) {
      diagnostics.scanTruncated = true;
      break;
    }
    // 1. <video> Clean Frame Snaps + Posters
    let videos = [];
    try { videos = Array.from(root.querySelectorAll('video')); } catch {}
    videos.forEach((v, idx) => {
      const vw = v.videoWidth || v.clientWidth || 0;
      const vh = v.videoHeight || v.clientHeight || 0;
      if (v.readyState >= 2 && vw > 16 && vh > 16) {
        try {
          const c = ownerDoc.createElement('canvas');
          c.width = vw;
          c.height = vh;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0, vw, vh);
            const dataUrl = c.toDataURL('image/png');
            addItem({
              url: dataUrl,
              nameHint: v.getAttribute('title') || v.getAttribute('aria-label') || `Clean_Video_Frame_${idx + 1}`,
              category: 'video',
              width: vw,
              height: vh,
              sourceTag: '<video> Clean Frame',
            });
          }
        } catch {
          diagnostics.protectedVideos++;
        }
      }
      if (v.poster) {
        const posterUrl = resolveUrlWithBase(v.poster, baseUrl);
        if (posterUrl) {
          addItem({
            url: posterUrl,
            nameHint: `Video_Poster_${idx + 1}`,
            category: 'video',
            width: vw,
            height: vh,
            sourceTag: '<video poster>',
          });
        }
      }
    });

    // 2. OpenGraph, Twitter Cards & High-Res Icons (documents only)
    if (isDocument) {
      const metaSelectors = [
        { sel: 'meta[property="og:image"], meta[property="og:image:secure_url"]', tag: 'meta og:image', hint: 'OpenGraph_Social_Banner' },
        { sel: 'meta[name="twitter:image"], meta[property="twitter:image"]', tag: 'meta twitter:image', hint: 'Twitter_Card_Banner' },
        { sel: 'link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]', tag: 'apple-touch-icon', hint: 'Apple_Touch_Icon' },
        { sel: 'link[rel="icon"], link[rel="shortcut icon"]', tag: 'link favicon', hint: 'Site_Favicon' },
      ];
      metaSelectors.forEach(({ sel, tag, hint }) => {
        try {
          root.querySelectorAll(sel).forEach((el) => {
            const raw = el.getAttribute('content') || el.getAttribute('href');
            const resolved = resolveUrlWithBase(raw, baseUrl);
            if (resolved) {
              addItem({
                url: resolved,
                nameHint: hint,
                category: 'og',
                width: tag.includes('og:') || tag.includes('twitter:') ? 1200 : 180,
                height: tag.includes('og:') || tag.includes('twitter:') ? 630 : 180,
                sourceTag: tag,
              });
            }
          });
        } catch {}
      });
    }

    // 3. <img> and <picture> elements (highest-res srcset + lazy-load attributes)
    let imgs = [];
    try { imgs = Array.from(root.querySelectorAll('img')); } catch {}
    imgs.forEach((img) => {
      let { bestUrl, bestScore, foundSrcset } = pickBestFromLazySrcset(img, baseUrl, null, -1);

      const parentPic = typeof img.closest === 'function' ? img.closest('picture') : null;
      if (parentPic) {
        const sources = Array.from(parentPic.querySelectorAll('source'));
        for (const s of sources) {
          const picked = pickBestFromLazySrcset(s, baseUrl, bestUrl, bestScore);
          bestUrl = picked.bestUrl;
          bestScore = picked.bestScore;
          foundSrcset = foundSrcset || picked.foundSrcset;
        }
      }

      if (!bestUrl) {
        const directCandidates = [img.currentSrc, img.src, ...LAZY_ATTRS.map((a) => img.getAttribute(a))];
        for (const cand of directCandidates) {
          const resolved = resolveUrlWithBase(cand, baseUrl);
          if (resolved && !resolved.startsWith('data:image/gif;base64,R0lGOD')) {
            bestUrl = resolved;
            break;
          }
        }
      }

      if (bestUrl) {
        const w = img.naturalWidth || img.width || img.clientWidth || 0;
        const h = img.naturalHeight || img.height || img.clientHeight || 0;
        addItem({
          url: bestUrl,
          nameHint: img.alt || img.title || '',
          category: 'img',
          width: w,
          height: h,
          sourceTag: foundSrcset ? '<img srcset>' : '<img>',
        });
      }
    });

    // 4. Inline <svg> vectors (no 80-SVG cap, inherited CSS styles & external <use> symbols resolved)
    let svgs = [];
    try { svgs = Array.from(root.querySelectorAll('svg')); } catch {}
    svgs.forEach((svg, idx) => {
      const rect = svg.getBoundingClientRect();
      const w = Math.round(rect.width || parseFloat(svg.getAttribute('width') || '0') || 64);
      const h = Math.round(rect.height || parseFloat(svg.getAttribute('height') || '0') || 64);
      if (w < 12 || h < 12) return;

      try {
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!clone.getAttribute('viewBox') && w > 0 && h > 0) {
          clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
        if (!clone.getAttribute('width')) clone.setAttribute('width', String(w));
        if (!clone.getAttribute('height')) clone.setAttribute('height', String(h));

        resolveSvgInheritedStyles(svg, clone);
        const origShapes = Array.from(svg.querySelectorAll('path, circle, rect, polygon, polyline, line, ellipse, text, g, use'));
        const cloneShapes = Array.from(clone.querySelectorAll('path, circle, rect, polygon, polyline, line, ellipse, text, g, use'));
        for (let sIdx = 0; sIdx < Math.min(origShapes.length, cloneShapes.length); sIdx++) {
          resolveSvgInheritedStyles(origShapes[sIdx], cloneShapes[sIdx]);
        }
        inlineExternalSvgSymbols(svg, clone, ownerDoc, root);

        const rawMarkup = new XMLSerializer().serializeToString(clone);
        if (rawMarkup.length > 350000 || seenSvgHashes.has(rawMarkup)) return;
        seenSvgHashes.add(rawMarkup);

        const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(rawMarkup)}`;
        const label =
          svg.getAttribute('aria-label') ||
          svg.querySelector('title')?.textContent ||
          svg.id ||
          `Vector_SVG_${idx + 1}`;

        addItem({
          url: dataUrl,
          nameHint: label,
          category: 'svg',
          width: w,
          height: h,
          sourceTag: 'Inline <svg>',
          svgCode: rawMarkup,
        });
      } catch {}
    });

    // 5. CSS background-image across ALL elements in root (chunked & budgeted; no 1200-element cap)
    let allElements = [];
    try { allElements = Array.from(root.querySelectorAll('*')); } catch {}
    for (let elIdx = 0; elIdx < allElements.length; elIdx++) {
      const el = allElements[elIdx];
      if (!el) continue;
      diagnostics.scannedElements++;
      const tag = String(el.tagName || '').toUpperCase();
      if (!SKIP_BG_TAGS.has(tag)) {
        const styles = [getComputed(el)];
        if (!REPLACED_TAGS.has(tag)) {
          const beforeSt = getComputed(el, '::before');
          if (beforeSt && beforeSt.content && beforeSt.content !== 'none' && beforeSt.content !== 'normal') {
            styles.push(beforeSt);
          }
          const afterSt = getComputed(el, '::after');
          if (afterSt && afterSt.content && afterSt.content !== 'none' && afterSt.content !== 'normal') {
            styles.push(afterSt);
          }
        }
        for (const st of styles) {
          const bg = st?.backgroundImage;
          if (!bg || bg === 'none' || !bg.includes('url(')) continue;
          urlRegex.lastIndex = 0;
          let match;
          while ((match = urlRegex.exec(bg)) !== null) {
            const raw = (match[2] ?? match[3] ?? '').trim();
            const resolved = resolveUrlWithBase(raw, baseUrl);
            if (resolved) {
              const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { width: 0, height: 0 };
              addItem({
                url: resolved,
                nameHint: el.getAttribute('aria-label') || el.id || '',
                category: 'bg',
                width: Math.round(rect.width || 0),
                height: Math.round(rect.height || 0),
                sourceTag: 'CSS background-image',
              });
            }
          }
        }
      }
      if ((elIdx + 1) % CHUNK_SIZE === 0) {
        if (isOverBudget()) {
          diagnostics.scanTruncated = true;
          break;
        }
        await yieldToMain();
        if (isCancelled()) {
          diagnostics.cancelled = true;
          return { items, diagnostics };
        }
      }
    }
    if (diagnostics.scanTruncated) break;

    // 6. <canvas> graphics
    let canvases = [];
    try { canvases = Array.from(root.querySelectorAll('canvas')); } catch {}
    canvases.forEach((c, idx) => {
      if (c.width >= 32 && c.height >= 32) {
        try {
          const dataUrl = c.toDataURL('image/png');
          addItem({
            url: dataUrl,
            nameHint: c.getAttribute('aria-label') || c.id || `Canvas_Graphic_${idx + 1}`,
            category: 'canvas',
            width: c.width,
            height: c.height,
            sourceTag: '<canvas>',
          });
        } catch {
          diagnostics.taintedCanvases++;
        }
      }
    });
  }

  return { items, diagnostics };
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
  let stored = null;
  try {
    const localRes = await chrome.storage.local.get(SETTINGS_KEY);
    if (localRes?.[SETTINGS_KEY] && typeof localRes[SETTINGS_KEY] === 'object') {
      stored = localRes[SETTINGS_KEY];
    }
  } catch {}
  const merged = {
    ...(stored || {}),
    ...(override && typeof override === 'object' ? override : {}),
  };
  if (stored?.proofAuthor && !merged.proofAuthor) {
    merged.proofAuthor = stored.proofAuthor;
  }
  return sanitizeSettings(merged);
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
    optimalQualityMode: s.optimalQualityMode === true,
    scaleFactor: [1, 1.5, 2, 3].includes(Number(s.scaleFactor)) ? Number(s.scaleFactor) : 1,
    autoSliceLongPages: s.autoSliceLongPages === true,
    maxSliceHeight: Math.round(clampNum(s.maxSliceHeight, 1000, 10000, 4000)),
    losslessWebp: s.losslessWebp === true,
    enableProof: s.enableProof !== false,
    proofAuthor: typeof s.proofAuthor === 'string' ? s.proofAuthor.trim().slice(0, 60) : '',
    proofVisualStamp: s.proofVisualStamp === true,
    saveLocationMode: ['downloads', 'folder', 'ask'].includes(s.saveLocationMode) ? s.saveLocationMode : 'downloads',
    customSaveFolderName: typeof s.customSaveFolderName === 'string' ? s.customSaveFolderName.trim().slice(0, 120) : '',
    captureAllWindows: s.captureAllWindows === true,
  };
}

// ---------------------------------------------------------------------------
// Yoink Proof™ Cryptographic Identity (ECDSA P-256)
// ---------------------------------------------------------------------------
let cachedProofIdentity = null;

async function getOrCreateProofIdentity() {
  if (cachedProofIdentity) return cachedProofIdentity;
  try {
    const res = await chrome.storage.local.get(PROOF_IDENTITY_KEY);
    const stored = res?.[PROOF_IDENTITY_KEY];
    if (stored?.keyFingerprint && stored?.privateKeyJwk && stored?.pubRawB64Url) {
      cachedProofIdentity = stored;
      return stored;
    }
  } catch {}
  if (typeof crypto === 'undefined' || !crypto?.subtle?.generateKey) return null;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const pubRawBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', pubRawBytes));
  const hex = Array.from(hashBytes.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  const keyFingerprint = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;

  let binary = '';
  for (let i = 0; i < pubRawBytes.length; i++) binary += String.fromCharCode(pubRawBytes[i]);
  const pubRawB64Url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const identity = {
    keyFingerprint,
    pubRawB64Url,
    publicKeyJwk,
    privateKeyJwk,
    createdAt: Date.now(),
  };
  cachedProofIdentity = identity;
  await chrome.storage.local.set({ [PROOF_IDENTITY_KEY]: identity }).catch(() => {});
  return identity;
}

async function buildProofContext(settings, url, title) {
  if (settings.enableProof === false && !settings.proofVisualStamp) {
    return null;
  }
  try {
    const identity = await getOrCreateProofIdentity();
    if (!identity) return null;
    return {
      identity,
      url: String(url || ''),
      title: String(title || 'Screenshot'),
      author: settings.proofAuthor || '',
    };
  } catch (err) {
    console.warn('Could not build proof context:', err);
    return null;
  }
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
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.dataUrl !== 'string' || !item.dataUrl) {
      throw new Error('Cannot save a capture without its original image.');
    }
    const res = await chrome.storage.local.get(HISTORY_KEY);
    const list = Array.isArray(res?.[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    const merged = [{ ...item, dataUrl: '' }, ...list.filter((x) => x && x.id !== item.id)];
    await chrome.storage.local.set({ [FULL_PREFIX + item.id]: item.dataUrl, [HISTORY_KEY]: merged });
    return merged;
  });
}

function mutateHistory(operation, payload) {
  return withHistoryLock(async () => {
    const res = await chrome.storage.local.get(HISTORY_KEY);
    const list = Array.isArray(res?.[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    if (operation === 'clear') {
      await chrome.storage.local.remove([HISTORY_KEY, ...list.map((item) => FULL_PREFIX + item.id)]);
      return { history: [] };
    }
    const id = str(payload.id, 200);
    if (!id) throw new Error('Missing capture ID.');
    if (operation === 'update') {
      const updates = payload.updates && typeof payload.updates === 'object' ? payload.updates : {};
      const history = list.map((item) => (item.id === id ? { ...item, ...updates, id: item.id, dataUrl: '' } : item));
      await chrome.storage.local.set({ [HISTORY_KEY]: history });
      return { history };
    }
    const history = list.filter((item) => item.id !== id);
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
    await chrome.storage.local.remove(FULL_PREFIX + id).catch((error) => console.warn('Image cleanup failed:', error));
    return { history };
  });
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
  const slim = list.map((item) => {
    const k = FULL_PREFIX + item.id;
    if (item.dataUrl && !keySet.has(k)) {
      toSet[k] = item.dataUrl;
      keySet.add(k);
    }
    return { ...item, dataUrl: '' };
  });

  await chrome.storage.local.set({ ...toSet, [HISTORY_KEY]: slim });
}

// ---------------------------------------------------------------------------
// Thumbnail (worker-native, no offscreen document needed)
// ---------------------------------------------------------------------------
function decodeDataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    throw new Error('Invalid image data URL');
  }
  const commaIdx = dataUrl.indexOf(',');
  const semiIdx = dataUrl.indexOf(';');
  const mime = dataUrl.slice(5, semiIdx);
  const b64 = dataUrl.slice(commaIdx + 1);
  if (typeof atob === 'function' && typeof Blob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
  return { type: mime, size: b64.length };
}

async function generateThumbnail(dataUrl, targetWidth = 720) {
  if (!dataUrl) return { thumbnailUrl: '', width: 0, height: 0 };
  try {
    const blob = decodeDataUrlToBlob(dataUrl);
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
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

function sanitizeFilenameSegment(value) {
  let out = '';
  for (const ch of String(value || '')) {
    const code = ch.charCodeAt(0);
    if (code < 32 || '\\/:*?"<>|'.includes(ch)) {
      out += '_';
    } else {
      out += ch;
    }
  }
  return out;
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

  let cleanTitle = (title || 'capture')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!cleanTitle) cleanTitle = 'capture';
  const w = width ? String(Math.round(width)) : '';
  const h = height ? String(Math.round(height)) : '';

  // Keep in sync with src/utils/capture.ts.
  const substituted = template
    .split('{title}').join(cleanTitle)
    .split('{date}').join(dateStr)
    .split('{time}').join(timeStr)
    .split('{domain}').join(domain)
    .split('{type}').join(mode)
    .split('{width}').join(w)
    .split('{height}').join(h);

  // The template is user input: remove path separators and reserved characters.
  let filename = sanitizeFilenameSegment(substituted)
    .replace(/^\.+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 150);

  if (!filename) filename = 'capture';
  if (!filename.toLowerCase().endsWith(`.${format}`)) filename += `.${format}`;
  return filename;
}
