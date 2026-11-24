import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryItem } from '../src/types';
import {
  estimateBase64Bytes,
  formatFileSize,
  formatDimensions,
  formatCaptureReadout,
  formatProofStamp,
  safeHostname,
  getModeLabel,
  computeAspectRatio,
  computeLibrarySummary,
  filterHistoryItems,
  buildProvenanceTimeline,
} from '../src/utils/studioFormat';
import {
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  applyThemeToDocument,
  persistTheme,
  toggleTheme,
} from '../src/utils/theme';

const SAMPLE_ITEMS: HistoryItem[] = [
  {
    id: 'cap-1',
    title: 'Linear Workspace Issues',
    url: 'https://linear.app/yoink/team/ENG/active',
    dataUrl: '',
    thumbnailUrl: 'data:image/jpeg;base64,AAAA',
    timestamp: Date.UTC(2026, 10, 23, 14, 30, 0),
    width: 1440,
    height: 900,
    mode: 'full',
    format: 'png',
    fileSizeBytes: 253952, // 248 KB
    proofSigned: true,
    proofKeyId: '#8F3A-9C21-B40E',
    ocrText: 'Sprint 14 release checklist verified',
  },
  {
    id: 'cap-2',
    title: 'Mobile Checkout Viewport',
    url: 'https://shop.example.com/checkout?step=2',
    dataUrl: '',
    thumbnailUrl: 'data:image/jpeg;base64,BBBB',
    timestamp: Date.UTC(2026, 10, 23, 12, 15, 0),
    width: 390,
    height: 844,
    mode: 'multisize',
    format: 'webp',
    viewport: { width: 390, height: 844, dpr: 2, requestedWidth: 390, requestedHeight: 844 },
    fileSizeBytes: 74240, // 72.5 KB
    proofSigned: false,
  },
  {
    id: 'cap-3',
    title: 'Local Diagram Upload',
    url: '',
    dataUrl: 'data:image/png;base64,' + 'A'.repeat(1600), // 1200 bytes
    timestamp: Date.UTC(2026, 10, 22, 9, 5, 0),
    width: 1600,
    height: 12000,
    mode: 'upload',
    format: 'png',
    warning: 'Partial capture: page exceeded single-canvas limit.',
  },
];

describe('Studio Hub & Gallery formatting and filtering utilities', () => {
  it('estimates base64 payload bytes and formats file sizes with tabular clarity', () => {
    assert.equal(estimateBase64Bytes(''), undefined);
    assert.equal(estimateBase64Bytes('not-a-data-url'), undefined);
    assert.equal(estimateBase64Bytes('data:image/png;base64,AAAA'), 3);
    assert.equal(estimateBase64Bytes('data:image/png;base64,AA=='), 1);

    assert.equal(formatFileSize(840), '840 B');
    assert.equal(formatFileSize(74240), '72.5 KB');
    assert.equal(formatFileSize(253952), '248 KB');
    assert.equal(formatFileSize(1_572_864), '1.5 MB');
    assert.equal(formatFileSize(undefined, 'data:image/png;base64,' + 'A'.repeat(1600)), '1.2 KB');
    assert.equal(formatFileSize(undefined, ''), null);
  });

  it('builds DESIGN.md flush pixel stamps and proof stamps', () => {
    assert.equal(formatDimensions(1440, 900), '1440×900');
    assert.equal(formatDimensions(0, 900), null);

    assert.equal(formatCaptureReadout(SAMPLE_ITEMS[0]), '1440×900 · PNG · 248 KB');
    assert.equal(formatCaptureReadout(SAMPLE_ITEMS[1]), '390×844 · WEBP · 72.5 KB');
    assert.equal(
      formatCaptureReadout({ ...SAMPLE_ITEMS[1], fileSizeBytes: undefined }),
      '390×844 · WEBP'
    );

    assert.equal(formatProofStamp(SAMPLE_ITEMS[0]), 'ECDSA · VERIFIED');
    assert.equal(formatProofStamp(SAMPLE_ITEMS[1]), null);
  });

  it('extracts safe hostnames, sentence-case mode labels, and clamped natural aspect ratios', () => {
    assert.equal(safeHostname('https://linear.app/yoink/team/ENG/active'), 'linear.app');
    assert.equal(safeHostname(''), 'Local file');
    assert.equal(safeHostname('not-a-url'), 'Local file');

    assert.equal(getModeLabel('full'), 'Full page');
    assert.equal(getModeLabel('visible'), 'Visible viewport');
    assert.equal(getModeLabel('selection'), 'Region selection');
    assert.equal(getModeLabel('multisize'), 'Responsive');

    assert.equal(computeAspectRatio(1440, 900), 1.6);
    assert.equal(computeAspectRatio(1600, 12000), 0.75); // Tall scroll clamped for grid legibility
    assert.equal(computeAspectRatio(5000, 200), 2.5); // Ultra-wide strip clamped
    assert.equal(computeAspectRatio(0, 0), 16 / 10); // Fallback when dimensions unavailable
  });

  it('computes real library summary counts and filters by mode, proof status, and OCR text', () => {
    const summary = computeLibrarySummary(SAMPLE_ITEMS);
    assert.equal(summary.totalCount, 3);
    assert.equal(summary.signedCount, 1);
    assert.equal(summary.totalBytes, 253952 + 74240 + 1200);
    assert.equal(summary.latestTimestamp, SAMPLE_ITEMS[0].timestamp);
    assert.equal(summary.modeCounts.full, 1);
    assert.equal(summary.modeCounts.multisize, 1);

    assert.equal(filterHistoryItems(SAMPLE_ITEMS, '', 'all').length, 3);
    assert.equal(filterHistoryItems(SAMPLE_ITEMS, '', 'signed').length, 1);
    assert.equal(filterHistoryItems(SAMPLE_ITEMS, '', 'multisize')[0].id, 'cap-2');
    assert.equal(filterHistoryItems(SAMPLE_ITEMS, 'Sprint 14', 'all')[0].id, 'cap-1');
    assert.equal(filterHistoryItems(SAMPLE_ITEMS, '8F3A-9C21', 'all')[0].id, 'cap-1');
    assert.equal(filterHistoryItems(SAMPLE_ITEMS, 'shop.example.com', 'all')[0].id, 'cap-2');
  });

  it('builds a real provenance timeline strictly from captured item metadata', () => {
    const signedEvents = buildProvenanceTimeline(SAMPLE_ITEMS[0]);
    assert.ok(signedEvents.some((e) => e.kind === 'capture' && e.detail.includes('Full page')));
    assert.ok(signedEvents.some((e) => e.kind === 'origin' && e.detail.includes('linear.app')));
    assert.ok(signedEvents.some((e) => e.kind === 'proof' && e.detail.includes('#8F3A-9C21-B40E')));
    assert.ok(signedEvents.some((e) => e.kind === 'ocr' && e.detail.includes('36 chars')));

    const warningEvents = buildProvenanceTimeline(SAMPLE_ITEMS[2]);
    assert.ok(warningEvents.some((e) => e.kind === 'warning' && e.detail.includes('Partial capture')));
    assert.equal(warningEvents.some((e) => e.kind === 'proof'), false);
  });
});

describe('Theme token resolution and persistence', () => {
  it('resolves stored theme, falls back to system preference, toggles, and applies data-theme', () => {
    const store = new Map<string, string>();
    const storageMock = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };

    assert.equal(resolveInitialTheme(storageMock, true), 'dark');
    assert.equal(resolveInitialTheme(storageMock, false), 'light');

    persistTheme('dark', storageMock);
    assert.equal(store.get(THEME_STORAGE_KEY), 'dark');
    assert.equal(resolveInitialTheme(storageMock, false), 'dark');

    assert.equal(toggleTheme('dark'), 'light');
    assert.equal(toggleTheme('light'), 'dark');

    const attrs: Record<string, string> = {};
    const docMock = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
      },
    };
    applyThemeToDocument('dark', docMock as unknown as Document);
    assert.equal(attrs['data-theme'], 'dark');
  });
});

describe('DESIGN.md strict token & craft conformance', () => {
  it('defines all exact DESIGN.md light and dark tokens and responsive gallery grid in src/index.css', () => {
    const css = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
    const requiredTokens = [
      '--canvas: #F7F7F5',
      '--surface: #FFFFFF',
      '--border: #E4E4E0',
      '--ink: #141518',
      '--ink-muted: #62666F',
      '--accent: #1D4ED8',
      '--accent-ink: #FFFFFF',
      '--semantic-valid: #15803D',
      '--semantic-error: #DC2626',
      '--canvas: #0F1012',
      '--surface: #17181C',
      '--border: #27292F',
      '--ink: #F2F3F5',
      '--ink-muted: #8E939E',
      '--accent: #60A5FA',
      '--accent-ink: #0B1120',
      '--semantic-valid: #4ADE80',
      '--semantic-error: #F87171',
    ];
    for (const token of requiredTokens) {
      assert.ok(css.includes(token), `src/index.css must define "${token}"`);
    }
    assert.match(css, /repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)/);
    assert.match(css, /gap:\s*20px/);
  });

  it('exposes weights 400-600 for bundled local fonts in src/fonts.css', () => {
    const fontsCss = fs.readFileSync(path.resolve('src/fonts.css'), 'utf8');
    const matches = fontsCss.match(/font-weight:\s*400\s+[67]00/g) || [];
    assert.equal(matches.length, 3, 'All three bundled variable fonts must cover weights 400..600+');
  });

  it('enforces DESIGN.md token-only, zero-slop rules across all src/components/studio/*.tsx files', () => {
    const studioDir = path.resolve('src/components/studio');
    assert.ok(fs.existsSync(studioDir), 'src/components/studio directory must exist');
    const files = fs.readdirSync(studioDir).filter((f) => f.endsWith('.tsx'));
    assert.ok(files.length >= 5, 'Expected modular Studio Hub & Gallery components');

    const forbiddenPatterns: Array<{ name: string; regex: RegExp }> = [
      {
        name: 'hardcoded Tailwind color palettes',
        regex: /\b(?:bg|text|border|ring|fill|stroke)-(?:zinc|slate|gray|neutral|stone|blue|indigo|purple|violet|emerald|green|amber|yellow|orange|rose|red|sky|cyan|teal|pink|fuchsia|lime)-\d{2,3}\b/,
      },
      { name: 'gradients', regex: /\bbg-gradient-to-|\bfrom-[a-z]+-\d|\bvia-[a-z]+-\d|\bto-[a-z]+-\d/ },
      { name: 'drop shadows', regex: /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|\[)/ },
      { name: 'emoji icons', regex: /[📸✨✂️🔒✏️🔍📄🎉🚀🔥💡]/u },
      { name: 'uppercase CSS label transforms', regex: /\buppercase\b/ },
      { name: 'wide uppercase tracking', regex: /\btracking-(?:wider|widest)\b/ },
      { name: '700-900 shouting font weights', regex: /\bfont-(?:bold|extrabold|black)\b/ },
      { name: 'non-DESIGN.md Tailwind font-size utilities', regex: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/ },
      {
        name: 'arbitrary font sizes outside DESIGN.md scale (11,12,13,14,18,24)',
        regex: /\btext-\[(?!(?:11|12|13|14|18|24)px\])\d+(?:\.\d+)?px\]/,
      },
      {
        name: 'off-grid 4px spacing values',
        regex: /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-x|space-y)-(?:1\.5|2\.5|3\.5|4\.5|5\.5|7|9|10|11)\b/,
      },
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(studioDir, file), 'utf8');
      for (const rule of forbiddenPatterns) {
        assert.equal(
          rule.regex.test(content),
          false,
          `${file} violates DESIGN.md rule (${rule.name}): matched ${content.match(rule.regex)?.[0]}`
        );
      }
    }
  });
});
