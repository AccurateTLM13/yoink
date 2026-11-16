import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickHighestResSrcset,
  extractCssUrls,
  inferImageFormat,
  deriveMediaName,
  filterAndSortMedia,
} from '../src/utils/mediaExtractor';
import { YoinkedMediaItem } from '../src/types';

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
});

