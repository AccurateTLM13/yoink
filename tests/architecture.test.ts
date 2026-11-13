import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  isCapturableWebUrl,
  getInjectableOpenTabs,
  captureVisible,
  captureFullPage,
  captureMultiSize,
} from '../src/utils/capture';
import { DEFAULT_SETTINGS } from '../src/utils/storage';

const BG_CODE = fs.readFileSync('./public/background.js', 'utf8');

describe('Phase 2: Architecture, Shared Logic & Target-Tab Capture APIs', () => {
  it('isCapturableWebUrl filters out internal browser, extension, and Chrome Web Store URLs', () => {
    assert.equal(isCapturableWebUrl('https://example.com/dashboard'), true);
    assert.equal(isCapturableWebUrl('http://localhost:3000'), true);
    assert.equal(isCapturableWebUrl('chrome://extensions'), false);
    assert.equal(isCapturableWebUrl('chrome-extension://abcdef/index.html?tab=true'), false);
    assert.equal(isCapturableWebUrl('https://chromewebstore.google.com/detail/xyz'), false);
    assert.equal(isCapturableWebUrl('about:blank'), false);
    assert.equal(isCapturableWebUrl(''), false);
  });

  it('getInjectableOpenTabs returns only capturable web tabs and excludes the Studio Hub extension tab', async () => {
    const origChrome = (globalThis as any).chrome;
    try {
      (globalThis as any).chrome = {
        runtime: { sendMessage: () => {} },
        tabs: {
          query: (_q: any, cb: any) => {
            cb([
              { id: 1, windowId: 10, title: 'Yoink Studio Hub', url: 'chrome-extension://ext/index.html?tab=true', active: true },
              { id: 2, windowId: 10, title: 'GitHub', url: 'https://github.com/explore', favIconUrl: 'https://github.com/favicon.ico', active: false },
              { id: 3, windowId: 10, title: 'Extensions', url: 'chrome://extensions', active: false },
            ]);
          },
        },
      };

      const tabs = await getInjectableOpenTabs();
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].id, 2);
      assert.equal(tabs[0].title, 'GitHub');
      assert.equal(tabs[0].url, 'https://github.com/explore');
    } finally {
      (globalThis as any).chrome = origChrome;
    }
  });

  it('captureMultiSize accepts an explicit targetUrl when launched from Studio Hub (where activeTab is chrome-extension://)', async () => {
    const origChrome = (globalThis as any).chrome;
    let sentMessage: any = null;
    try {
      (globalThis as any).chrome = {
        permissions: { request: async () => true },
        runtime: {
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: (msg: any, cb: any) => {
            sentMessage = msg;
            cb({ results: [] });
          },
        },
        tabs: {
          query: (_q: any, cb: any) => {
            cb([{ id: 1, url: 'chrome-extension://ext/index.html?tab=true' }]);
          },
        },
      };

      await captureMultiSize(
        [{ name: 'Mobile', width: 390, height: 844 }],
        DEFAULT_SETTINGS,
        undefined,
        'https://news.ycombinator.com'
      );

      assert.ok(sentMessage, 'Should send CAPTURE_MULTI_SIZE message');
      assert.equal(sentMessage.action, 'CAPTURE_MULTI_SIZE');
      assert.equal(sentMessage.payload.url, 'https://news.ycombinator.com');
    } finally {
      (globalThis as any).chrome = origChrome;
    }
  });

  it('captureVisible and captureFullPage forward explicit targetTabId and returnToTabId when triggered from Studio Hub', async () => {
    const origChrome = (globalThis as any).chrome;
    const sentMessages: any[] = [];
    try {
      (globalThis as any).chrome = {
        runtime: {
          onMessage: {
            addListener: (fn: any) => {
              setTimeout(() => {
                fn({
                  action: 'CAPTURE_FINISHED',
                  payload: {
                    item: {
                      id: 'full_1',
                      title: 'Target Tab',
                      url: 'https://example.com',
                      dataUrl: 'data:image/png;base64,AA==',
                      timestamp: 1000,
                      width: 1200,
                      height: 2400,
                      mode: 'full',
                      format: 'png',
                    },
                  },
                });
              }, 5);
            },
            removeListener: () => {},
          },
          sendMessage: (msg: any, cb?: any) => {
            sentMessages.push(msg);
            if (msg.action === 'CAPTURE_VISIBLE_PART' && cb) {
              cb({
                item: {
                  id: 'vis_1',
                  title: 'Target Tab',
                  url: 'https://example.com',
                  dataUrl: 'data:image/png;base64,AA==',
                  timestamp: 1000,
                  width: 1200,
                  height: 800,
                  mode: 'visible',
                  format: 'png',
                },
              });
            } else if (cb) {
              cb({ success: true });
            }
          },
        },
        tabs: {
          query: (_q: any, cb: any) => {
            cb([{ id: 99, windowId: 1, title: 'Yoink Studio Hub', url: 'chrome-extension://ext/index.html?tab=true' }]);
          },
          get: (id: number, cb?: any) => {
            const tab = { id, windowId: 1, title: 'Target Web Page', url: 'https://example.com' };
            if (cb) cb(tab);
            return Promise.resolve(tab);
          },
        },
      };

      await captureVisible(DEFAULT_SETTINGS, 42);
      assert.equal(sentMessages[0].action, 'CAPTURE_VISIBLE_PART');
      assert.equal(sentMessages[0].payload.tabId, 42);
      assert.equal(sentMessages[0].payload.returnToTabId, 99);

      await captureFullPage(DEFAULT_SETTINGS, undefined, 42);
      assert.equal(sentMessages[1].action, 'CAPTURE_FULL_PAGE');
      assert.equal(sentMessages[1].payload.tabId, 42);
      assert.equal(sentMessages[1].payload.returnToTabId, 99);
    } finally {
      (globalThis as any).chrome = origChrome;
    }
  });

  it('background.js activates an inactive target tab before capturing and restores returnToTabId upon completion', async () => {
    let onMessageListener: any = null;
    const activatedTabs: number[] = [];

    const chromeMock = {
      runtime: {
        id: 'test-ext-id',
        getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
        onInstalled: { addListener: () => {} },
        onMessage: {
          addListener: (fn: any) => {
            onMessageListener = fn;
          },
        },
        getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
        sendMessage: async () => ({ ok: true }),
      },
      commands: { onCommand: { addListener: () => {} } },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      tabs: {
        onRemoved: { addListener: () => {} },
        get: async (id: number) => ({
          id,
          windowId: 1,
          active: id === 99,
          title: id === 42 ? 'Target Site' : 'Studio Hub',
          url: id === 42 ? 'https://example.com' : 'chrome-extension://test-ext-id/index.html?tab=true',
        }),
        update: async (id: number, props: any) => {
          if (props?.active) activatedTabs.push(id);
          return { id, active: true };
        },
        captureVisibleTab: async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
      storage: {
        sync: { get: async () => ({}) },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
      downloads: { download: async () => 1 },
    };

    const ctx = vm.createContext({
      chrome: chromeMock,
      console,
      crypto: { randomUUID: () => '12345678-abcd' },
      setTimeout: (fn: any) => {
        fn();
        return 1;
      },
      clearTimeout: () => {},
      fetch: async () => ({
        blob: async () => ({}),
      }),
      createImageBitmap: async () => ({
        width: 1200,
        height: 800,
        close() {},
      }),
      OffscreenCanvas: class {
        width = 720;
        height = 540;
        getContext() {
          return {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            drawImage() {},
          };
        }
        async convertToBlob() {
          return {
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
      },
      btoa: () => 'AAAA',
      Uint8Array,
      URL,
      Date,
      Promise,
      Map,
      Set,
      Object,
      Array,
      Number,
      String,
      Math,
    });

    vm.runInContext(BG_CODE, ctx);

    const pageSender = {
      id: 'test-ext-id',
      url: 'chrome-extension://test-ext-id/index.html?tab=true',
    };

    const res = await new Promise<any>((resolve) => {
      onMessageListener(
        {
          action: 'CAPTURE_VISIBLE_PART',
          payload: { tabId: 42, returnToTabId: 99, settings: { ...DEFAULT_SETTINGS, autoDownload: false } },
        },
        pageSender,
        resolve
      );
    });

    assert.equal(res.success, true);
    assert.deepEqual(
      activatedTabs,
      [42, 99],
      'Should activate target tab 42 to capture it and then restore Studio Hub tab 99'
    );
  });

  it('excludes signing keys and packed artifacts from git and pins Codacy action SHA', () => {
    const trackedSecrets = execFileSync(
      'git',
      ['ls-files', 'dist.pem', 'dist.crx', 'eng.traineddata', '.vscode/settings.json'],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(trackedSecrets, '', `Unexpected tracked secrets/artifacts: ${trackedSecrets}`);

    const gitignoreLines = fs
      .readFileSync('./.gitignore', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim());
    for (const pattern of ['.vscode/', '*.pem', '*.crx', '/eng.traineddata']) {
      assert.ok(gitignoreLines.includes(pattern), `.gitignore must include "${pattern}"`);
    }

    const codacyWorkflow = fs.readFileSync('./.github/workflows/codacy.yml', 'utf8');
    assert.match(
      codacyWorkflow,
      /uses:\s*codacy\/analysis-cli-action@[0-9a-f]{40}/,
      'codacy/analysis-cli-action must be pinned to a full 40-char commit SHA'
    );
  });
});

