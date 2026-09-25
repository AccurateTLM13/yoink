import { CaptureSettings, HistoryItem } from '../types';

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  quality: 0.92,
  scrollDelayMs: 600,
  hideStickyElements: true,
  autoDownload: true,
  copyToClipboard: false,
  filenameTemplate: '{title}_{date}_{time}',
};

const SETTINGS_KEY = 'omnicapture_settings';
const HISTORY_KEY = 'omnicapture_history';
const FULL_IMAGE_PREFIX = 'yoink_full_';
const MAX_HISTORY_ITEMS = 40;

/**
 * Generate a downscaled thumbnail from full dataUrl for fast index rendering
 */
export async function createThumbnail(dataUrl: string, maxDim: number = 320): Promise<string> {
  if (!dataUrl) return '';
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);

        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
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
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [key]: dataUrl });
      return;
    }
  } catch (e) {
    console.warn('Chrome storage full image save failed', e);
  }

  try {
    localStorage.setItem(key, dataUrl);
  } catch (e) {
    console.warn('localStorage full image save failed (quota limit)', e);
  }
}

/**
 * Retrieve full resolution image on-demand (for preview, download, or copy)
 */
export async function getFullResolutionImage(id: string): Promise<string | null> {
  const key = `${FULL_IMAGE_PREFIX}${id}`;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get([key]);
      if (res && typeof res[key] === 'string') return res[key] as string;
    }
  } catch (e) {
    console.warn('Chrome storage full image fetch failed', e);
  }

  try {
    const local = localStorage.getItem(key);
    if (local) return local;
  } catch {}

  // Fallback to checking the history item directly
  try {
    const history = await getStoredHistory();
    const item = history.find((i) => i.id === id);
    if (item && item.dataUrl) return item.dataUrl;
    if (item && item.thumbnailUrl) return item.thumbnailUrl;
  } catch {}

  return null;
}

/**
 * Load user settings with fallback to defaults.
 */
export async function getStoredSettings(): Promise<CaptureSettings> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const result = await chrome.storage.sync.get([SETTINGS_KEY]);
      if (result && result[SETTINGS_KEY]) {
        return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<CaptureSettings>) };
      }
    }
  } catch (e) {
    console.warn('Chrome sync storage not accessible, trying local storage', e);
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('localStorage not accessible', e);
  }

  return DEFAULT_SETTINGS;
}

/**
 * Save user settings.
 */
export async function saveStoredSettings(settings: CaptureSettings): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    }
  } catch (e) {
    console.warn('Chrome sync storage save failed', e);
  }

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('localStorage save failed', e);
  }
}

/**
 * Load capture history metadata.
 */
export async function getStoredHistory(): Promise<HistoryItem[]> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([HISTORY_KEY]);
      if (result && Array.isArray(result[HISTORY_KEY])) {
        return result[HISTORY_KEY];
      }
    }
  } catch (e) {
    console.warn('Chrome local storage history fetch failed', e);
  }

  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      return JSON.parse(raw);
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
  // 1. Save full resolution image separately to avoid inflating history index
  if (item.dataUrl) {
    await saveFullResolutionImage(item.id, item.dataUrl);
  }

  // 2. Generate thumbnail if needed
  let thumb = item.thumbnailUrl;
  if (!thumb && item.dataUrl) {
    thumb = await createThumbnail(item.dataUrl);
  }

  const indexItem: HistoryItem = {
    ...item,
    thumbnailUrl: thumb,
    // Keep dataUrl if small (< 50KB) or use thumbnail to prevent massive storage bloat
    dataUrl: item.dataUrl && item.dataUrl.length < 50000 ? item.dataUrl : (thumb || ''),
  };

  const current = await getStoredHistory();
  const updated = [indexItem, ...current.filter((i) => i.id !== item.id)].slice(0, MAX_HISTORY_ITEMS);

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [HISTORY_KEY]: updated });
    }
  } catch (e) {
    console.warn('Chrome local storage history save failed', e);
  }

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('localStorage history save failed', e);
  }

  return updated;
}

/**
 * Delete single history item and its full-resolution cache.
 */
export async function deleteStoredHistoryItem(id: string): Promise<HistoryItem[]> {
  const key = `${FULL_IMAGE_PREFIX}${id}`;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove([key]);
    }
  } catch {}
  try {
    localStorage.removeItem(key);
  } catch {}

  const current = await getStoredHistory();
  const updated = current.filter((i) => i.id !== id);

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [HISTORY_KEY]: updated });
    }
  } catch (e) {
    console.warn('Chrome local storage history delete failed', e);
  }

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('localStorage history delete failed', e);
  }

  return updated;
}

/**
 * Clear all history items and full-resolution image caches.
 */
export async function clearStoredHistory(): Promise<void> {
  const current = await getStoredHistory();
  const fullKeys = current.map((i) => `${FULL_IMAGE_PREFIX}${i.id}`);

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove([HISTORY_KEY, ...fullKeys]);
    }
  } catch (e) {
    console.warn('Chrome local storage history clear failed', e);
  }

  try {
    localStorage.removeItem(HISTORY_KEY);
    fullKeys.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn('localStorage history clear failed', e);
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
export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
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
