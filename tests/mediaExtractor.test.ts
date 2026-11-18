import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  pickHighestResSrcset,
  extractCssUrls,
  inferImageFormat,
  deriveMediaName,
  filterAndSortMedia,
} from '../src/utils/mediaExtractor';
import { YoinkedMediaItem } from '../src/types';

const BG_CODE = fs.readFileSync('./public/background.js', 'utf8');

describe('Page Media Yoinker — Srcset, CSS Background, Format & Filter Utilities', () => {
  test('pickHighestResSrcset selects highest width descriptor (w) and resolves relative URLs', () => {
    const srcset = '/img/hero-400.webp 400w, /img/hero-1200.webp 1200w, /img/hero-2400.webp 2400w';
    const best = pickHighestResSrcset(srcset, 'https://yoink.app/docs');
    assert.equal(best, 'https://yoink.app/img/hero-2400.webp');
  });

  test('pickHighestResSrcset selects highest pixel density descriptor (2x, 3x)', () => {
    const srcset = 'https://cdn.example.com/avatar@1x.png 1x, https://cdn.example.com/avatar@3x.png 3x, https://cdn.example.com/avatar@2x.png 2x';
    const best = pickHighestResSrcset(srcset);
    assert.equal(best, 'https://cdn.example.com/avatar@3x.png');
  });

  test('extractCssUrls extracts multiple url() layers and ignores 1x1 tracking GIFs', () => {
    const css = `url("https://cdn.example.com/banner.jpg"), url('/assets/overlay.svg'), url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)`;
    const urls = extractCssUrls(css, 'https://example.com/home');
    assert.deepEqual(urls, [
      'https://cdn.example.com/banner.jpg',
      'https://example.com/assets/overlay.svg',
    ]);
  });

  test('inferImageFormat detects formats from extensions, query params, data URIs, and categories', () => {
    assert.equal(inferImageFormat('https://example.com/logo.svg'), 'svg');
    assert.equal(inferImageFormat('https://images.unsplash.com/photo-123?auto=format&fm=webp&w=1600'), 'webp');
    assert.equal(inferImageFormat('data:image/png;base64,iVBORw0KGgo='), 'png');
    assert.equal(inferImageFormat('https://example.com/stream', 'video'), 'png');
  });

  test('deriveMediaName prefers alt/title hints and falls back to clean URL filename', () => {
    assert.equal(
      deriveMediaName('https://example.com/img/product-hero-2x.png', 'Stripe Dashboard Hero'),
      'Stripe Dashboard Hero'
    );
    assert.equal(
      deriveMediaName('https://example.com/assets/company_logo_dark.svg', '', 'svg', 1),
      'company_logo_dark'
    );
  });

  test('filterAndSortMedia filters by category, minDimension, searchQuery and sorts largest area first', () => {
    const sample: YoinkedMediaItem[] = [
      {
        id: '1',
        url: 'https://example.com/icon.svg',
        name: 'Nav_Icon',
        category: 'svg',
        format: 'svg',
        width: 24,
        height: 24,
        sourceTag: 'Inline <svg>',
      },
      {
        id: '2',
        url: 'https://example.com/hero.webp',
        name: 'Hero_Banner',
        category: 'img',
        format: 'webp',
        width: 1920,
        height: 1080,
        sourceTag: '<img srcset>',
      },
      {
        id: '3',
        url: 'data:image/png;base64,123',
        name: 'Keynote_Video_Frame',
        category: 'video',
        format: 'png',
        width: 3840,
        height: 2160,
        sourceTag: '<video> Clean Frame',
      },
    ];

    // Sort order: 4K video frame first, then 1080p hero, then 24x24 icon
    const allSorted = filterAndSortMedia(sample);
    assert.deepEqual(allSorted.map((i) => i.id), ['3', '2', '1']);

    // Filter minDimension >= 600
    const hdOnly = filterAndSortMedia(sample, { minDimension: 600 });
    assert.deepEqual(hdOnly.map((i) => i.id), ['3', '2']);

    // Filter category === 'svg'
    const svgsOnly = filterAndSortMedia(sample, { category: 'svg' });
    assert.deepEqual(svgsOnly.map((i) => i.id), ['1']);

    // Filter searchQuery
    const searchWebp = filterAndSortMedia(sample, { searchQuery: 'webp' });
    assert.deepEqual(searchWebp.map((i) => i.id), ['2']);
  });

  test('extractAllPageMediaInTab removes 80-SVG/1200-element caps, scans shadow/same-origin frames, resolves SVG styles, and reports protected diagnostics', () => {
    function makeEl(tagName: string, attrs: Record<string, string> = {}, extra: Record<string, any> = {}) {
      const children: any[] = extra.children || [];
      const el: any = {
        tagName: tagName.toUpperCase(),
        id: attrs.id || '',
        alt: attrs.alt || '',
        title: attrs.title || '',
        src: attrs.src || '',
        currentSrc: attrs.src || '',
        srcset: attrs.srcset || '',
        poster: attrs.poster || '',
        readyState: extra.readyState ?? 0,
        videoWidth: extra.videoWidth ?? 0,
        videoHeight: extra.videoHeight ?? 0,
        width: extra.width ?? 100,
        height: extra.height ?? 100,
        clientWidth: extra.clientWidth ?? 100,
        clientHeight: extra.clientHeight ?? 100,
        naturalWidth: extra.naturalWidth ?? 100,
        naturalHeight: extra.naturalHeight ?? 100,
        children,
        shadowRoot: extra.shadowRoot || null,
        contentDocument: extra.contentDocument,
        _attrs: { ...attrs },
        _computedStyle: extra.computedStyle || { backgroundImage: 'none', color: 'rgb(37, 99, 235)', fill: 'currentColor' },
        getAttribute(name: string) {
          return this._attrs[name] ?? null;
        },
        setAttribute(name: string, val: string) {
          this._attrs[name] = String(val);
        },
        closest() {
          return extra.closestPicture || null;
        },
        getBoundingClientRect() {
          return { width: this.width, height: this.height };
        },
        querySelector(sel: string) {
          if (sel === 'title') return extra.titleNode || null;
          return null;
        },
        querySelectorAll(sel: string) {
          if (sel === 'path, circle, rect, polygon, polyline, line, ellipse, text, g, use') {
            return extra.svgDescendants || [];
          }
          if (sel === 'use') return extra.useNodes || [];
          return [];
        },
        cloneNode() {
          const clonedDescendants = (extra.svgDescendants || []).map((d: any) => ({ ...d, _attrs: { ...d._attrs }, setAttribute: d.setAttribute, getAttribute: d.getAttribute }));
          const cloned = makeEl(tagName, { ...this._attrs }, { ...extra, svgDescendants: clonedDescendants });
          cloned._children = extra.clonedChildren || [];
          cloned.insertBefore = (node: any) => cloned._children.unshift(node);
          cloned.firstChild = cloned._children[0] || null;
          return cloned;
        },
        toDataURL() {
          if (extra.tainted) {
            const err = new Error('Tainted canvases may not be exported.');
            err.name = 'SecurityError';
            throw err;
          }
          return extra.canvasDataUrl || 'data:image/png;base64,CANVAS';
        },
      };
      return el;
    }

    // 1. Create 95 distinct SVGs (> 80 old cap) and 1300 filler divs (> 1200 old cap) with a CSS bg at the end
    const svgs = Array.from({ length: 95 }, (_, idx) =>
      makeEl('svg', { id: `svg_${idx}`, fill: 'currentColor' }, { width: 32, height: 32 })
    );
    const fillers = Array.from({ length: 1300 }, () => makeEl('div'));
    const lateBgEl = makeEl('div', { id: 'late-bg' }, {
      width: 400,
      height: 200,
      computedStyle: { backgroundImage: 'url("https://cdn.example.com/late-bg.webp")' },
    });

    // 2. Shadow DOM image + lazy-loaded img
    const shadowImg = makeEl('img', {
      'data-lazy-srcset': '/shadow-800.jpg 800w, /shadow-1600.jpg 1600w',
      alt: 'Shadow Hero',
    });
    const shadowHost = makeEl('div', {}, {
      shadowRoot: {
        querySelectorAll: (sel: string) => {
          if (sel === '*') return [shadowHost, shadowImg];
          if (sel === 'img') return [shadowImg];
          return [];
        },
        getElementById: () => null,
      },
    });

    // 3. Same-origin iframe with an image + SVG whose styles come from iframe defaultView & getPropertyValue
    const frameImg = makeEl('img', { src: 'https://example.com/inside-frame.png', alt: 'Frame Image' });
    const frameSvg = makeEl('svg', { id: 'frame_svg', fill: 'currentColor' }, {
      width: 48,
      height: 48,
      computedStyle: {
        backgroundImage: 'none',
        color: 'rgb(16, 185, 129)',
        fill: '',
        getPropertyValue: (p: string) => (p === 'fill' ? 'currentColor' : p === 'color' ? 'rgb(16, 185, 129)' : ''),
      },
    });
    const sameOriginIframe = makeEl('iframe', {}, {
      contentDocument: {
        location: { href: 'https://example.com/frame.html' },
        defaultView: {
          getComputedStyle: (el: any) => el._computedStyle || { backgroundImage: 'none' },
        },
        querySelectorAll: (sel: string) => {
          if (sel === '*') return [frameImg, frameSvg];
          if (sel === 'img') return [frameImg];
          if (sel === 'svg') return [frameSvg];
          return [];
        },
        getElementById: () => null,
      },
    });
    const crossOriginIframe = makeEl('iframe', {}, {});
    Object.defineProperty(crossOriginIframe, 'contentDocument', {
      get() {
        throw new Error('Blocked a frame with origin');
      },
    });

    // 4. Tainted canvas + protected video
    const taintedCanvas = makeEl('canvas', {}, { width: 200, height: 200, tainted: true });
    const protectedVideo = makeEl('video', {}, { readyState: 3, videoWidth: 640, videoHeight: 360 });

    const allRootNodes = [...fillers, lateBgEl, shadowHost, sameOriginIframe, crossOriginIframe, ...svgs, taintedCanvas, protectedVideo];
    const documentMock: any = {
      title: 'Complex SPA Page',
      location: { href: 'https://example.com/app' },
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              drawImage: () => {
                throw new Error('SecurityError: cross-origin video');
              },
            }),
            toDataURL: () => 'data:image/png;base64,VIDEO',
          };
        }
        return { setAttribute: () => {}, appendChild: () => {} };
      },
      createElementNS: (_ns: string, tag: string) => ({ tagName: tag, appendChild: () => {} }),
      getElementById: (id: string) => (id === 'ext-icon' ? { tagName: 'symbol', cloneNode: () => ({ id }) } : null),
      querySelectorAll: (sel: string) => {
        if (sel === '*') return allRootNodes;
        if (sel === 'video') return [protectedVideo];
        if (sel === 'img') return [];
        if (sel === 'svg') return svgs;
        if (sel === 'canvas') return [taintedCanvas];
        return [];
      },
    };

    const ctx = vm.createContext({
      chrome: {
        runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test/${p}`, onInstalled: { addListener: () => {} }, onMessage: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        alarms: { onAlarm: { addListener: () => {} }, create: () => {} },
        tabs: { onRemoved: { addListener: () => {} } },
      },
      window: {
        location: { href: 'https://example.com/app' },
        getComputedStyle: (el: any) => el._computedStyle || { backgroundImage: 'none' },
      },
      document: documentMock,
      XMLSerializer: class {
        serializeToString(node: any) {
          return `<svg id="${node._attrs?.id || ''}" fill="${node._attrs?.fill || ''}" style="${node._attrs?.style || ''}"></svg>`;
        }
      },
      URL,
      Set,
      Map,
      Array,
      Object,
      Number,
      String,
      Math,
      Date,
      Promise,
      console,
    });

    vm.runInContext(BG_CODE, ctx);
    const extracted = vm.runInContext('extractAllPageMediaInTab()', ctx);

    assert.ok(Array.isArray(extracted.items), 'Expected { items, diagnostics } result');
    const svgItems = extracted.items.filter((i: any) => i.category === 'svg');
    assert.equal(svgItems.length, 96, 'Should extract all 96 SVGs (95 page + 1 iframe) without arbitrary 80-SVG cap');
    assert.ok(
      svgItems[0].svgCode.includes('rgb(37, 99, 235)') || svgItems[0].svgCode.includes('#2563eb'),
      'Should resolve inherited currentColor into serialized SVG'
    );
    assert.ok(
      extracted.items.some((i: any) => i.url === 'https://cdn.example.com/late-bg.webp'),
      'Should extract CSS background past the 1200th DOM element'
    );
    assert.ok(
      extracted.items.some((i: any) => i.url === 'https://example.com/shadow-1600.jpg'),
      'Should extract lazy-loaded srcset inside open shadow DOM'
    );
    assert.ok(
      extracted.items.some((i: any) => i.url === 'https://example.com/inside-frame.png'),
      'Should extract media inside accessible same-origin iframes'
    );
    const frameSvgItem = extracted.items.find((i: any) => i.name === 'frame_svg');
    assert.ok(frameSvgItem, 'Should extract SVG from same-origin iframe');
    assert.ok(
      frameSvgItem.svgCode.includes('rgb(16, 185, 129)'),
      'Should resolve iframe SVG styles using ownerDoc.defaultView.getComputedStyle and getPropertyValue fallback'
    );
    assert.equal(extracted.diagnostics.crossOriginFrames, 1);
    assert.equal(extracted.diagnostics.taintedCanvases, 1);
    assert.equal(extracted.diagnostics.protectedVideos, 1);
  });
});

