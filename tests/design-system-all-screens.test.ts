import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ProofVerificationResult, ResolutionConfig, YoinkedMediaItem } from '../src/types';
import {
  formatProofVerdict,
  formatMediaStamp,
  formatViewportFrameHeader,
} from '../src/utils/studioFormat';

describe('Proof Vault, Media Yoinker & Responsive Matrix formatting helpers', () => {
  it('maps ProofVerificationResult statuses to plain-language verdicts first', () => {
    const base: ProofVerificationResult = {
      verified: true,
      status: 'authentic',
      summary: 'Valid',
      hasMetadataProof: true,
      hasPixelWatermark: true,
      hasIptcScreenCapture: true,
      signatureValid: true,
      pixelsIntact: true,
      isOwnCapture: true,
    };

    assert.deepEqual(formatProofVerdict(base), {
      tone: 'valid',
      headline: 'Verified',
      stamp: 'ECDSA · VERIFIED',
    });

    assert.deepEqual(formatProofVerdict({ ...base, isDerivative: true }), {
      tone: 'valid',
      headline: 'Verified derivative',
      stamp: 'ECDSA · DERIVATIVE',
    });

    assert.deepEqual(
      formatProofVerdict({ ...base, verified: false, status: 'tampered', pixelsIntact: false }),
      {
        tone: 'error',
        headline: 'Altered after signing',
        stamp: 'ECDSA · ALTERED',
      }
    );

    assert.deepEqual(
      formatProofVerdict({
        ...base,
        verified: false,
        status: 'invalid_signature',
        signatureValid: false,
      }),
      {
        tone: 'error',
        headline: 'Invalid signature',
        stamp: 'ECDSA · INVALID',
      }
    );

    assert.deepEqual(
      formatProofVerdict({
        ...base,
        verified: false,
        status: 'unsigned',
        signatureValid: false,
        hasMetadataProof: false,
      }),
      {
        tone: 'neutral',
        headline: 'Unverified',
        stamp: 'UNSIGNED',
      }
    );
  });

  it('formats plain JetBrains Mono stamps for extracted page media items', () => {
    const imgItem: YoinkedMediaItem = {
      id: 'm1',
      url: 'https://cdn.example.com/hero.webp',
      name: 'hero',
      category: 'img',
      format: 'webp',
      width: 1600,
      height: 1200,
      sourceTag: '<img>',
    };
    assert.equal(formatMediaStamp(imgItem), '1600×1200 · WEBP · Image');

    const svgItem: YoinkedMediaItem = {
      id: 'm2',
      url: 'data:image/svg+xml;base64,AA==',
      name: 'mark',
      category: 'svg',
      format: 'svg',
      width: 0,
      height: 0,
      sourceTag: '<svg>',
    };
    assert.equal(formatMediaStamp(svgItem), 'SVG · Vector');
  });

  it('formats Sizzy-style device frame headers with dimensions and zoom', () => {
    const mobile: ResolutionConfig = { name: 'Mobile (iPhone 14)', width: 390, height: 844 };
    assert.equal(formatViewportFrameHeader(mobile, 100), '(390 × 844) 100%');
    assert.equal(formatViewportFrameHeader(mobile, 75), '(390 × 844) 75%');
  });
});

describe('Product-wide DESIGN.md strict token & craft conformance across all UI components', () => {
  const TARGET_FILES = [
    'src/components/VerifyModal.tsx',
    'src/components/UrlBatchModal.tsx',
    'src/components/MultiSizeModal.tsx',
    'src/components/MediaYoinkerModal.tsx',
    'src/components/AnnotationEditor.tsx',
    'src/components/OcrDrawer.tsx',
    'src/components/ImagePreviewModal.tsx',
    'src/components/OptionsDrawer.tsx',
    'src/components/SaveDestinationControl.tsx',
    'src/components/HistoryDrawer.tsx',
  ];

  const FORBIDDEN_RULES: Array<{ name: string; regex: RegExp }> = [
    {
      name: 'hardcoded Tailwind color palettes',
      regex: /\b(?:bg|text|border|ring|fill|stroke|accent)-(?:zinc|slate|gray|neutral|stone|blue|indigo|purple|violet|emerald|green|amber|yellow|orange|rose|red|sky|cyan|teal|pink|fuchsia|lime)-\d{2,3}\b/,
    },
    { name: 'hardcoded hex backgrounds', regex: /bg-\[#[0-9a-fA-F]{3,8}\]/ },
    { name: 'gradients', regex: /\bbg-gradient-to-|\bfrom-[a-z]+-\d|\bvia-[a-z]+-\d|\bto-[a-z]+-\d/ },
    { name: 'drop shadows', regex: /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|\[)/ },
    { name: 'pulsing animations', regex: /\banimate-pulse\b/ },
    { name: 'emoji icons', regex: /[📸✨✂️🔒✏️🔍📄🎉🚀🔥💡★]/u },
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

  for (const relPath of TARGET_FILES) {
    it(`${relPath} conforms strictly to DESIGN.md tokens, typography, spacing, and Never rules`, () => {
      const content = fs.readFileSync(path.resolve(relPath), 'utf8');
      for (const rule of FORBIDDEN_RULES) {
        assert.equal(
          rule.regex.test(content),
          false,
          `${relPath} violates DESIGN.md (${rule.name}): matched ${content.match(rule.regex)?.[0]}`
        );
      }
    });
  }

  it('AnnotationEditor uses edge-docked 44px top toolbar and 240px left style panel with no floating dock', () => {
    const content = fs.readFileSync(path.resolve('src/components/AnnotationEditor.tsx'), 'utf8');
    assert.match(content, /h-\[44px\]/, 'Editor must have 44px edge-docked top toolbar');
    assert.match(content, /w-\[240px\]/, 'Editor must have 240px left style panel on desktop');
    assert.equal(
      /Floating Bottom Toolbar Dock|-translate-x-1\/2/.test(content),
      false,
      'Editor must never float toolbars on top of the screenshot'
    );
  });

  it('MediaYoinkerModal prints dimensions plainly below previews rather than floating pills over media', () => {
    const content = fs.readFileSync(path.resolve('src/components/MediaYoinkerModal.tsx'), 'utf8');
    assert.equal(
      /absolute top-2 left-2|absolute bottom-2 right-2/.test(content),
      false,
      'MediaYoinkerModal must not float badges or dimensions on top of media previews'
    );
  });
});
