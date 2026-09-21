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

// ---------------------------------------------------------------------------
// IndexedDB — Image Storage
// Storing base64 dataUrls in chrome.storage.local serialises them through
// JSON on every read/write, which is expensive for large screenshots. Instead,
// image blobs live in IndexedDB and only lightweight metadata goes through
// chrome.storage.local.
// ---------------------------------------------------------------------------

const IDB_NAME = 'yoink_db';
const IDB_STORE = 'images';
const IDB_VERSION = 1;

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function saveImageToDb(id: string, dataUrl: string): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(dataUrl, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getImageFromDb(id: string): Promise<string | null> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteImageFromDb(id: string): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearImageDb(): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// History — Metadata (chrome.storage.local) + Images (IndexedDB)
// ---------------------------------------------------------------------------

/**
 * Load capture history. Metadata comes from chrome.storage.local; images are
 * hydrated from IndexedDB. Items without a stored image get dataUrl: ''.
 */
export async function getStoredHistory(): Promise<HistoryItem[]> {
  let metaList: Omit<HistoryItem, 'dataUrl'>[] = [];

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([HISTORY_KEY]);
      if (result && Array.isArray(result[HISTORY_KEY])) {
        metaList = result[HISTORY_KEY];
      }
    }
  } catch (e) {
    console.warn('Chrome local storage history fetch failed', e);
  }

  if (metaList.length === 0) {
    // Fallback: try localStorage (dev/browser mode)
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('localStorage history fetch failed', e);
    }
    return [];
  }

  // Hydrate dataUrls from IndexedDB
  const hydrated = await Promise.all(
    metaList.map(async (meta) => {
      const dataUrl = (await getImageFromDb(meta.id).catch(() => null)) ?? '';
      return { ...meta, dataUrl } as HistoryItem;
    })
  );

  return hydrated;
}

/**
 * Save a new item: image → IndexedDB, metadata → chrome.storage.local.
 */
export async function addHistoryItem(item: HistoryItem): Promise<HistoryItem[]> {
  // Persist the image separately so it stays out of chrome.storage.local
  if (item.dataUrl) {
    try {
      await saveImageToDb(item.id, item.dataUrl);
    } catch (e) {
      console.warn('IndexedDB image save failed', e);
    }
  }

  // Build a metadata-only record (no dataUrl)
  const { dataUrl: _stripped, ...meta } = item;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([HISTORY_KEY]);
      const list: Omit<HistoryItem, 'dataUrl'>[] = Array.isArray(result[HISTORY_KEY])
        ? result[HISTORY_KEY]
        : [];
      const updated = [meta, ...list.filter((i) => i.id !== meta.id)].slice(0, MAX_HISTORY_ITEMS);
      await chrome.storage.local.set({ [HISTORY_KEY]: updated });
      // Return hydrated list for the calling component
      return updated.map((m) => ({ ...m, dataUrl: m.id === meta.id ? (item.dataUrl ?? '') : '' }));
    }
  } catch (e) {
    console.warn('Chrome local storage history save failed', e);
  }

  // Dev fallback
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list: HistoryItem[] = raw ? JSON.parse(raw) : [];
    const updated = [item, ...list.filter((i) => i.id !== item.id)].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('localStorage history save failed', e);
  }

  return [item];
}

/**
 * Delete a single history item from both metadata store and image store.
 */
export async function deleteStoredHistoryItem(id: string): Promise<HistoryItem[]> {
  // Remove image from IndexedDB
  try {
    await deleteImageFromDb(id);
  } catch (e) {
    console.warn('IndexedDB image delete failed', e);
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([HISTORY_KEY]);
      const list: Omit<HistoryItem, 'dataUrl'>[] = Array.isArray(result[HISTORY_KEY])
        ? result[HISTORY_KEY]
        : [];
      const updated = list.filter((i) => i.id !== id);
      await chrome.storage.local.set({ [HISTORY_KEY]: updated });
      // Return without dataUrls — caller will reload full history if needed
      return updated.map((m) => ({ ...m, dataUrl: '' }));
    }
  } catch (e) {
    console.warn('Chrome local storage history delete failed', e);
  }

  // Dev fallback
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list: HistoryItem[] = raw ? JSON.parse(raw) : [];
    const updated = list.filter((i) => i.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('localStorage history delete failed', e);
  }

  return [];
}

/**
 * Clear all history — removes both metadata and all stored images.
 */
export async function clearStoredHistory(): Promise<void> {
  // Wipe all images from IndexedDB
  try {
    await clearImageDb();
  } catch (e) {
    console.warn('IndexedDB image clear failed', e);
  }

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

// ---------------------------------------------------------------------------
// Clipboard & Download Utilities
// ---------------------------------------------------------------------------

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
      new ClipboardItem({ 'image/png': pngBlob }),
    ]);
    return true;
  } catch (err) {
    console.error('Failed to copy image to clipboard:', err);
    return false;
  }
}

/**
 * Convert non-PNG blob to PNG blob for clipboard.
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
 * Trigger file download directly from dataUrl.
 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  } else {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
