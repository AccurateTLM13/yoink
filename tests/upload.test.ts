import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromFilename, formatForMime, MAX_UPLOAD_BYTES } from '../src/utils/upload';

describe('Upload and Edit (P1-7) - File Sanitization & Format Mapping', () => {
  test('titleFromFilename strips file extension and trims safely', () => {
    assert.equal(titleFromFilename('dashboard-preview.png'), 'dashboard-preview');
    assert.equal(titleFromFilename('long_report_table.final.jpeg'), 'long_report_table.final');
    assert.equal(titleFromFilename(''), 'Uploaded image');
  });

  test('formatForMime identifies supported standard web formats', () => {
    assert.equal(formatForMime('image/png'), 'png');
    assert.equal(formatForMime('image/jpeg'), 'jpeg');
    assert.equal(formatForMime('image/webp'), 'webp');
    // Exotic/vector formats return null to trigger PNG re-encoding
    assert.equal(formatForMime('image/svg+xml'), null);
    assert.equal(formatForMime('image/gif'), null);
  });

  test('MAX_UPLOAD_BYTES enforces 25MB safety boundary', () => {
    assert.equal(MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
  });
});
