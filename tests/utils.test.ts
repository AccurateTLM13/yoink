import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  getStoredSettings,
  saveStoredSettings,
  getStoredHistory,
  addHistoryItem,
  deleteStoredHistoryItem,
  clearStoredHistory,
  createThumbnail,
  saveFullResolutionImage,
  getFullResolutionImage,
} from '../src/utils/storage';
import { formatFilename, isChromeExtension } from '../src/utils/capture';
import { HistoryItem, CaptureSettings } from '../src/types';

// Mock localStorage for Node test environment
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

// Attach mock localStorage to globalThis
const mockStorage = new LocalStorageMock();
(globalThis as any).localStorage = mockStorage;

describe('Capture Utilities - formatFilename', () => {
  test('formats filename with standard tokens', () => {
    const template = '{title}_{date}_{type}';
    const result = formatFilename(
      template,
      'My Dashboard Page',
      'https://app.yoink.com/dashboard',
      'full',
      'png'
    );
    assert.match(result, /^My_Dashboard_Page_\d{4}-\d{2}-\d{2}_full\.png$/);
  });

  test('formats filename with {domain} and {time} tokens', () => {
    const template = '{domain}_{type}_{time}';
    const result = formatFilename(
      template,
      'Test Title',
      'https://github.com/google/project',
      'selection',
      'jpeg'
    );
    assert.match(result, /^github_com_selection_\d{6}\.jpeg$/);
  });

  test('handles invalid or empty URLs gracefully', () => {
    const template = '{domain}_{title}';
    const result = formatFilename(template, 'Snapshot', 'not-a-valid-url', 'visible', 'webp');
    assert.match(result, /^page_Snapshot\.webp$/);
  });

  test('ensures correct extension format is appended without duplicate extensions', () => {
    const template = 'capture_{title}.png';
    const result = formatFilename(template, 'Image', 'https://example.com', 'visible', 'png');
    assert.equal(result, 'capture_Image.png');
  });

  test('sanitizes unsafe characters from filename title', () => {
    const template = '{title}';
    const result = formatFilename(
      template,
      'Dangerous: <File> / Path * "?',
      'https://example.com',
      'visible',
      'png'
    );
    assert.equal(result.includes('<'), false);
    assert.equal(result.includes('>'), false);
    assert.equal(result.includes(':'), false);
    assert.equal(result.includes('?'), false);
    assert.equal(result.includes('*'), false);
    assert.equal(result, 'Dangerous_File_Path.png');
  });

  test('falls back to capture if title consists solely of symbols or spaces', () => {
    const template = '{title}';
    const result = formatFilename(template, '   ***???   ', 'https://example.com', 'visible', 'png');
    assert.equal(result, 'capture.png');
  });
});

describe('Environment Detection - isChromeExtension', () => {
  test('returns false in non-extension (standard Node / mock) environment', () => {
    assert.equal(isChromeExtension(), false);
  });
});

describe('Storage Utilities', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test('getStoredSettings returns DEFAULT_SETTINGS when storage is empty', async () => {
    const settings = await getStoredSettings();
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.equal(settings.format, 'png');
    assert.equal(settings.quality, 0.92);
  });

  test('saveStoredSettings persists settings and getStoredSettings retrieves them', async () => {
    const custom: CaptureSettings = {
      ...DEFAULT_SETTINGS,
      format: 'webp',
      quality: 0.85,
      scrollDelayMs: 900,
      autoDownload: false,
    };
    await saveStoredSettings(custom);
    const retrieved = await getStoredSettings();
    assert.equal(retrieved.format, 'webp');
    assert.equal(retrieved.quality, 0.85);
    assert.equal(retrieved.scrollDelayMs, 900);
    assert.equal(retrieved.autoDownload, false);
  });

  test('history operations: add, retrieve, delete, and clear', async () => {
    const initial = await getStoredHistory();
    assert.deepEqual(initial, []);

    const item1: HistoryItem = {
      id: 'item_1',
      title: 'First Capture',
      url: 'https://example.com/1',
      dataUrl: 'data:image/png;base64,sample1',
      timestamp: 1000,
      width: 1920,
      height: 1080,
      mode: 'full',
      format: 'png',
    };

    const item2: HistoryItem = {
      id: 'item_2',
      title: 'Second Capture',
      url: 'https://example.com/2',
      dataUrl: 'data:image/png;base64,sample2',
      timestamp: 2000,
      width: 800,
      height: 600,
      mode: 'selection',
      format: 'png',
    };

    // Add item 1
    let history = await addHistoryItem(item1);
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'item_1');

    // Add item 2 (should be prepended)
    history = await addHistoryItem(item2);
    assert.equal(history.length, 2);
    assert.equal(history[0].id, 'item_2');
    assert.equal(history[1].id, 'item_1');

    // Delete item 1
    history = await deleteStoredHistoryItem('item_1');
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'item_2');

    // Clear history
    await clearStoredHistory();
    const cleared = await getStoredHistory();
    assert.deepEqual(cleared, []);
  });

  test('separated storage: saves full-resolution image and retrieves it on demand', async () => {
    const fullData = 'data:image/png;base64,large_uncompressed_raw_image_data_here';
    const item: HistoryItem = {
      id: 'sep_1',
      title: 'Full Res Capture',
      url: 'https://example.com/hd',
      dataUrl: fullData,
      timestamp: Date.now(),
      width: 3840,
      height: 2160,
      mode: 'full',
      format: 'png',
    };

    await addHistoryItem(item);

    // Retrieve from separated storage
    const retrievedFull = await getFullResolutionImage('sep_1');
    assert.equal(retrievedFull, fullData);

    // Check that thumbnail or metadata was created
    const history = await getStoredHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'sep_1');
    assert.ok(history[0].thumbnailUrl !== undefined);

    // Clean up
    await deleteStoredHistoryItem('sep_1');
    const afterDeleteFull = await getFullResolutionImage('sep_1');
    assert.equal(afterDeleteFull, null);
  });

  test('createThumbnail returns string gracefully', async () => {
    const raw = 'data:image/png;base64,sample_string';
    const thumb = await createThumbnail(raw, 200);
    assert.ok(typeof thumb === 'string');
    assert.ok(thumb.length > 0);
  });
});
