import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CONTENT_CODE = fs.readFileSync('./public/content.js', 'utf8');

describe('Phase 1: Page Compatibility (SPA Inner Scroll Container & Shadow DOM Isolation)', () => {
  it('startScrollCapture automatically detects and scrolls the primary inner scrollable container on SPAs when window is not scrollable', async () => {
    let contentMessageListener: any = null;
    const capturedOffsets: number[] = [];

    const innerMainEl: any = {
      tagName: 'MAIN',
      scrollTop: 0,
      clientHeight: 1000,
      scrollHeight: 2600,
      style: { overflow: 'auto' },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 1000 }),
      scrollIntoView: () => {},
    };

    const windowMock: any = {
      __YOINK_CONTENT_INITIALIZED__: false,
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1200,
      innerHeight: 1000,
      devicePixelRatio: 1,
      location: { href: 'https://app.example.com/workspace' },
      scrollTo() {
        // Window itself does not scroll on this SPA
      },
      getComputedStyle(el: any) {
        if (el === innerMainEl) {
          return { overflowY: 'auto', position: 'relative', display: 'block', visibility: 'visible' };
        }
        return { overflowY: 'hidden', position: 'static', display: 'block', visibility: 'visible' };
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const documentMock: any = {
      title: 'SPA Dashboard',
      body: {
        style: { overflow: 'hidden' },
        scrollHeight: 1000,
        offsetHeight: 1000,
        children: [innerMainEl],
      },
      documentElement: {
        scrollHeight: 1000,
        offsetHeight: 1000,
        scrollTop: 0,
        appendChild: () => {},
      },
      querySelectorAll: () => [innerMainEl],
      elementFromPoint: () => innerMainEl,
      getElementById: () => null,
    };

    let finalizeAction = '';
    let finalizePayload: any = null;
    let resolveFinalize!: () => void;
    const finalizePromise = new Promise<void>((r) => {
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
            capturedOffsets.push(msg.payload.yOffset);
            return { ok: true, index: msg.payload.index };
          }
          if (msg.action === 'FINALIZE_STITCHING' || msg.action === 'FINALIZE_ELEMENT_STITCHING') {
            finalizeAction = msg.action;
            finalizePayload = msg.payload;
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
      Map,
      Array,
      Object,
      Math,
      Number,
      String,
    });

    vm.runInContext(CONTENT_CODE, ctx);

    contentMessageListener(
      { action: 'START_SCROLL_CAPTURE', payload: { scrollDelay: 10, hideSticky: true } },
      {},
      () => {}
    );

    await finalizePromise;

    assert.equal(
      capturedOffsets.length,
      3,
      'Should scroll inner <main> container across 3 chunks (0, 1000, 1600) when window is not scrollable'
    );
    assert.deepEqual(capturedOffsets, [0, 1000, 1600]);
    assert.ok(finalizeAction, 'Should send finalize stitching message');
    assert.equal(finalizePayload.totalHeight, 2600);
    assert.equal(innerMainEl.scrollTop, 0, 'Should restore inner container scrollTop after capture');
  });

  it('initSelectionOverlay and initElementInspector mount their UI inside a closed Shadow Root to prevent host CSS collisions', () => {
    let contentMessageListener: any = null;
    const appendedHosts: any[] = [];

    function createMockElement(tag: string) {
      const el: any = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        innerText: '',
        textContent: '',
        style: {},
        children: [] as any[],
        shadowRootInstance: null as any,
        parentNode: null as any,
        appendChild(child: any) {
          child.parentNode = el;
          this.children.push(child);
          return child;
        },
        append(...nodes: any[]) {
          for (const n of nodes) {
            if (typeof n === 'object' && n) {
              n.parentNode = el;
              this.children.push(n);
            }
          }
        },
        removeChild(child: any) {
          this.children = this.children.filter((c: any) => c !== child);
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        attachShadow(init: { mode: string }) {
          const sr = createMockElement('shadow-root');
          sr.mode = init.mode;
          this.shadowRootInstance = sr;
          return sr;
        },
      };
      return el;
    }

    const docElement = createMockElement('html');
    const origAppend = docElement.appendChild.bind(docElement);
    docElement.appendChild = (child: any) => {
      appendedHosts.push(child);
      return origAppend(child);
    };

    const windowMock: any = {
      __YOINK_CONTENT_INITIALIZED__: false,
      innerWidth: 1200,
      innerHeight: 800,
      devicePixelRatio: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const documentMock: any = {
      documentElement: docElement,
      body: createMockElement('body'),
      createElement: (tag: string) => createMockElement(tag),
      createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
      getElementById: (id: string) => docElement.children.find((c: any) => c.id === id) || null,
    };

    const chromeMock = {
      runtime: {
        onMessage: {
          addListener: (fn: any) => {
            contentMessageListener = fn;
          },
        },
        sendMessage: async () => ({ ok: true }),
      },
    };

    const ctx = vm.createContext({
      window: windowMock,
      document: documentMock,
      chrome: chromeMock,
      setTimeout,
      clearTimeout,
      Promise,
      Set,
      Map,
      Array,
      Object,
      Math,
      Number,
      String,
    });

    vm.runInContext(CONTENT_CODE, ctx);

    // 1. Trigger Selection Overlay
    contentMessageListener({ action: 'START_SELECTION_CAPTURE' }, {}, () => {});
    const selectionHost = appendedHosts.find((h) => h.id === 'omnicapture-selection-overlay');
    assert.ok(selectionHost, 'Selection overlay host should be appended to documentElement');
    assert.ok(selectionHost.shadowRootInstance, 'Selection overlay host must attach a Shadow Root');
    assert.equal(selectionHost.shadowRootInstance.mode, 'closed', 'Shadow Root should be closed mode');
    assert.equal(
      selectionHost.children.length,
      0,
      'Selection UI elements must be appended inside the Shadow Root, not light DOM'
    );
    assert.ok(
      selectionHost.shadowRootInstance.children.length > 0,
      'Shadow Root should contain the selection overlay UI elements'
    );

    // 2. Trigger Element Inspector Overlay
    contentMessageListener({ action: 'START_ELEMENT_SCROLL_CAPTURE', payload: { scrollDelay: 600 } }, {}, () => {});
    const inspectorHost = appendedHosts.find((h) => h.id === 'omnicapture-inspector-overlay');
    assert.ok(inspectorHost, 'Inspector overlay host should be appended to documentElement');
    assert.ok(inspectorHost.shadowRootInstance, 'Inspector overlay host must attach a Shadow Root');
    assert.equal(inspectorHost.shadowRootInstance.mode, 'closed', 'Inspector Shadow Root should be closed mode');
    assert.equal(
      inspectorHost.children.length,
      0,
      'Inspector UI elements must be appended inside the Shadow Root, not light DOM'
    );
    assert.ok(
      inspectorHost.shadowRootInstance.children.length > 0,
      'Inspector Shadow Root should contain the inspector UI elements'
    );
  });
});

