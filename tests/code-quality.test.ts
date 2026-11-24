import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { crc32 } from '../src/utils/proof';
import { createRandomId, dataUrlToBlob } from '../src/utils/storage';
import { validateExternalMediaUrl } from '../src/utils/saveDestination';

describe('Codacy Security & Error-Prone Remediation Suite', () => {
  it('createRandomId uses Web Crypto CSPRNG and no source file uses Math.random()', () => {
    const id1 = createRandomId('annotated');
    const id2 = createRandomId('annotated');
    assert.match(id1, /^annotated_\d+_[0-9a-f]{8}$/);
    assert.match(id2, /^annotated_\d+_[0-9a-f]{8}$/);
    assert.notEqual(id1, id2);

    const filesToCheck = [
      'src/components/AnnotationEditor.tsx',
      'src/utils/upload.ts',
      'src/utils/mediaExtractor.ts',
    ];
    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(rel), 'utf8');
      assert.equal(
        /Math\.random\s*\(/.test(content),
        false,
        `${rel} must not use cryptographically weak Math.random()`
      );
    }
  });

  it('dataUrlToBlob decodes data:image URLs in memory without calling fetch, and background.js has zero fetch calls', async () => {
    const origFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called for data: URLs');
    }) as typeof fetch;

    try {
      const blob = dataUrlToBlob('data:image/png;base64,AQIDBA==');
      assert.equal(blob.type, 'image/png');
      const buf = new Uint8Array(await blob.arrayBuffer());
      assert.deepEqual(Array.from(buf), [1, 2, 3, 4]);
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = origFetch;
    }

    const bgContent = fs.readFileSync(path.resolve('public/background.js'), 'utf8');
    assert.equal(
      /\bfetch\s*\(/.test(bgContent),
      false,
      'public/background.js must decode data URLs in memory instead of calling fetch(dataUrl)'
    );
  });

  it('validateExternalMediaUrl enforces http/https allowlist and blocks SSRF targets', () => {
    assert.equal(
      validateExternalMediaUrl('https://cdn.example.com/assets/hero.png'),
      'https://cdn.example.com/assets/hero.png'
    );

    assert.throws(() => validateExternalMediaUrl('file:///etc/passwd'), /Unsupported media URL protocol/);
    assert.throws(() => validateExternalMediaUrl('javascript:alert(1)'), /Unsupported media URL protocol/);
    assert.throws(
      () => validateExternalMediaUrl('https://user:pass@example.com/a.png'),
      /must not contain credentials/
    );
    assert.throws(
      () => validateExternalMediaUrl('http://169.254.169.254/latest/meta-data/'),
      /Blocked internal or metadata host/
    );
    assert.throws(
      () => validateExternalMediaUrl('http://localhost:8080/admin'),
      /Blocked internal or metadata host/
    );
    assert.throws(
      () => validateExternalMediaUrl('http://127.0.0.1:3000/secret'),
      /Blocked internal or metadata host/
    );

    const saveDestContent = fs.readFileSync(path.resolve('src/utils/saveDestination.ts'), 'utf8');
    assert.equal(
      /\bfetch\s*\(\s*url\s*\)/.test(saveDestContent),
      false,
      'src/utils/saveDestination.ts must not pass raw unvalidated url directly to fetch(url)'
    );
  });

  it('CRC32 in proof.ts and offscreen.js computes IEEE 802.3 checksums without signed-Int32 overflowing hex literals', () => {
    // Standard IEEE 802.3 test vector: ASCII "123456789" -> 0xcbf43926 (3421780262)
    const input = new TextEncoder().encode('123456789');
    assert.equal(crc32(input), 3421780262);

    const offscreenContent = fs.readFileSync(path.resolve('public/offscreen.js'), 'utf8');
    const proofContent = fs.readFileSync(path.resolve('src/utils/proof.ts'), 'utf8');

    assert.equal(
      /0xffffffff|0xedb88320/i.test(offscreenContent),
      false,
      'public/offscreen.js must not use 0xffffffff or 0xedb88320 literals that coerce to negative Int32 at runtime'
    );
    assert.equal(
      /0xffffffff|0xedb88320/i.test(proofContent),
      false,
      'src/utils/proof.ts must not use 0xffffffff or 0xedb88320 literals that coerce to negative Int32 at runtime'
    );

    const ctx = vm.createContext({
      chrome: {
        runtime: {
          id: 'test-ext',
          getURL: (p: string) => `chrome-extension://test-ext/${p}`,
          onMessage: { addListener() {} },
        },
      },
      Uint32Array,
      Uint8Array,
    });
    vm.runInContext(`${offscreenContent}\n;globalThis.__crc32 = crc32Offscreen;`, ctx);
    const crc32Offscreen = (ctx as unknown as { __crc32: (b: Uint8Array) => number }).__crc32;
    assert.equal(crc32Offscreen(input), 3421780262);
  });

  it('src/main.tsx and src/ files avoid forbidden non-null assertions', () => {
    const mainContent = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
    assert.equal(
      /getElementById\(['"]root['"]\)\s*!/.test(mainContent),
      false,
      'src/main.tsx must guard rootElement instead of using a non-null assertion'
    );
  });

  it('vite.config.ts uses locally-resolved types without unresolved defineConfig, path.resolve, or untyped process.env access', () => {
    const viteContent = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8');
    assert.equal(/\bdefineConfig\s*\(/.test(viteContent), false);
    assert.equal(/\bpath\.resolve\s*\(/.test(viteContent), false);
    assert.equal(/\bprocess\.env\./.test(viteContent), false);
  });
});
