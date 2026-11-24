import { FolderAccessState } from '../types';

export const FS_DB_NAME = 'yoink_fs_db';
export const FS_STORE_NAME = 'handles';
export const FS_HANDLE_KEY = 'save_directory';
export const FOLDER_STATUS_KEY = 'yoink_folder_status';

export interface DirectoryHandleLike {
  kind?: string;
  name: string;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
  values?: () => AsyncIterator<unknown> | { next: () => Promise<IteratorResult<unknown>> };
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | Uint8Array | string) => Promise<void>;
      close: () => Promise<void>;
      abort?: () => Promise<void>;
    }>;
  }>;
}

export interface DirectoryHandleStore {
  get: () => Promise<DirectoryHandleLike | null>;
  set: (handle: DirectoryHandleLike) => Promise<void>;
  clear: () => Promise<void>;
}

export interface FolderStatusRecord {
  state: FolderAccessState;
  name: string;
  error?: string;
  updatedAt?: number;
}

let testHandleStoreOverride: DirectoryHandleStore | null = null;

export function setDirectoryHandleStoreForTesting(store: DirectoryHandleStore | null): void {
  testHandleStoreOverride = store;
}

export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const req = indexedDB.open(FS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
        db.createObjectStore(FS_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open folder storage database.'));
  });
}

async function idbGetHandle(): Promise<DirectoryHandleLike | null> {
  if (testHandleStoreOverride) return testHandleStoreOverride.get();
  if (typeof indexedDB === 'undefined') return null;
  const db = await openHandleDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FS_STORE_NAME, 'readonly');
      const req = tx.objectStore(FS_STORE_NAME).get(FS_HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike) || null);
      req.onerror = () => reject(req.error || new Error('Could not read saved folder handle.'));
    });
  } finally {
    db.close();
  }
}

async function idbSetHandle(handle: DirectoryHandleLike): Promise<void> {
  if (testHandleStoreOverride) {
    await testHandleStoreOverride.set(handle);
    return;
  }
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FS_STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save folder handle.'));
      tx.objectStore(FS_STORE_NAME).put(handle, FS_HANDLE_KEY);
    });
  } finally {
    db.close();
  }
}

async function idbClearHandle(): Promise<void> {
  if (testHandleStoreOverride) {
    await testHandleStoreOverride.clear();
    return;
  }
  if (typeof indexedDB === 'undefined') return;
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FS_STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not clear saved folder handle.'));
      tx.objectStore(FS_STORE_NAME).delete(FS_HANDLE_KEY);
    });
  } finally {
    db.close();
  }
}

export async function getSavedDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  try {
    return await idbGetHandle();
  } catch (err) {
    console.warn('Failed to retrieve saved directory handle:', err);
    return null;
  }
}

export async function clearSavedDirectoryHandle(): Promise<void> {
  await idbClearHandle();
  await syncFolderStatusToStorage('unset', '');
}

export async function syncFolderStatusToStorage(
  state: FolderAccessState,
  folderName: string,
  error?: string
): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [FOLDER_STATUS_KEY]: {
          state,
          folderName,
          error,
          updatedAt: Date.now(),
        },
      });
    }
  } catch {
    // non-fatal
  }
}

/**
 * Normalizes a proposed output filename into a single safe basename with no traversal or reserved characters.
 */
export function sanitizeOutputFilename(filename: string): string {
  const parts = String(filename || '').split(/[\\/]+/);
  const base = (parts[parts.length - 1] || '').trim();

  let cleaned = '';
  for (const ch of base) {
    const code = ch.charCodeAt(0);
    if (code < 32 || '<>:"/\\|?*'.includes(ch)) {
      cleaned += '_';
    } else {
      cleaned += ch;
    }
  }

  cleaned = cleaned.replace(/^\.+/, '').trim();
  if (!cleaned) return 'capture.png';
  return cleaned.slice(0, 180);
}

function splitStemAndExt(filename: string): { stem: string; ext: string } {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return { stem: filename, ext: '' };
  return {
    stem: filename.slice(0, idx),
    ext: filename.slice(idx),
  };
}

/**
 * Ensures we never overwrite an existing file in the chosen folder or external drive.
 */
export async function uniquifyFilenameInDirectory(
  dirHandle: DirectoryHandleLike,
  rawFilename: string
): Promise<string> {
  const base = sanitizeOutputFilename(rawFilename);
  const { stem, ext } = splitStemAndExt(base);

  const fileExists = async (candidate: string): Promise<boolean> => {
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
      return true;
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
      if (name === 'NotFoundError') return false;
      throw err;
    }
  };

  if (!(await fileExists(base))) return base;

  for (let i = 1; i <= 999; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await fileExists(candidate))) return candidate;
  }

  return `${stem}_${Date.now()}${ext}`;
}

async function queryDirectoryPermission(
  handle: DirectoryHandleLike,
  requestIfNeeded: boolean
): Promise<'granted' | 'prompt' | 'denied'> {
  const opts = { mode: 'readwrite' as const };
  let state: 'granted' | 'prompt' | 'denied' = handle.queryPermission
    ? await handle.queryPermission(opts)
    : 'granted';

  if (state !== 'granted' && requestIfNeeded && handle.requestPermission) {
    state = await handle.requestPermission(opts);
  }
  return state;
}

async function probeDirectoryAccessible(handle: DirectoryHandleLike): Promise<boolean> {
  if (typeof handle.values !== 'function') return true;
  try {
    const iter = handle.values();
    await iter.next();
    return true;
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    if (name === 'NotFoundError') return false;
    throw err;
  }
}

/**
 * Non-interactive status check for the persisted local folder or external drive.
 */
export async function checkSavedDirectoryStatus(): Promise<{ state: FolderAccessState; name: string }> {
  if (!isDirectoryPickerSupported() && !testHandleStoreOverride) {
    return { state: 'unsupported', name: '' };
  }

  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    return { state: 'unset', name: '' };
  }

  try {
    const perm = await queryDirectoryPermission(handle, false);
    if (perm !== 'granted') {
      return { state: 'needs_permission', name: handle.name };
    }
    const accessible = await probeDirectoryAccessible(handle);
    if (!accessible) {
      return { state: 'not_found', name: handle.name };
    }
    return { state: 'ready', name: handle.name };
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    if (name === 'NotFoundError') {
      return { state: 'not_found', name: handle.name };
    }
    return { state: 'needs_permission', name: handle.name };
  }
}

/**
 * Opens the native OS folder / external drive picker (must be called inside a user gesture in a full tab).
 */
export async function pickSaveDirectory(): Promise<{ handle: DirectoryHandleLike; name: string }> {
  const picker =
    typeof window !== 'undefined'
      ? (window as unknown as {
          showDirectoryPicker?: (opts: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandleLike>;
        }).showDirectoryPicker
      : undefined;

  if (typeof picker !== 'function') {
    throw new Error('Folder picker is not supported in this browser context.');
  }

  const handle = await picker({
    id: 'yoink-save-folder',
    mode: 'readwrite',
  });

  const perm = await queryDirectoryPermission(handle, true);
  if (perm !== 'granted') {
    throw new Error('Write permission was not granted for the selected folder.');
  }

  await idbSetHandle(handle);
  await syncFolderStatusToStorage('ready', handle.name);
  return { handle, name: handle.name };
}

/**
 * Re-requests write permission for an already chosen local folder or external drive (requires user gesture).
 */
export async function reauthorizeSavedDirectory(): Promise<{
  ok: boolean;
  name?: string;
  state: FolderAccessState;
}> {
  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    await syncFolderStatusToStorage('unset', '');
    return { ok: false, state: 'unset' };
  }

  try {
    const perm = await queryDirectoryPermission(handle, true);
    if (perm !== 'granted') {
      await syncFolderStatusToStorage('needs_permission', handle.name, 'Write access was not granted.');
      return { ok: false, name: handle.name, state: 'needs_permission' };
    }

    const accessible = await probeDirectoryAccessible(handle);
    if (!accessible) {
      await syncFolderStatusToStorage(
        'not_found',
        handle.name,
        `Folder or drive "${handle.name}" could not be found.`
      );
      return { ok: false, name: handle.name, state: 'not_found' };
    }

    await syncFolderStatusToStorage('ready', handle.name);
    return { ok: true, name: handle.name, state: 'ready' };
  } catch (err: unknown) {
    const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    const state: FolderAccessState = errName === 'NotFoundError' ? 'not_found' : 'needs_permission';
    await syncFolderStatusToStorage(state, handle.name);
    return { ok: false, name: handle.name, state };
  }
}

/**
 * Decodes a data: URL directly in memory into a Blob without invoking fetch().
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Expected a data: URL.');
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Malformed data: URL.');
  }
  const header = dataUrl.slice(5, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  const parts = header.split(';');
  const mime = parts[0] || 'application/octet-stream';
  const isBase64 = parts.some((p) => p.toLowerCase() === 'base64');

  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  return new Blob([decodeURIComponent(payload)], { type: mime });
}

/**
 * Validates that an external media URL uses http(s), contains no credentials,
 * and does not target loopback, link-local, or cloud metadata endpoints (SSRF protection).
 */
export function validateExternalMediaUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid media URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported media URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Media URL must not contain credentials.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '::1' ||
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host.startsWith('169.254.')
  ) {
    throw new Error(`Blocked internal or metadata host: ${host}`);
  }

  return parsed.toString();
}

async function urlToBlob(url: string): Promise<Blob> {
  if (url.startsWith('data:')) {
    return dataUrlToBlob(url);
  }

  const safeHref = validateExternalMediaUrl(url);
  const doFetch = async () => {
    const requestFn = globalThis.fetch;
    if (typeof requestFn !== 'function') {
      throw new Error('Fetch API unavailable.');
    }
    const res = await requestFn(safeHref);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} while fetching media.`);
    }
    return res.blob();
  };

  try {
    return await doFetch();
  } catch (firstError) {
    if (
      /^https?:/i.test(safeHref) &&
      typeof chrome !== 'undefined' &&
      chrome.permissions?.contains &&
      chrome.permissions?.request
    ) {
      const hasAll = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
      if (!hasAll) {
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
        if (granted) {
          return await doFetch();
        }
      }
    }
    throw firstError;
  }
}

/**
 * Writes a Blob directly to the given FileSystemDirectoryHandle with conflict-safe uniquified naming.
 */
export async function writeBlobToDirectory(
  dirHandle: DirectoryHandleLike,
  filename: string,
  blob: Blob
): Promise<string> {
  const uniqueName = await uniquifyFilenameInDirectory(dirHandle, filename);
  const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(blob);
    await writable.close();
    return uniqueName;
  } catch (err) {
    if (typeof writable.abort === 'function') {
      await writable.abort().catch(() => {});
    }
    throw err;
  }
}

/**
 * Saves a data:, blob:, or http(s): URL directly into the user's chosen local folder or external drive.
 */
export async function saveToCustomFolder(
  url: string,
  filename: string,
  options?: { requestPermission?: boolean }
): Promise<{ filename: string; folderName: string }> {
  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    await syncFolderStatusToStorage('unset', '', 'No custom save folder selected.');
    throw new Error('No custom save folder selected. Choose a folder or external drive in Engine Settings.');
  }

  const perm = await queryDirectoryPermission(handle, options?.requestPermission ?? true);
  if (perm !== 'granted') {
    await syncFolderStatusToStorage(
      'needs_permission',
      handle.name,
      `Write permission needed for "${handle.name}".`
    );
    throw new Error(
      `Permission needed to write to "${handle.name}". Click "Grant Folder Access" or choose a folder in Engine Settings.`
    );
  }

  try {
    const blob = await urlToBlob(url);
    const writtenName = await writeBlobToDirectory(handle, filename, blob);
    await syncFolderStatusToStorage('ready', handle.name);
    return { filename: writtenName, folderName: handle.name };
  } catch (err: unknown) {
    const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    if (errName === 'NotFoundError') {
      await syncFolderStatusToStorage(
        'not_found',
        handle.name,
        `Folder or drive "${handle.name}" is disconnected or missing.`
      );
      throw new Error(
        `Folder or external drive "${handle.name}" could not be found. Reconnect the drive or choose another folder.`
      );
    }
    throw err;
  }
}
