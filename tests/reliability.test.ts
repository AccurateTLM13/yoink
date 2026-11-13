import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const BG_CODE = fs.readFileSync(path.join(ROOT, 'public/background.js'), 'utf8');
const OFFSCREEN_CODE = fs.readFileSync(path.join(ROOT, 'public/offscreen.js'), 'utf8');
const CONTENT_CODE = fs.readFileSync(path.join(ROOT, 'public/content.js'), 'utf8');

describe('High-Impact Reliability Improvements (Streaming Stitch, Dynamic Canvas, Sticky Preservation)', () => {
  it('background.js streams each chunk to offscreen STITCH_ADD immediately during CAPTURE_VISIBLE_TAB without buffering dataUrls in RAM, and aborts on cancel', async () => {
    let onMessageListener: any = null;
    let onRemovedListener: any = null;
    const offscreenCalls: { type: string; payload: any }[] = [];

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
        sendMessage: async (msg: any) => {
          if (msg?.target === 'offscreen') {
            offscreenCalls.push({ type: msg.type, payload: msg.payload });
            if (msg.type === 'STITCH_BEGIN') return { ok: true };
            if (msg.type === 'STITCH_ADD') return { ok: true };
            if (msg.type === 'STITCH_ABORT') return { ok: true };
            if (msg.type === 'STITCH_END') {
              return {
                dataUrl: 'data:image/png;base64,FINAL_STITCHED',
                thumbnailUrl: 'data:image/jpeg;base64,THUMB',
                width: 2400,
                height: 6000,
              };
            }
          }
          return { ok: true };
        },
      },
      commands: { onCommand: { addListener: () => {} } },
      alarms: {
        create: () => {},
        onAlarm: { addListener: () => {} },
      },
      tabs: {
        onRemoved: {
          addListener: (fn: any) => {
            onRemovedListener = fn;
          },
        },
        captureVisibleTab: async () => 'data:image/png;base64,CHUNK_IMAGE_DATA',
        setZoom: async () => {},
        getZoom: async () => 1,
      },
      storage: {
        sync: { get: async () => ({}) },
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
      downloads: {
        download: async () => 1,
      },
    };

    const ctx = vm.createContext({
      chrome: chromeMock,
      console,
      crypto: { randomUUID: () => 'job-1234-5678' },
      setTimeout: (fn: any) => {
        fn();
        return 1;
      },
      clearTimeout: () => {},
      URL,
      Date: { now: () => 1000000 },
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
    assert.ok(onMessageListener, 'background.js should register runtime.onMessage listener');

    const contentSender = {
      id: 'test-ext-id',
      url: 'https://example.com/page',
      frameId: 0,
      tab: { id: 42, windowId: 1, active: true, title: 'Example', url: 'https://example.com/page' },
    };

    const sendFromContent = (action: string, payload: any) =>
      new Promise<any>((resolve) => {
        onMessageListener({ action, payload }, contentSender, resolve);
      });

    // Chunk 0 arrives with stitch metadata
    const res0 = await sendFromContent('CAPTURE_VISIBLE_TAB', {
      index: 0,
      yOffset: 0,
      kind: 'full',
      totalWidth: 1200,
      totalHeight: 3000,
      dpr: 2,
    });
    assert.equal(res0.ok, true);
    assert.equal(res0.index, 0);

    // Verify STITCH_BEGIN and STITCH_ADD were called immediately during CAPTURE_VISIBLE_TAB!
    assert.equal(
      offscreenCalls.some((c) => c.type === 'STITCH_BEGIN'),
      true,
      'Should call STITCH_BEGIN immediately on chunk 0'
    );
    assert.equal(
      offscreenCalls.filter((c) => c.type === 'STITCH_ADD').length,
      1,
      'Should stream chunk 0 to STITCH_ADD immediately during CAPTURE_VISIBLE_TAB'
    );

    // Chunk 1 arrives
    const res1 = await sendFromContent('CAPTURE_VISIBLE_TAB', {
      index: 1,
      yOffset: 1000,
      kind: 'full',
      totalWidth: 1200,
      totalHeight: 3000,
      dpr: 2,
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.index, 1);
    assert.equal(
      offscreenCalls.filter((c) => c.type === 'STITCH_ADD').length,
      2,
      'Should stream chunk 1 to STITCH_ADD immediately'
    );

    // Verify scrollSessions in background worker is NOT holding raw base64 dataUrl strings
    const retainedDataUrls = vm.runInContext(
      'Array.from(scrollSessions.values()).flatMap(s => (s.dataUrls || []).filter(Boolean))',
      ctx
    );
    assert.equal(
      retainedDataUrls.length,
      0,
      'background.js must not buffer raw base64 chunk strings in scrollSessions after streaming to offscreen'
    );

    // If cancelled, background.js should send STITCH_ABORT to release the offscreen canvas
    await sendFromContent('CAPTURE_CANCELLED', {});
    assert.equal(
      offscreenCalls.some((c) => c.type === 'STITCH_ABORT'),
      true,
      'Should send STITCH_ABORT to offscreen document when capture is cancelled'
    );
    assert.ok(onRemovedListener);
  });

  it('offscreen.js dynamically grows the stitch canvas when lazy-loaded content exceeds initial totalHeight and supports STITCH_ABORT', async () => {
    let onMessageListener: any = null;
    const drawOps: { y: number; h: number; canvasH: number }[] = [];

    class MockOffscreenCanvas {
      width: number;
      height: number;
      drawn: { y: number; h: number }[] = [];
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        const self = this;
        return {
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          fillStyle: '#fff',
          fillRect: () => {},
          drawImage(src: any, ...args: number[]) {
            if (src instanceof MockOffscreenCanvas) {
              self.drawn.push(...src.drawn);
              return;
            }
            const destY = args.length === 2 ? args[1] : args[5];
            const h = args.length === 2 ? src.height : args[7];
            self.drawn.push({ y: destY, h });
            drawOps.push({ y: destY, h, canvasH: self.height });
          },
        };
      }
      async convertToBlob() {
        return new Blob(['mock-img'], { type: 'image/png' });
      }
    }

    class MockFileReader {
      result = 'data:image/png;base64,MOCK';
      onload: any = null;
      onerror: any = null;
      readAsDataURL() {
        if (this.onload) this.onload();
      }
    }

    const ctx = vm.createContext({
      chrome: {
        runtime: {
          id: 'test-ext-id',
          getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
          onMessage: {
            addListener: (fn: any) => {
              onMessageListener = fn;
            },
          },
        },
      },
      OffscreenCanvas: MockOffscreenCanvas,
      FileReader: MockFileReader,
      fetch: async () => ({
        blob: async () => ({ type: 'image/png' }),
      }),
      createImageBitmap: async () => ({
        width: 1200,
        height: 800,
        close() {},
      }),
      console,
      Date,
      Promise,
      Map,
      Object,
      Number,
      String,
      Math,
    });

    vm.runInContext(OFFSCREEN_CODE, ctx);
    assert.ok(onMessageListener, 'offscreen.js should register runtime.onMessage listener');

    const bgSender = {
      id: 'test-ext-id',
      url: 'chrome-extension://test-ext-id/background.js',
    };

    const callOffscreen = (type: string, payload: any) =>
      new Promise<any>((resolve) => {
        onMessageListener({ target: 'offscreen', type, payload }, bgSender, resolve);
      });

    // Begin job with initial totalHeight = 1600, but then lazy-loaded page scrolls to yOffset = 1600 (requiring height 2400)
    await callOffscreen('STITCH_BEGIN', {
      jobId: 'job-grow',
      kind: 'full',
      totalWidth: 1200,
      totalHeight: 1600,
      dpr: 1,
      settings: { format: 'png', quality: 0.92 },
    });

    await callOffscreen('STITCH_ADD', {
      jobId: 'job-grow',
      dataUrl: 'data:image/png;base64,AA==',
      yOffset: 0,
    });

    await callOffscreen('STITCH_ADD', {
      jobId: 'job-grow',
      dataUrl: 'data:image/png;base64,AA==',
      yOffset: 800,
    });

    // Third chunk at yOffset = 1600 exceeds initial 1600px height!
    await callOffscreen('STITCH_ADD', {
      jobId: 'job-grow',
      dataUrl: 'data:image/png;base64,AA==',
      yOffset: 1600,
    });

    const endRes = await callOffscreen('STITCH_END', { jobId: 'job-grow' });
    assert.equal(endRes.width, 1200);
    assert.equal(endRes.height, 2400, 'Canvas should dynamically expand to fit lazy-loaded chunk at yOffset=1600 + 800px');

    // Verify STITCH_ABORT removes active job cleanly
    await callOffscreen('STITCH_BEGIN', {
      jobId: 'job-abort',
      kind: 'full',
      totalWidth: 1200,
      totalHeight: 1600,
      dpr: 1,
      settings: { format: 'png', quality: 0.92 },
    });
    const abortRes = await callOffscreen('STITCH_ABORT', { jobId: 'job-abort' });
    assert.equal(abortRes.ok, true);
  });

  it('content.js keeps fixed/sticky elements visible on chunk 0, hides them with visibility:hidden on chunks 1..N, and restores them on finish', async () => {
    let contentMessageListener: any = null;
    const stickyStatesAtChunk: { index: number; position: string; visibility: string }[] = [];

    function makeMockStyle(initialPos = 'fixed', initialVis = '') {
      const props: Record<string, { value: string; priority: string }> = {
        position: { value: initialPos, priority: '' },
        visibility: { value: initialVis, priority: '' },
        'pointer-events': { value: '', priority: '' },
      };
      return {
        get position() {
          return props.position.value;
        },
        set position(v: string) {
          props.position = { value: v, priority: '' };
        },
        get visibility() {
          return props.visibility.value;
        },
        set visibility(v: string) {
          props.visibility = { value: v, priority: '' };
        },
        getPropertyValue(name: string) {
          return props[name]?.value || '';
        },
        getPropertyPriority(name: string) {
          return props[name]?.priority || '';
        },
        setProperty(name: string, value: string, priority = '') {
          props[name] = { value, priority };
        },
        removeProperty(name: string) {
          delete props[name];
        },
      };
    }

    const stickyHeader: any = {
      tagName: 'HEADER',
      style: makeMockStyle('fixed', 'visible'),
      computedPosition: 'fixed',
    };

    let scrollY = 0;
    const windowMock: any = {
      __YOINK_CONTENT_INITIALIZED__: false,
      scrollX: 0,
      get scrollY() {
        return scrollY;
      },
      innerWidth: 1200,
      innerHeight: 1000,
      devicePixelRatio: 2,
      location: { href: 'https://example.com' },
      scrollTo(x: number, y: number) {
        scrollY = y;
      },
      getComputedStyle(el: any) {
        return { position: el.computedPosition || el.style.position || 'static' };
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const documentMock: any = {
      title: 'Sticky Test Page',
      body: {
        style: { overflow: '' },
        scrollHeight: 2500,
        offsetHeight: 2500,
        children: [stickyHeader],
      },
      documentElement: {
        scrollHeight: 2500,
        offsetHeight: 2500,
        scrollTop: 0,
        appendChild: () => {},
      },
      querySelectorAll: () => [stickyHeader],
      getElementById: () => null,
    };

    let finalizeSent: Promise<void>;
    let resolveFinalize!: () => void;
    finalizeSent = new Promise<void>((r) => {
      resolveFinalize = r;
    });

    const chromeMock = {
      runtime: {
        onMessage: {
          addListener: (fn: any) => {
            contentMessageListener = fn;
          },
        },
        sendMessage: async (msg: any) => {
          if (msg.action === 'CAPTURE_VISIBLE_TAB') {
            stickyStatesAtChunk.push({
              index: msg.payload.index,
              position: stickyHeader.style.position,
              visibility: stickyHeader.style.getPropertyValue('visibility'),
            });
            return { ok: true, index: msg.payload.index };
          }
          if (msg.action === 'FINALIZE_STITCHING') {
            resolveFinalize();
            return { success: true };
          }
          return { ok: true };
        },
      },
    };

    const ctx = vm.createContext({
      window: windowMock,
      document: documentMock,
      chrome: chromeMock,
      setTimeout: (fn: any) => {
        fn();
        return 1;
      },
      clearTimeout: () => {},
      Promise,
      Set,
      Array,
      Object,
      Math,
      Number,
      String,
    });

    vm.runInContext(CONTENT_CODE, ctx);
    assert.ok(contentMessageListener, 'content.js should register runtime.onMessage listener');

    contentMessageListener(
      { action: 'START_SCROLL_CAPTURE', payload: { scrollDelay: 10, hideSticky: true } },
      {},
      () => {}
    );

    await finalizeSent;

    assert.equal(stickyStatesAtChunk.length, 3, 'Should capture 3 chunks for 2500px page with 1000px viewport');
    // Chunk 0: sticky header must NOT have its position mutated to absolute and must remain visible!
    assert.equal(stickyStatesAtChunk[0].position, 'fixed', 'Chunk 0 must preserve position:fixed so navbar layout does not break');
    assert.equal(stickyStatesAtChunk[0].visibility, 'visible', 'Chunk 0 must keep fixed navbar visible at top of page');

    // Chunks 1 & 2: sticky header must be hidden via visibility:hidden without changing position:fixed!
    assert.equal(stickyStatesAtChunk[1].position, 'fixed', 'Chunk 1 must not mutate position to absolute');
    assert.equal(stickyStatesAtChunk[1].visibility, 'hidden', 'Chunk 1 must hide fixed navbar via visibility:hidden');
    assert.equal(stickyStatesAtChunk[2].visibility, 'hidden', 'Chunk 2 must hide fixed navbar via visibility:hidden');

    // After capture finishes, original visibility must be restored
    assert.equal(stickyHeader.style.getPropertyValue('visibility'), 'visible', 'Original visibility must be restored after capture');
  });
});
