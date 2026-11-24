import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SETTINGS_TABS,
  resolveInitialSettingsTab,
  getNextSettingsTab,
} from '../src/utils/studioFormat';

describe('Engine Settings tabbed navigation helpers', () => {
  it('defines four logical Engine Settings tabs in order', () => {
    assert.deepEqual(
      SETTINGS_TABS.map((t) => t.id),
      ['capture', 'files', 'proof', 'shortcuts']
    );
  });

  it('defaults to capture tab and routes directly to files tab when folder picker is highlighted', () => {
    assert.equal(resolveInitialSettingsTab(false), 'capture');
    assert.equal(resolveInitialSettingsTab(undefined), 'capture');
    assert.equal(resolveInitialSettingsTab(true), 'files');
  });

  it('navigates tabs with ArrowRight, ArrowLeft, Home, and End wrapping cleanly', () => {
    assert.equal(getNextSettingsTab('capture', 'ArrowRight'), 'files');
    assert.equal(getNextSettingsTab('shortcuts', 'ArrowRight'), 'capture');
    assert.equal(getNextSettingsTab('capture', 'ArrowLeft'), 'shortcuts');
    assert.equal(getNextSettingsTab('proof', 'ArrowLeft'), 'files');
    assert.equal(getNextSettingsTab('proof', 'Home'), 'capture');
    assert.equal(getNextSettingsTab('capture', 'End'), 'shortcuts');
    assert.equal(getNextSettingsTab('files', 'Enter'), null);
  });
});

describe('OptionsDrawer tabbed UI structure and accessibility', () => {
  it('renders accessible tablist, tab buttons, and tabpanel in OptionsDrawer.tsx', () => {
    const content = fs.readFileSync(path.resolve('src/components/OptionsDrawer.tsx'), 'utf8');
    assert.match(content, /role="tablist"/, 'OptionsDrawer must render an ARIA tablist');
    assert.match(content, /role="tab"/, 'OptionsDrawer must render ARIA tab buttons');
    assert.match(content, /role="tabpanel"/, 'OptionsDrawer must render an ARIA tabpanel');
    assert.match(content, /resolveInitialSettingsTab/, 'OptionsDrawer must route highlightFolderPicker to files tab');
    assert.match(content, /getNextSettingsTab/, 'OptionsDrawer must support keyboard arrow navigation across tabs');
  });
});

