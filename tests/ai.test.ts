import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  hasOnDeviceAi,
  generateSmartTitle,
  extractOcrText,
  resetNativeTextDetectorCache,
} from '../src/utils/ai';
import { updateStoredHistoryItem, addHistoryItem, clearStoredHistory } from '../src/utils/storage';
import { HistoryItem } from '../src/types';

// In Node test runner, ensure localStorage mock is available
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  };
}

describe('OCR Text Extraction (P2-9) & Local AI', () => {
  it('hasOnDeviceAi detects environment capability safely without throwing', () => {
    const supported = hasOnDeviceAi();
    assert.strictEqual(typeof supported, 'boolean');
  });

  it('generateSmartTitle extracts domain heuristic when on-device AI is absent', async () => {
    const res = await generateSmartTitle(
      'Article about design systems and web architecture',
      'https://developer.mozilla.org/en-US/docs/Web/API'
    );
    assert.ok(res.title.includes('developer.mozilla.org'));
    assert.ok(res.tags.length > 0);
  });

  it('extractOcrText returns graceful fallback result when Shape Detection is unavailable', async () => {
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const res = await extractOcrText(fakeDataUrl);
    assert.ok(res.text.length > 0);
    assert.strictEqual(res.engine, 'fallback');
    assert.strictEqual(typeof res.confidence, 'number');
  });

  it('extractOcrText does not emit console.warn, does not double-call detect(), and caches unavailability on NotSupportedError', async () => {
    resetNativeTextDetectorCache();
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let detectCalls = 0;
    const warnings: any[][] = [];

    const origWindow = (globalThis as any).window;
    const origImage = (globalThis as any).Image;
    const origCreateImageBitmap = (globalThis as any).createImageBitmap;
    const origWarn = console.warn;

    try {
      console.warn = (...args: any[]) => {
        warnings.push(args);
      };

      class MockImage {
        src = '';
        naturalWidth = 100;
        naturalHeight = 100;
        width = 100;
        height = 100;
        async decode() {}
      }

      class MockTextDetector {
        async detect() {
          detectCalls++;
          const err = new Error("Failed to execute 'detect' on 'TextDetector': Text detection service unavailable.");
          err.name = 'NotSupportedError';
          throw err;
        }
      }

      (globalThis as any).Image = MockImage;
      (globalThis as any).createImageBitmap = async () => ({ close() {} });
      (globalThis as any).window = {
        TextDetector: MockTextDetector,
      };

      // First OCR scan
      const res1 = await extractOcrText(fakeDataUrl);
      assert.strictEqual(res1.engine, 'fallback');
      assert.strictEqual(detectCalls, 1, 'Should only call detector.detect once, not retry with img on NotSupportedError');
      assert.strictEqual(warnings.length, 0, 'Should not call console.warn (which triggers Chrome extension errors)');

      // Second OCR scan should skip TextDetector entirely because unavailability is cached
      const res2 = await extractOcrText(fakeDataUrl);
      assert.strictEqual(res2.engine, 'fallback');
      assert.strictEqual(detectCalls, 1, 'Should cache TextDetector unavailability and not call detect() again');
    } finally {
      resetNativeTextDetectorCache();
      console.warn = origWarn;
      (globalThis as any).window = origWindow;
      (globalThis as any).Image = origImage;
      (globalThis as any).createImageBitmap = origCreateImageBitmap;
    }
  });

  it('extractOcrText skips native TextDetector when image dimensions exceed OS OCR limits (>4096px)', async () => {
    resetNativeTextDetectorCache();
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let detectCalls = 0;

    const origWindow = (globalThis as any).window;
    const origImage = (globalThis as any).Image;

    try {
      class MockTallImage {
        src = '';
        naturalWidth = 1280;
        naturalHeight = 8500;
        width = 1280;
        height = 8500;
        async decode() {}
      }

      class MockTextDetector {
        async detect() {
          detectCalls++;
          return [{ rawValue: 'should not be called' }];
        }
      }

      (globalThis as any).Image = MockTallImage;
      (globalThis as any).window = {
        TextDetector: MockTextDetector,
      };

      const res = await extractOcrText(fakeDataUrl);
      assert.strictEqual(res.engine, 'fallback');
      assert.strictEqual(detectCalls, 0, 'Should skip TextDetector when image exceeds 4096px max dimension');
    } finally {
      resetNativeTextDetectorCache();
      (globalThis as any).window = origWindow;
      (globalThis as any).Image = origImage;
    }
  });

  it('updateStoredHistoryItem updates ocrText on existing history record', async () => {
    await clearStoredHistory();

    const item: HistoryItem = {
      id: `test_ocr_${Date.now()}`,
      title: 'Invoice Capture',
      url: 'https://example.com/invoice',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      timestamp: Date.now(),
      width: 800,
      height: 600,
      mode: 'visible',
      format: 'png',
    };

    await addHistoryItem(item);

    const updatedList = await updateStoredHistoryItem(item.id, {
      ocrText: 'INVOICE #1024 TOTAL: $250.00 DUE: 2026-10-15',
    });

    const retrieved = updatedList.find((i) => i.id === item.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.ocrText, 'INVOICE #1024 TOTAL: $250.00 DUE: 2026-10-15');
  });
});
