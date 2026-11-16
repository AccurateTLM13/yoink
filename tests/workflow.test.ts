import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { downloadDataUrl } from '../src/utils/storage';

const backgroundSource = readFileSync(new URL('../public/background.js', import.meta.url), 'utf8');
const offscreenSource = readFileSync(new URL('../public/offscreen.js', import.meta.url), 'utf8');

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: (fn: (...args: any[]) => void) => listeners.add(fn),
    removeListener: (fn: (...args: any[]) => void) => listeners.delete(fn),
    emit: (...args: any[]) => listeners.forEach((fn) => fn(...args)),
  };
}

function backgroundHarness(initial: Record<string, any> = {}) {
  const data = structuredClone(initial);
  let downloadState = 'complete';
  let storageFails = false;
  const changed = event();
  const chrome = {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, onInstalled: event(), onMessage: event(), sendMessage: async () => ({}) },
    commands: { onCommand: event() },
    alarms: { onAlarm: event(), create() {} },
    tabs: { onRemoved: event(), onUpdated: event(), setZoom: async () => {}, query: async () => [], get: async () => ({ status: 'complete' }) },
    permissions: { contains: async () => true },
    windows: {
      create: async ({ url }: { url: string }) => {
        if (url.includes('/bad')) throw new Error('Page could not be opened');
        return { id: 1, tabs: [{ id: 1 }] };
      },
      remove: async () => {},
    },
    downloads: {
      onChanged: changed,
      download: async () => 7,
      search: async () => [{ state: downloadState, error: downloadState === 'interrupted' ? 'DISK_FULL' : undefined }],
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const result: Record<string, any> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = structuredClone(data[key]);
          return result;
        },
        getKeys: async () => Object.keys(data),
        set: async (values: Record<string, any>) => {
          if (storageFails) throw new Error('Disk unavailable');
          Object.assign(data, structuredClone(values));
        },
        remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
      },
    },
  };
  const context = createContext({ chrome, crypto: webcrypto, console, setTimeout, clearTimeout, URL, structuredClone });
  runInContext(`${backgroundSource}\n;globalThis.__api = { saveHistoryItem, mutateHistory, migrateStorage, downloadSafe, finishCapture, recordCaptureFailure, handleCaptureUrlList };`, context);
  return {
    context, data, api: (context as any).__api,
    setDownloadState: (value: string) => { downloadState = value; },
    setStorageFails: (value: boolean) => { storageFails = value; },
  };
}

test('worker serializes concurrent history writes and keeps more than forty originals', async () => {
  const { api, data } = backgroundHarness();
  await Promise.all(Array.from({ length: 45 }, (_, index) => api.saveHistoryItem({
    id: `capture_${index}`, title: `Capture ${index}`, dataUrl: `data:image/png;base64,${index}`,
  })));
  assert.equal(data.omnicapture_history.length, 45);
  assert.equal(data.yoink_full_capture_0, 'data:image/png;base64,0');
  assert.equal(data.yoink_full_capture_44, 'data:image/png;base64,44');
});

test('upgrade migration retains every indexed capture and does not delete unindexed originals', async () => {
  const items = Array.from({ length: 45 }, (_, index) => ({ id: `old_${index}`, dataUrl: `original_${index}` }));
  const { api, data } = backgroundHarness({ omnicapture_history: items, yoink_full_orphan: 'recoverable' });
  await api.migrateStorage();
  assert.equal(data.omnicapture_history.length, 45);
  assert.equal(data.yoink_full_old_44, 'original_44');
  assert.equal(data.yoink_full_orphan, 'recoverable');
});

test('download confirmation rejects interrupted downloads', async () => {
  const { api, setDownloadState } = backgroundHarness();
  await assert.doesNotReject(api.downloadSafe('data:image/png;base64,AA==', 'ok.png'));
  setDownloadState('interrupted');
  await assert.rejects(api.downloadSafe('data:image/png;base64,AA==', 'failed.png'), /DISK_FULL/);
});

test('UI downloads wait for completion and surface interrupted transfers', async () => {
  const changed = event();
  const previousChrome = (globalThis as any).chrome;
  let state = 'in_progress';
  (globalThis as any).chrome = {
    downloads: {
      download: async () => 12,
      onChanged: changed,
      search: async () => [{ state, error: state === 'interrupted' ? 'NETWORK_FAILED' : undefined }],
    },
  };
  try {
    const pending = downloadDataUrl('data:image/png;base64,AA==', 'test.png');
    setTimeout(() => changed.emit({ id: 12, state: { current: 'complete' } }), 5);
    await assert.doesNotReject(pending);
    state = 'interrupted';
    await assert.rejects(downloadDataUrl('data:image/png;base64,AA==', 'test.png'), /NETWORK_FAILED/);
  } finally {
    (globalThis as any).chrome = previousChrome;
  }
});

test('capture reports download failures and does not claim an unsaved image is safe', async () => {
  const harness = backgroundHarness();
  harness.setDownloadState('interrupted');
  const capture = {
    dataUrl: 'data:image/png;base64,AA==', thumbnailUrl: 'thumb', width: 1, height: 1,
    mode: 'visible', title: 'Test', url: 'https://example.test',
    settings: { format: 'png', filenameTemplate: 'test', autoDownload: true, copyToClipboard: false },
  };
  const item = await harness.api.finishCapture(capture);
  assert.match(item.warning, /Download could not be confirmed/);
  assert.match(harness.data.omnicapture_history[0].warning, /Download could not be confirmed/);
  harness.setStorageFails(true);
  await assert.rejects(harness.api.finishCapture(capture), /could not be saved to the gallery/i);
  harness.setDownloadState('complete');
  const downloadOnly = await harness.api.finishCapture(capture);
  assert.equal(downloadOnly.historySaved, false);
  assert.match(downloadOnly.warning, /gallery could not save/i);
});

test('capture failures remain available after the popup closes', async () => {
  const { api, data } = backgroundHarness();
  await api.recordCaptureFailure('full', new Error('The active tab changed'));
  assert.equal(data.yoink_last_capture_error.mode, 'full');
  assert.equal(data.yoink_last_capture_error.error, 'The active tab changed');
});

test('batch capture reports individual failures alongside successful results', async () => {
  const { context, api } = backgroundHarness();
  runInContext(`
    sleep = async () => {};
    waitForTabComplete = async () => {};
    captureAndEncode = async () => ({ dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 });
    finishCapture = async (o) => ({ id: o.url, title: o.title, url: o.url, dataUrl: o.dataUrl });
    openGallery = async () => {};
  `, context);
  const result = await api.handleCaptureUrlList({
    urls: ['https://example.test/good', 'https://example.test/bad'], settings: {}, delayMs: 0,
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].target, /bad/);
  assert.match(result.failures[0].error, /could not be opened/);
});

test('oversized stitch is explicitly marked partial while a complete stitch is not', async () => {
  class Canvas {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage() {} }; }
  }
  const chrome = { runtime: { getURL: () => 'chrome-extension://test/', onMessage: event() } };
  const context = createContext({ chrome, OffscreenCanvas: Canvas, console, URL, setTimeout, clearTimeout });
  runInContext(`${offscreenSource}\n;globalThis.__api = { initJobCanvas, stitchEnd, jobs }; encodeCanvas = async () => ({ dataUrl: 'image' }); releaseCanvas = () => {};`, context);
  const api = (context as any).__api;
  for (const [id, totalHeight, bottom] of [['partial', 20000, 16000], ['complete', 1200, 1200]] as const) {
    const job: any = { kind: 'full', totalWidth: 1200, totalHeight, dpr: 1, settings: {}, proofContext: null, bottom };
    api.initJobCanvas(job, { width: 1200, height: 800 });
    api.jobs.set(id, job);
    const result = await api.stitchEnd({ jobId: id });
    if (id === 'partial') assert.match(result.warning, /Partial capture/);
    else assert.equal(result.warning, undefined);
  }
});
