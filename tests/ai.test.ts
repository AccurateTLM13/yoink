import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hasOnDeviceAi, generateSmartTitle, extractOcrText } from '../src/utils/ai';
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
