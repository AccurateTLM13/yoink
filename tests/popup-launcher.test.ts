import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  POPUP_CAPTURE_DELAYS,
  formatDelayLabel,
  formatPopupSaveDestination,
  formatPopupProofStatus,
} from '../src/utils/studioFormat';

describe('Popup command launcher formatting helpers', () => {
  it('formats capture delay options cleanly on the supported schedule', () => {
    assert.deepEqual([...POPUP_CAPTURE_DELAYS], [0, 3, 5, 10]);
    assert.equal(formatDelayLabel(0), 'Off');
    assert.equal(formatDelayLabel(3), '3s');
    assert.equal(formatDelayLabel(5), '5s');
    assert.equal(formatDelayLabel(10), '10s');
  });

  it('formats save destination status for downloads, ask, ready folder, and folder warnings', () => {
    assert.deepEqual(formatPopupSaveDestination('downloads', '', 'unset'), {
      label: 'Downloads',
      needsAttention: false,
    });
    assert.deepEqual(formatPopupSaveDestination('ask', '', 'unset'), {
      label: 'Ask each save',
      needsAttention: false,
    });
    assert.deepEqual(formatPopupSaveDestination('folder', 'T7_SSD', 'ready'), {
      label: 'T7_SSD',
      needsAttention: false,
    });
    assert.deepEqual(formatPopupSaveDestination('folder', 'T7_SSD', 'needs_permission'), {
      label: 'T7_SSD · Grant access',
      needsAttention: true,
    });
    assert.deepEqual(formatPopupSaveDestination('folder', 'T7_SSD', 'not_found'), {
      label: 'T7_SSD · Offline',
      needsAttention: true,
    });
    assert.deepEqual(formatPopupSaveDestination('folder', '', 'unset'), {
      label: 'Select folder',
      needsAttention: true,
    });
  });

  it('formats Proof status accurately for enabled and disabled states', () => {
    assert.deepEqual(formatPopupProofStatus(true, '#8F3A-9C21-B40E'), {
      active: true,
      label: 'Proof on',
      detail: '#8F3A-9C21-B40E',
    });
    assert.deepEqual(formatPopupProofStatus(false, '#8F3A-9C21-B40E'), {
      active: false,
      label: 'Proof off',
      detail: 'Signing paused',
    });
  });
});

describe('Popup QuickMenu DESIGN.md conformance', () => {
  it('obeys DESIGN.md tokens, layout dimensions, typography scale, and Never rules in QuickMenu.tsx', () => {
    const content = fs.readFileSync(path.resolve('src/components/QuickMenu.tsx'), 'utf8');

    // Structural specs from DESIGN.md Layout & Spacing
    assert.match(content, /h-\[44px\]/, 'Popup header must be 44px high');
    assert.match(content, /h-\[40px\]/, 'Popup bottom bar must be 40px high');
    assert.match(content, /\bh-9\b/, 'Popup command rows must use 36px height (h-9)');
    assert.match(content, /strokeWidth=\{1\.5\}/, 'Lucide icons must use 1.5px stroke');
    assert.match(content, /YoinkMark/, 'Popup header must use token-adaptive YoinkMark');

    // Forbidden patterns from DESIGN.md
    const forbidden: Array<{ name: string; regex: RegExp }> = [
      {
        name: 'hardcoded Tailwind color palettes',
        regex: /\b(?:bg|text|border|ring|fill|stroke)-(?:zinc|slate|gray|neutral|stone|blue|indigo|purple|violet|emerald|green|amber|yellow|orange|rose|red|sky|cyan|teal|pink|fuchsia|lime)-\d{2,3}\b/,
      },
      { name: 'hardcoded hex backgrounds', regex: /bg-\[#[0-9a-fA-F]{3,8}\]/ },
      { name: 'gradients', regex: /\bbg-gradient-to-|\bfrom-[a-z]+-\d|\bto-[a-z]+-\d/ },
      { name: 'drop shadows', regex: /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|\[)/ },
      { name: 'pulsing animations', regex: /\banimate-pulse\b/ },
      { name: 'black PNG wordmark (invisible in dark mode)', regex: /yoink-text\.png|yoink-symbol\.png/ },
      { name: 'emoji icons', regex: /[📸✨✂️🔒✏️🔍📄🎉🚀🔥💡]/u },
      { name: 'uppercase CSS label transforms', regex: /\buppercase\b/ },
      { name: 'wide uppercase tracking', regex: /\btracking-(?:wider|widest)\b/ },
      { name: '700-900 shouting weights', regex: /\bfont-(?:bold|extrabold|black)\b/ },
      { name: 'non-DESIGN.md Tailwind font-size utilities', regex: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/ },
      {
        name: 'arbitrary font sizes outside DESIGN.md scale (11,12,13,14,18,24)',
        regex: /\btext-\[(?!(?:11|12|13|14|18|24)px\])\d+(?:\.\d+)?px\]/,
      },
      {
        name: 'off-grid 4px spacing values',
        regex: /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-x|space-y)-(?:1\.5|2\.5|3\.5|4\.5|5\.5|7|9|10|11)\b/,
      },
      { name: 'hype pills', regex: />(?:ULTRA HD|Ultra HD|YOINK|WINDOW|PRO|v1\.2)</ },
    ];

    for (const rule of forbidden) {
      assert.equal(
        rule.regex.test(content),
        false,
        `QuickMenu.tsx violates DESIGN.md (${rule.name}): matched ${content.match(rule.regex)?.[0]}`
      );
    }
  });
});
