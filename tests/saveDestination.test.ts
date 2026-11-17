import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

import {
  sanitizeOutputFilename,
  uniquifyFilenameInDirectory,
  writeBlobToDirectory,
  pickSaveDirectory,
  checkSavedDirectoryStatus,
  reauthorizeSavedDirectory,
  saveToCustomFolder,
  setDirectoryHandleStoreForTesting,
} from '../src/utils/saveDestination';
import { downloadDataUrl, DEFAULT_SETTINGS } from '../src/utils/storage';

const BG_CODE = fs.readFileSync('./public/background.js', 'utf8');
const OFFSCREEN_CODE = fs.readFileSync('./public/offscreen.js', 'utf8');

function createMockDirectoryHandle(options: {
  name?: string;
  existingFiles?: Record<string, Uint8Array>;
  permissionState?: 'granted' | 'prompt' | 'denied';
  requestResult?: 'granted' | 'denied';
  disconnected?: boolean;
  failWrite?: boolean;
}) {
  const files = new Map<string, Uint8Array>(Object.entries(options.existingFiles || {}));
  let perm = options.permissionState ?? 'granted';

  const handle: any = {
    kind: 'directory',
    name: options.name ?? 'ExternalDrive_Yoink',
    queryPermission: async () => perm,
    requestPermission: async () => {
      perm = options.requestResult ?? 'granted';
      return perm;
    },
    values: () => ({
      next: async () => {
        if (options.disconnected) {
          const err = new Error('Directory not found');
          err.name = 'NotFoundError';
          throw err;
        }
        const first = files.keys().next();
        return first.done ? { done: true, value: undefined } : { done: false, value: first.value };
      },
    }),
    getFileHandle: async (filename: string, opts?: { create?: boolean }) => {
      if (options.disconnected) {
        const err = new Error('Directory not found');
        err.name = 'NotFoundError';
        throw err;
      }
      if (!opts?.create) {
        if (!files.has(filename)) {
          const err = new Error(`File not found: ${filename}`);
          err.name = 'NotFoundError';
          throw err;
        }
        return { kind: 'file', name: filename };
      }
      return {
        kind: 'file',
        name: filename,
        createWritable: async () => {
          let aborted = false;
          let closed = false;
          let written: Uint8Array = new Uint8Array();
          return {
            write: async (data: Blob | Uint8Array) => {
              if (options.failWrite) throw new Error('Disk full on external drive');
              written = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
            },
            close: async () => {
              if (!aborted) {
                closed = true;
                files.set(filename, written);
              }
            },
            abort: async () => {
              aborted = true;
            },
            get isClosed() {
              return closed;
            },
            get isAborted() {
              return aborted;
            },
          };
        },
      };
    },
    __files: files,
  };

  return handle;
}

function createMemoryHandleStore(initial: any = null) {
  let stored = initial;
  return {
    get: async () => stored,
    set: async (h: any) => {
      stored = h;
    },
    clear: async () => {
      stored = null;
    },
  };
}

function createEvent() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: (fn: (...args: any[]) => void) => listeners.add(fn),
    removeListener: (fn: (...args: any[]) => void) => listeners.delete(fn),
    emit: (...args: any[]) => listeners.forEach((fn) => fn(...args)),
  };
}

describe('Custom Save Destination (Local Folders & External Drives)', () => {
  it('sanitizeOutputFilename strips traversal, reserved characters, and keeps clean extension', () => {
    assert.equal(sanitizeOutputFilename('../../../etc/passwd.png'), 'passwd.png');
    assert.equal(sanitizeOutputFilename('E:\\External\\my:bad*shot?.png'), 'my_bad_shot_.png');
    assert.equal(sanitizeOutputFilename('..'), 'capture.png');
    assert.equal(sanitizeOutputFilename('   '), 'capture.png');
    assert.equal(sanitizeOutputFilename('hero-image_2x.webp'), 'hero-image_2x.webp');
  });

  it('uniquifyFilenameInDirectory avoids overwriting existing files in target folder or drive', async () => {
    const dir = createMockDirectoryHandle({
      existingFiles: {
        'screenshot.png': new Uint8Array([1]),
        'screenshot (1).png': new Uint8Array([2]),
      },
    });

    const unique1 = await uniquifyFilenameInDirectory(dir, 'screenshot.png');
    assert.equal(unique1, 'screenshot (2).png');

    const unique2 = await uniquifyFilenameInDirectory(dir, 'fresh.png');
    assert.equal(unique2, 'fresh.png');

    const noExtDir = createMockDirectoryHandle({
      existingFiles: { asset: new Uint8Array([1]) },
    });
    const uniqueNoExt = await uniquifyFilenameInDirectory(noExtDir, 'asset');
    assert.equal(uniqueNoExt, 'asset (1)');
  });

  it('writeBlobToDirectory writes blob bytes to unique file and aborts writable on error', async () => {
    const dir = createMockDirectoryHandle({
      existingFiles: { 'photo.png': new Uint8Array([9]) },
    });
    const payload = new Blob([new Uint8Array([10, 20, 30])], { type: 'image/png' });
    const writtenName = await writeBlobToDirectory(dir, 'photo.png', payload);

    assert.equal(writtenName, 'photo (1).png');
    assert.deepEqual(Array.from(dir.__files.get('photo (1).png')!), [10, 20, 30]);

    const failingDir = createMockDirectoryHandle({ failWrite: true });
    await assert.rejects(
      () => writeBlobToDirectory(failingDir, 'photo.png', payload),
      /Disk full on external drive/
    );
  });

  it('pickSaveDirectory prompts picker, verifies readwrite permission, and stores handle', async () => {
    const store = createMemoryHandleStore();
    setDirectoryHandleStoreForTesting(store);
    const mockDir = createMockDirectoryHandle({ name: 'USB_DRIVE_SHOTS', permissionState: 'granted' });
    const origWindow = (globalThis as any).window;
    (globalThis as any).window = {
      showDirectoryPicker: async (opts: any) => {
        assert.equal(opts.mode, 'readwrite');
        return mockDir;
      },
    };

    try {
      const picked = await pickSaveDirectory();
      assert.equal(picked.name, 'USB_DRIVE_SHOTS');
      assert.equal(await store.get(), mockDir);
    } finally {
      (globalThis as any).window = origWindow;
      setDirectoryHandleStoreForTesting(null);
    }
  });

  it('checkSavedDirectoryStatus and reauthorizeSavedDirectory report ready, needs_permission, not_found, and unset', async () => {
    const store = createMemoryHandleStore();
    setDirectoryHandleStoreForTesting(store);

    try {
      assert.deepEqual(await checkSavedDirectoryStatus(), { state: 'unset', name: '' });

      const promptDir = createMockDirectoryHandle({
        name: 'T7_SSD',
        permissionState: 'prompt',
        requestResult: 'granted',
      });
      await store.set(promptDir);

      const before = await checkSavedDirectoryStatus();
      assert.equal(before.state, 'needs_permission');
      assert.equal(before.name, 'T7_SSD');

      const after = await reauthorizeSavedDirectory();
      assert.equal(after.ok, true);
      assert.equal(after.state, 'ready');
      assert.equal(after.name, 'T7_SSD');

      const disconnectedDir = createMockDirectoryHandle({
        name: 'Unplugged_USB',
        permissionState: 'granted',
        disconnected: true,
      });
      await store.set(disconnectedDir);
      const unplugged = await checkSavedDirectoryStatus();
      assert.equal(unplugged.state, 'not_found');
      assert.equal(unplugged.name, 'Unplugged_USB');
    } finally {
      setDirectoryHandleStoreForTesting(null);
    }
  });

  it('downloadDataUrl routes to custom folder, Ask Every Time (saveAs), or default Downloads based on settings', async () => {
    const store = createMemoryHandleStore();
    setDirectoryHandleStoreForTesting(store);
    const dir = createMockDirectoryHandle({ name: 'External_SSD', permissionState: 'granted' });
    await store.set(dir);

    const downloadCalls: any[] = [];
    const origChrome = (globalThis as any).chrome;
    const origFetch = (globalThis as any).fetch;
    const changed = createEvent();

    (globalThis as any).chrome = {
      downloads: {
        download: async (opts: any) => {
          downloadCalls.push(opts);
          return downloadCalls.length;
        },
        onChanged: changed,
        search: async () => [{ state: 'complete' }],
      },
    };
    (globalThis as any).fetch = async (url: string) => ({
      ok: true,
      blob: async () => new Blob([new TextEncoder().encode(`bytes:${url}`)], { type: 'image/png' }),
    });

    try {
      // 1. Custom folder / external drive: writes to handle, does NOT call chrome.downloads
      await saveToCustomFolder('https://cdn.example.com/hero.png', 'hero.png');
      assert.equal(dir.__files.has('hero.png'), true);
      assert.equal(downloadCalls.length, 0);

      await downloadDataUrl('data:image/png;base64,AA==', 'shot.png', {
        settings: { ...DEFAULT_SETTINGS, saveLocationMode: 'folder', customSaveFolderName: 'External_SSD' },
      });
      assert.equal(dir.__files.has('shot.png'), true);
      assert.equal(downloadCalls.length, 0);

      // 2. Ask every time: chrome.downloads.download with saveAs: true
      await downloadDataUrl('data:image/png;base64,AA==', 'ask_shot.png', {
        settings: { ...DEFAULT_SETTINGS, saveLocationMode: 'ask' },
      });
      assert.equal(downloadCalls.length, 1);
      assert.equal(downloadCalls[0].saveAs, true);

      // 3. Default Downloads: chrome.downloads.download with saveAs: false
      await downloadDataUrl('data:image/png;base64,AA==', 'default_shot.png', {
        settings: { ...DEFAULT_SETTINGS, saveLocationMode: 'downloads' },
      });
      assert.equal(downloadCalls.length, 2);
      assert.equal(downloadCalls[1].saveAs, false);
    } finally {
      (globalThis as any).chrome = origChrome;
      (globalThis as any).fetch = origFetch;
      setDirectoryHandleStoreForTesting(null);
    }
  });

  it('background.js routes custom folder downloads via offscreen SAVE_TO_FOLDER and warns clearly when permission or drive is missing', async () => {
    const data: Record<string, any> = {};
    const downloadCalls: any[] = [];
    let offscreenResponse: any = { ok: true, filename: 'capture.png', folderName: 'External_Drive' };

    const chromeMock = {
      runtime: {
        id: 'test-ext',
        getURL: (p: string) => `chrome-extension://test-ext/${p}`,
        onInstalled: createEvent(),
        onMessage: createEvent(),
        sendMessage: async (msg: any) => {
          if (msg?.target === 'offscreen' && msg.type === 'SAVE_TO_FOLDER') {
            return offscreenResponse;
          }
          return { ok: true };
        },
        getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      },
      commands: { onCommand: createEvent() },
      alarms: { onAlarm: createEvent(), create() {} },
      tabs: { onRemoved: createEvent(), query: async () => [] },
      downloads: {
        onChanged: createEvent(),
        download: async (opts: any) => {
          downloadCalls.push(opts);
          return 1;
        },
        search: async () => [{ state: 'complete' }],
      },
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const out: Record<string, any> = {};
            for (const k of Array.isArray(keys) ? keys : [keys]) out[k] = data[k];
            return out;
          },
          set: async (values: Record<string, any>) => Object.assign(data, values),
          remove: async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
          },
        },
        sync: { get: async () => ({}) },
      },
    };

    const ctx = vm.createContext({
      chrome: chromeMock,
      crypto: webcrypto,
      console,
      URL,
      Promise,
      Map,
      Set,
      Date,
      Math,
      Object,
      Array,
      Number,
      String,
      setTimeout,
      clearTimeout,
      structuredClone,
    });
    vm.runInContext(
      `${BG_CODE}\n;globalThis.__api = { sanitizeSettings, downloadSafe, finishCapture };`,
      ctx
    );
    const api = (ctx as any).__api;

    const sanitized = api.sanitizeSettings({
      saveLocationMode: 'folder',
      customSaveFolderName: 'E:\\Captures',
    });
    assert.equal(sanitized.saveLocationMode, 'folder');
    assert.equal(sanitized.customSaveFolderName, 'E:\\Captures');

    const invalid = api.sanitizeSettings({ saveLocationMode: 'invalid_mode' });
    assert.equal(invalid.saveLocationMode, 'downloads');

    // Ask mode uses saveAs: true
    await api.downloadSafe('data:image/png;base64,AA==', 'ask.png', { saveLocationMode: 'ask' });
    assert.equal(downloadCalls[0].saveAs, true);

    // Folder mode succeeds via offscreen SAVE_TO_FOLDER without chrome.downloads.download
    const okItem = await api.finishCapture({
      dataUrl: 'data:image/png;base64,AA==',
      thumbnailUrl: 'thumb',
      width: 100,
      height: 100,
      mode: 'visible',
      title: 'Test',
      url: 'https://example.test',
      settings: {
        format: 'png',
        filenameTemplate: 'test',
        autoDownload: true,
        copyToClipboard: false,
        saveLocationMode: 'folder',
        customSaveFolderName: 'External_Drive',
      },
    });
    assert.equal(okItem.warning, undefined);
    assert.equal(downloadCalls.length, 1);
    assert.equal(data.yoink_folder_status?.state, 'ready');

    // Folder mode with missing permission warns clearly and records status
    offscreenResponse = {
      ok: false,
      reason: 'needs_permission',
      folderName: 'External_Drive',
      message: 'Permission needed to save to "External_Drive".',
    };
    const warnItem = await api.finishCapture({
      dataUrl: 'data:image/png;base64,AA==',
      thumbnailUrl: 'thumb',
      width: 100,
      height: 100,
      mode: 'visible',
      title: 'Test2',
      url: 'https://example.test',
      settings: {
        format: 'png',
        filenameTemplate: 'test2',
        autoDownload: true,
        copyToClipboard: false,
        saveLocationMode: 'folder',
        customSaveFolderName: 'External_Drive',
      },
    });
    assert.match(warnItem.warning, /External_Drive/);
    assert.equal(data.yoink_folder_status?.state, 'needs_permission');
  });

  it('offscreen.js SAVE_TO_FOLDER writes to stored FileSystemDirectoryHandle and handles missing permission or drive disconnect', async () => {
    const dir = createMockDirectoryHandle({
      name: 'MyUSB',
      existingFiles: { 'shot.png': new Uint8Array([1]) },
      permissionState: 'granted',
    });

    const chromeMock = {
      runtime: {
        id: 'ext-1',
        getURL: (p: string) => `chrome-extension://ext-1/${p}`,
        onMessage: createEvent(),
      },
    };

    const ctx = vm.createContext({
      chrome: chromeMock,
      crypto: webcrypto,
      console,
      URL,
      Blob,
      Uint8Array,
      TextEncoder,
      OffscreenCanvas: class {},
      fetch: async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }),
      }),
      setTimeout,
      clearTimeout,
    });
    vm.runInContext(
      `${OFFSCREEN_CODE}\n;globalThis.__api = { saveToFolderTask, setSavedDirHandleForTest: (h) => { __testDirHandleOverride = h; } };`,
      ctx
    );
    const api = (ctx as any).__api;

    api.setSavedDirHandleForTest(dir);
    const resOk = await api.saveToFolderTask({ url: 'data:image/png;base64,AA==', filename: 'shot.png' });
    assert.equal(resOk.ok, true);
    assert.equal(resOk.filename, 'shot (1).png');
    assert.deepEqual(Array.from(dir.__files.get('shot (1).png')!), [7, 8, 9]);

    const promptDir = createMockDirectoryHandle({ name: 'LockedDrive', permissionState: 'prompt' });
    api.setSavedDirHandleForTest(promptDir);
    const resPerm = await api.saveToFolderTask({ url: 'data:image/png;base64,AA==', filename: 'shot.png' });
    assert.equal(resPerm.ok, false);
    assert.equal(resPerm.reason, 'needs_permission');

    const unpluggedDir = createMockDirectoryHandle({
      name: 'UnpluggedDrive',
      permissionState: 'granted',
      disconnected: true,
    });
    api.setSavedDirHandleForTest(unpluggedDir);
    const resUnplugged = await api.saveToFolderTask({ url: 'data:image/png;base64,AA==', filename: 'shot.png' });
    assert.equal(resUnplugged.ok, false);
    assert.equal(resUnplugged.reason, 'not_found');
  });
});
