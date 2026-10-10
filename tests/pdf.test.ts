import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPdf,
  computePageSlices,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  PdfPage,
} from '../src/utils/pdf';

describe('PDF Export (P0-2) - Page Slicing & Document Generation', () => {
  test('computePageSlices splits tall capture across A4 pages', () => {
    // 1000px wide, 5000px tall
    const slices = computePageSlices(1000, 5000, A4_WIDTH_PT, A4_HEIGHT_PT);
    assert.ok(slices.length > 1);

    // Sum of slice heights must match total height
    const totalHeight = slices.reduce((acc, s) => acc + s.height, 0);
    assert.equal(totalHeight, 5000);

    // Consecutive slices must be contiguous
    let expectedY = 0;
    for (const slice of slices) {
      assert.equal(slice.y, expectedY);
      expectedY += slice.height;
    }
  });

  test('computePageSlices keeps short viewport on 1 page', () => {
    // 1440x900 viewport capture
    const slices = computePageSlices(1440, 900);
    assert.equal(slices.length, 1);
    assert.equal(slices[0].y, 0);
    assert.equal(slices[0].height, 900);
  });

  test('buildPdf produces valid PDF-1.4 binary structure', () => {
    // Create mock JPEG bytes (dummy byte array)
    const mockJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const pages: PdfPage[] = [
      {
        jpeg: mockJpeg,
        pixelWidth: 800,
        pixelHeight: 600,
        pageWidth: A4_WIDTH_PT,
        pageHeight: A4_HEIGHT_PT,
      },
    ];

    const bytes = buildPdf(pages, 'Test Export');
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 100);

    const text = new TextDecoder().decode(bytes);
    // Header
    assert.ok(text.startsWith('%PDF-1.4'));
    // Catalog & Pages
    assert.ok(text.includes('/Type /Catalog'));
    assert.ok(text.includes('/Type /Pages'));
    assert.ok(text.includes('/Count 1'));
    // Image dictionary
    assert.ok(text.includes('/Subtype /Image'));
    assert.ok(text.includes('/Filter /DCTDecode'));
    // Cross-reference table & EOF
    assert.ok(text.includes('xref'));
    assert.ok(text.includes('trailer'));
    assert.ok(text.includes('%%EOF'));
  });

  test('buildPdf throws error on empty pages array', () => {
    assert.throws(() => buildPdf([]), /requires at least 1 page/);
  });
});
