import { CaptureSettings, HistoryItem } from '../types';

export const DEFAULT_SETTINGS: CaptureSettings = {
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
};

/**
 * Optimal Quality Configuration Preset
 * Automatically sets lossless PNG, 2x Retina scale, 900ms scroll delay,
 * and anti-squish slicing for ultra-crisp results that won't be crushed by upload platforms.
 */
export const OPTIMAL_QUALITY_PRESET: Partial<CaptureSettings> = {
  optimalQualityMode: true,
  format: 'png',
  scaleFactor: 2,
  scrollDelayMs: 900,
  autoSliceLongPages: true,
  maxSliceHeight: 4000,
  losslessWebp: true,
  quality: 1.0,
};

export function applyOptimalQualityPreset(current: CaptureSettings): CaptureSettings {
  return {
    ...current,
    ...OPTIMAL_QUALITY_PRESET,
    scrollDelayMs: Math.max(current.scrollDelayMs || 600, 900),
  };
}

const SETTINGS_KEY = 'omnicapture_settings';
const HISTORY_KEY = 'omnicapture_history';
const FULL_IMAGE_PREFIX = 'yoink_full_';
const MAX_HISTORY_ITEMS = 40;

// In-memory full-resolution image cache so signed full images are never lost if localStorage quota is reached
const memoryFullImageCache = new Map<string, string>();

function cacheFullImage(key: string, dataUrl: string): void {
  if (!dataUrl) return;
  memoryFullImageCache.delete(key);
  memoryFullImageCache.set(key, dataUrl);
  if (memoryFullImageCache.size > MAX_HISTORY_ITEMS) {
    const oldestKey = memoryFullImageCache.keys().next().value;
    if (oldestKey) memoryFullImageCache.delete(oldestKey);
  }
}

async function mutateExtensionHistory(action: string, payload: object): Promise<HistoryItem[] | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.runtime.sendMessage) return null;
  const response = await chrome.runtime.sendMessage({ action, payload });
  if (response?.error) throw new Error(response.error);
  if (!Array.isArray(response?.history)) throw new Error('Could not update capture history.');
  return response.history as HistoryItem[];
}

/**
 * Generate a downscaled thumbnail from full dataUrl for fast index rendering
 */
export async function createThumbnail(dataUrl: string, targetWidth: number = 720): Promise<string> {
  if (!dataUrl) return '';
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = img;
        // For tall pages, capture top hero region so preview is crisp and recognizable
        const cropHeight = Math.min(height, Math.round(width * 0.75));
        const scale = Math.min(1, targetWidth / width);
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(cropHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, cropHeight, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Save full resolution image separately under dedicated key
 */
export async function saveFullResolutionImage(id: string, dataUrl: string): Promise<void> {
  const key = `${FULL_IMAGE_PREFIX}${id}`;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [key]: dataUrl });
    cacheFullImage(key, dataUrl);
    return;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, dataUrl);
      cacheFullImage(key, dataUrl);
    }
  } catch (e) {
    throw new Error('Could not save the original image to local storage.', { cause: e });
  }
}

/**
 * Retrieve full resolution image on-demand (for preview, download, copy, or proof verification)
 */
export async function getFullResolutionImage(id: string): Promise<string | null> {
  const key = `${FULL_IMAGE_PREFIX}${id}`;
  const mem = memoryFullImageCache.get(key);
  if (mem && mem.length > 0) return mem;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get([key]);
      if (res && typeof res[key] === 'string' && res[key].length > 0) {
        cacheFullImage(key, res[key] as string);
        return res[key] as string;
      }
    }
  } catch (e) {
    console.warn('Chrome storage full image fetch failed', e);
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const local = localStorage.getItem(key);
      if (local && local.length > 0) {
        cacheFullImage(key, local);
        return local;
      }
    }
  } catch {}

  // Fallback to checking the history item directly
  try {
    const history = await getStoredHistory();
    const item = history.find((i) => i.id === id);
    if (item && item.dataUrl && item.dataUrl.length > 0) return item.dataUrl;
  } catch {}

  return null;
}

/**
 * Load user settings with fallback to defaults.
 * Checks chrome.storage.local, chrome.storage.sync, and localStorage so changes are never lost.
 */
export async function getStoredSettings(): Promise<CaptureSettings> {
  let localStored: Partial<CaptureSettings> | null = null;
  let syncStored: Partial<CaptureSettings> | null = null;
  let domStored: Partial<CaptureSettings> | null = null;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get([SETTINGS_KEY]);
      if (res && res[SETTINGS_KEY] && typeof res[SETTINGS_KEY] === 'object') {
        localStored = res[SETTINGS_KEY] as Partial<CaptureSettings>;
      }
    }
  } catch {}

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const result = await chrome.storage.sync.get([SETTINGS_KEY]);
      if (result && result[SETTINGS_KEY] && typeof result[SETTINGS_KEY] === 'object') {
        syncStored = result[SETTINGS_KEY] as Partial<CaptureSettings>;
      }
    }
  } catch (e) {
    console.warn('Chrome sync storage not accessible, trying local storage', e);
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        domStored = JSON.parse(raw) as Partial<CaptureSettings>;
      }
    }
  } catch (e) {
    console.warn('localStorage not accessible', e);
  }

  if (!localStored && !syncStored && !domStored) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(syncStored || {}),
    ...(domStored || {}),
    ...(localStored || {}),
  };
}

/**
 * Save user settings synchronously to localStorage and asynchronously to chrome.storage.local + sync.
 */
export async function saveStoredSettings(settings: CaptureSettings): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch (e) {
    console.warn('localStorage save failed', e);
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
  } catch (e) {
    console.warn('Chrome local storage settings save failed', e);
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    }
  } catch (e) {
    console.warn('Chrome sync storage save failed', e);
  }
}

/**
 * Load capture history metadata. Index items store lightweight metadata;
 * full-resolution images are retrieved on demand via getFullResolutionImage.
 */
export async function getStoredHistory(): Promise<HistoryItem[]> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([HISTORY_KEY]);
      return Array.isArray(result?.[HISTORY_KEY]) ? (result[HISTORY_KEY] as HistoryItem[]) : [];
    }
  } catch (e) {
    console.warn('Chrome local storage history fetch failed', e);
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const history: HistoryItem[] = JSON.parse(raw);
        if (Array.isArray(history)) return history;
      }
    }
  } catch (e) {
    console.warn('localStorage history fetch failed', e);
  }

  return [];
}

/**
 * Save new item to history with lightweight indexing and separated full image storage.
 */
export async function addHistoryItem(item: HistoryItem): Promise<HistoryItem[]> {
  // Generate thumbnail before writing. The worker serializes all extension history writes.
  let thumb = item.thumbnailUrl;
  if (!thumb && item.dataUrl) {
    thumb = await createThumbnail(item.dataUrl);
  }

  const effectiveThumb = thumb || item.dataUrl || '';

  const extensionHistory = await mutateExtensionHistory('HISTORY_ADD', { item: { ...item, thumbnailUrl: effectiveThumb } });
  if (extensionHistory) {
    cacheFullImage(`${FULL_IMAGE_PREFIX}${item.id}`, item.dataUrl);
    return extensionHistory;
  }
  if (item.dataUrl) await saveFullResolutionImage(item.id, item.dataUrl);

  const indexItem: HistoryItem = { ...item, thumbnailUrl: effectiveThumb, dataUrl: '' };

  const current = await getStoredHistory();
  const merged = [indexItem, ...current.filter((i) => i.id !== item.id)];
  const updated = merged;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  }

  return updated;
}

/**
 * Update an existing history item in storage (e.g. OCR text, title, tags)
 */
export async function updateStoredHistoryItem(
  id: string,
  updates: Partial<HistoryItem>
): Promise<HistoryItem[]> {
  const extensionHistory = await mutateExtensionHistory('HISTORY_UPDATE', { id, updates });
  if (extensionHistory) return extensionHistory;
  const current = await getStoredHistory();
  const updated = current.map((item) => {
    if (item.id === id) {
      return { ...item, ...updates };
    }
    return item;
  });

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  }

  return updated;
}

/**
 * Delete single history item and its full-resolution cache.
 */
export async function deleteStoredHistoryItem(id: string): Promise<HistoryItem[]> {
  const key = `${FULL_IMAGE_PREFIX}${id}`;
  const extensionHistory = await mutateExtensionHistory('HISTORY_DELETE', { id });
  if (extensionHistory) {
    memoryFullImageCache.delete(key);
    return extensionHistory;
  }

  const current = await getStoredHistory();
  const updated = current.filter((i) => i.id !== id);

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [HISTORY_KEY]: updated });
    await chrome.storage.local.remove([key]);
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    localStorage.removeItem(key);
  }

  memoryFullImageCache.delete(key);

  return updated;
}

/**
 * Clear all history items and full-resolution image caches.
 */
export async function clearStoredHistory(): Promise<void> {
  const extensionHistory = await mutateExtensionHistory('HISTORY_CLEAR', {});
  if (extensionHistory) {
    memoryFullImageCache.clear();
    return;
  }
  const current = await getStoredHistory();
  const fullKeys = current.map((i) => `${FULL_IMAGE_PREFIX}${i.id}`);
  memoryFullImageCache.clear();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove([HISTORY_KEY, ...fullKeys]);
  } else if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(HISTORY_KEY);
    fullKeys.forEach((k) => localStorage.removeItem(k));
  }
}

/**
 * Copy a base64 / dataUrl image to the user's clipboard as PNG blob.
 */
export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    
    // Ensure it is image/png for ClipboardItem compatibility across browsers
    let pngBlob = blob;
    if (blob.type !== 'image/png') {
      pngBlob = await convertBlobToPng(blob);
    }

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob,
      }),
    ]);
    return true;
  } catch (err) {
    console.error('Failed to copy image to clipboard:', err);
    return false;
  }
}

/**
 * Convert non-PNG blob to PNG blob for clipboard
 */
function convertBlobToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Conversion to PNG failed'));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Trigger file download directly from dataUrl
 */
export async function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    const id = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(onChanged);
        if (error) reject(new Error(error)); else resolve();
      };
      const onChanged = (delta: chrome.downloads.DownloadDelta) => {
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
  } else {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
