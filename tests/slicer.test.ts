import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeImageSlices } from '../src/utils/slicer';

describe('Image Slicing Utilities (Anti-Squish & Multi-Part)', () => {
  test('computeImageSlices splits a 12000px tall page into 4000px slices', () => {
    const slices = computeImageSlices(1440, 12000, 4000);
    assert.equal(slices.length, 3);
    assert.deepEqual(slices, [
      { index: 0, y: 0, height: 4000 },
      { index: 1, y: 4000, height: 4000 },
      { index: 2, y: 8000, height: 4000 },
    ]);
  });

  test('computeImageSlices handles non-exact multiples properly', () => {
    // 9500px height with 4000px max -> [4000, 4000, 1500]
    const slices = computeImageSlices(1920, 9500, 4000);
    assert.equal(slices.length, 3);
    assert.equal(slices[0].y, 0);
    assert.equal(slices[0].height, 4000);
    assert.equal(slices[1].y, 4000);
    assert.equal(slices[1].height, 4000);
    assert.equal(slices[2].y, 8000);
    assert.equal(slices[2].height, 1500);

    const total = slices.reduce((acc, s) => acc + s.height, 0);
    assert.equal(total, 9500);
  });

  test('computeImageSlices returns single slice for image within maxSliceHeight', () => {
    const slices = computeImageSlices(1440, 2500, 4000);
    assert.equal(slices.length, 1);
    assert.deepEqual(slices[0], { index: 0, y: 0, height: 2500 });
  });

  test('computeImageSlices clamps minimum slice height safely to 500px', () => {
    // Even if user specifies 100px, it clamps to minimum 500px
    const slices = computeImageSlices(1000, 1200, 100);
    assert.equal(slices.length, 3);
    assert.equal(slices[0].height, 500);
    assert.equal(slices[1].height, 500);
    assert.equal(slices[2].height, 200);
  });

  test('computeImageSlices returns empty array on invalid dimensions', () => {
    assert.deepEqual(computeImageSlices(0, 1000), []);
    assert.deepEqual(computeImageSlices(1000, 0), []);
    assert.deepEqual(computeImageSlices(-500, 1000), []);
  });
});
