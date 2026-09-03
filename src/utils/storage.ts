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
const MAX_HISTORY_ITEMS = 40;

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
 * Load capture history.
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
 * Save new item to history.
 */
export async function addHistoryItem(item: HistoryItem): Promise<HistoryItem[]> {
  const current = await getStoredHistory();
  const updated = [item, ...current.filter((i) => i.id !== item.id)].slice(0, MAX_HISTORY_ITEMS);

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
 * Delete single history item.
 */
export async function deleteStoredHistoryItem(id: string): Promise<HistoryItem[]> {
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
 * Clear all history items.
 */
export async function clearStoredHistory(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove([HISTORY_KEY]);
    }
  } catch (e) {
    console.warn('Chrome local storage history clear failed', e);
  }

  try {
    localStorage.removeItem(HISTORY_KEY);
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
