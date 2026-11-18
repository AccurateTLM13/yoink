import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IPTC_SCREEN_CAPTURE_URI,
  generateProofIdentity,
  computeMaskedPixelHash,
  computeVisualBitstreamHash,
  stripYoinkAndColorChunks,
  createSignedProofManifest,
  verifyProofManifestSignature,
  embedLsbWatermark,
  extractLsbWatermark,
  injectContainerMetadata,
  extractContainerMetadata,
  verifyImageBufferAndPixels,
  extractProofManifestFromDataUrl,
  bytesToDataUrl,
} from '../src/utils/proof';

function createSyntheticRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (i * 17) & 0xff;
    rgba[i + 1] = (i * 31 + 80) & 0xff;
    rgba[i + 2] = (i * 13 + 140) & 0xff;
    rgba[i + 3] = 255;
  }
  return rgba;
}

function createMinimalPngBytes(): Uint8Array {
  // Minimal valid PNG header + IHDR (13 bytes) + IDAT + IEND
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature (8)
    0x00, 0x00, 0x00, 0x0d, // IHDR length = 13 (4)
    0x49, 0x48, 0x44, 0x52, // "IHDR" (4)
    0x00, 0x00, 0x00, 0x64, // width = 100
    0x00, 0x00, 0x00, 0x64, // height = 100
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, etc. (13)
    0x70, 0xe2, 0x95, 0x54, // IHDR CRC (4) -> total 33 bytes
    0x00, 0x00, 0x00, 0x00, // IEND length = 0
    0x49, 0x45, 0x4e, 0x44, // "IEND"
    0xae, 0x42, 0x60, 0x82, // IEND CRC
  ]);
}

describe('Yoink Proof™ — Cryptographic Provenance & Steganography Engine', () => {
  test('generates ECDSA P-256 identity with formatted 12-char key fingerprint', async () => {
    const id = await generateProofIdentity();
    assert.match(id.keyFingerprint, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.ok(id.pubRawB64Url.length > 60);
    assert.ok(id.privateKeyJwk.d);
  });

  test('masked pixel SHA-256 hash remains identical before and after LSB watermark embedding', async () => {
    const id = await generateProofIdentity();
    const width = 80;
    const height = 80;
    const rgba = createSyntheticRgba(width, height);

    const hashBefore = await computeMaskedPixelHash(rgba, width, height);
    const manifest = await createSignedProofManifest({
      rgba,
      width,
      height,
      url: 'https://app.yoink.com/billing',
      title: 'Billing Receipt',
      author: '@jp',
      identity: id,
    });

    const embedded = embedLsbWatermark(rgba, manifest);
    assert.equal(embedded, true);

    const hashAfter = await computeMaskedPixelHash(rgba, width, height);
    assert.equal(hashAfter, hashBefore, 'Masked pixel hash must be invariant to LSB watermark');
    assert.equal(manifest.ph, hashAfter);
  });

  test('signs, embeds, and extracts LSB pixel watermark with valid ECDSA P-256 signature', async () => {
    const id = await generateProofIdentity();
    const width = 100;
    const height = 60;
    const rgba = createSyntheticRgba(width, height);

    const manifest = await createSignedProofManifest({
      rgba,
      width,
      height,
      url: 'https://github.com/yoink/proof',
      title: 'Pull Request #42',
      author: '@yoink_dev',
      identity: id,
    });

    embedLsbWatermark(rgba, manifest);

    const extracted = extractLsbWatermark(rgba);
    assert.ok(extracted, 'Watermark should be extracted from pixel LSBs');
    assert.equal(extracted.kid, id.keyFingerprint);
    assert.equal(extracted.u, 'https://github.com');
    assert.equal(extracted.a, '@yoink_dev');
    assert.equal(extracted.src, IPTC_SCREEN_CAPTURE_URI);

    const sigValid = await verifyProofManifestSignature(extracted);
    assert.equal(sigValid, true);
  });

  test('injects and extracts IPTC screenCapture & XMP provenance chunks in PNG, JPEG, and WebP containers', async () => {
    const id = await generateProofIdentity();
    const rgba = createSyntheticRgba(64, 64);
    const manifest = await createSignedProofManifest({
      rgba,
      width: 64,
      height: 64,
      url: 'https://example.com/news',
      title: 'News Capture',
      author: '@reporter',
      identity: id,
    });

    // 1. PNG
    const rawPng = createMinimalPngBytes();
    const taggedPng = injectContainerMetadata(rawPng, 'image/png', manifest);
    assert.ok(taggedPng.length > rawPng.length);
    const extractedPng = extractContainerMetadata(taggedPng);
    assert.equal(extractedPng.hasIptcScreenCapture, true);
    assert.ok(extractedPng.manifest);
    assert.equal(extractedPng.manifest.kid, id.keyFingerprint);

    // 2. JPEG
    const rawJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const taggedJpeg = injectContainerMetadata(rawJpeg, 'image/jpeg', manifest);
    const extractedJpeg = extractContainerMetadata(taggedJpeg);
    assert.equal(extractedJpeg.hasIptcScreenCapture, true);
    assert.ok(extractedJpeg.manifest);
    assert.equal(extractedJpeg.manifest.kid, id.keyFingerprint);

    // 3. WebP
    const rawWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x0c, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
      0x20, 0x00, 0x00, 0x00, 0x00,
    ]);
    const taggedWebp = injectContainerMetadata(rawWebp, 'image/webp', manifest);
    const extractedWebp = extractContainerMetadata(taggedWebp);
    assert.equal(extractedWebp.hasIptcScreenCapture, true);
    assert.ok(extractedWebp.manifest);
    assert.equal(extractedWebp.manifest.kid, id.keyFingerprint);
  });

  test('verifies authentic capture and survives complete metadata stripping via LSB pixel watermark', async () => {
    const id = await generateProofIdentity();
    const width = 90;
    const height = 70;
    const rgba = createSyntheticRgba(width, height);

    const manifest = await createSignedProofManifest({
      rgba,
      width,
      height,
      url: 'https://bank.example.com/receipt',
      title: 'Wire Confirmation',
      author: '@verified_owner',
      identity: id,
    });
    embedLsbWatermark(rgba, manifest);

    // Verify with stripped file bytes (simulating clipboard or platform stripping EXIF/PNG chunks)
    const strippedPng = createMinimalPngBytes();
    const res = await verifyImageBufferAndPixels({
      fileBytes: strippedPng,
      rgba,
      width,
      height,
      localIdentity: id,
    });

    assert.equal(res.verified, true);
    assert.equal(res.status, 'authentic');
    assert.equal(res.hasPixelWatermark, true);
    assert.equal(res.hasIptcScreenCapture, true);
    assert.equal(res.signatureValid, true);
    assert.equal(res.pixelsIntact, true);
    assert.equal(res.isOwnCapture, true);
  });

  test('strips PNG color chunks and verifies visual bitstream hash (bh) even under OS display color profile shifts', async () => {
    const id = await generateProofIdentity();
    const width = 64;
    const height = 64;
    const rgba = createSyntheticRgba(width, height);

    const rawPng = createMinimalPngBytes();
    const strippedPng = stripYoinkAndColorChunks(rawPng);
    const bh = await computeVisualBitstreamHash(strippedPng);

    const manifest = await createSignedProofManifest({
      rgba,
      width,
      height,
      url: 'https://studio.yoink.com',
      title: 'Color Profile Resilient Capture',
      author: '@jp',
      identity: id,
      bitstreamHash: bh,
    });
    assert.equal(manifest.bh, bh);

    const taggedPng = injectContainerMetadata(strippedPng, 'image/png', manifest);
    // Visual bitstream hash after metadata injection must match the pre-injection stripped hash
    const bhAfterTagging = await computeVisualBitstreamHash(taggedPng);
    assert.equal(bhAfterTagging, bh);

    // Simulate OS display ICC color profile shifting decoded canvas RGB values by +1
    const colorShiftedRgba = new Uint8ClampedArray(rgba);
    colorShiftedRgba[0] = (colorShiftedRgba[0] + 1) & 0xff;

    const verifyRes = await verifyImageBufferAndPixels({
      fileBytes: taggedPng,
      rgba: colorShiftedRgba,
      width,
      height,
      localIdentity: id,
    });

    assert.equal(verifyRes.verified, true);
    assert.equal(verifyRes.status, 'authentic');
    assert.equal(verifyRes.pixelsIntact, true);
    assert.equal(verifyRes.manifest?.a, '@jp');
  });

  test('detects single-pixel tampering and forged manifest fields', async () => {
    const id = await generateProofIdentity();
    const width = 80;
    const height = 80;
    const rgba = createSyntheticRgba(width, height);

    const manifest = await createSignedProofManifest({
      rgba,
      width,
      height,
      url: 'https://example.com',
      title: 'Original',
      author: '@alice',
      identity: id,
    });
    embedLsbWatermark(rgba, manifest);

    // Modify 1 pixel outside the carrier region (e.g. bottom-right pixel)
    const lastPixelIdx = (width * height - 1) * 4;
    rgba[lastPixelIdx] = (rgba[lastPixelIdx] + 50) & 0xff;

    const tamperRes = await verifyImageBufferAndPixels({
      rgba,
      width,
      height,
      localIdentity: id,
    });
    assert.equal(tamperRes.verified, false);
    assert.equal(tamperRes.status, 'tampered');
    assert.equal(tamperRes.signatureValid, true);
    assert.equal(tamperRes.pixelsIntact, false);

    // Forged author field in manifest should fail ECDSA signature verification
    const forgedManifest = { ...manifest, a: '@attacker' };
    const sigValid = await verifyProofManifestSignature(forgedManifest);
    assert.equal(sigValid, false);
  });

  test('omits paths and credentials from newly signed proof', async () => {
    const identity = await generateProofIdentity();
    const rgba = createSyntheticRgba(80, 80);
    const manifest = await createSignedProofManifest({
      rgba, width: 80, height: 80, identity,
      url: 'https://example.com/private/123?token=secret#fragment',
    });
    assert.equal(manifest.u, 'https://example.com');
    assert.equal(embedLsbWatermark(rgba, manifest), true);
    assert.equal(extractLsbWatermark(rgba)?.u, 'https://example.com');
  });

  test('preserves transparent pixels and verifies container-only proof', async () => {
    const identity = await generateProofIdentity();
    const rgba = createSyntheticRgba(80, 80);
    rgba[3] = 0;
    const before = new Uint8ClampedArray(rgba);
    const raw = createMinimalPngBytes();
    const bh = await computeVisualBitstreamHash(raw);
    const manifest = await createSignedProofManifest({ rgba, width: 80, height: 80, identity, bitstreamHash: bh, source: '' });
    assert.equal(embedLsbWatermark(rgba, manifest), false);
    assert.deepEqual(rgba, before);
    const tagged = injectContainerMetadata(raw, 'image/png', manifest);
    const result = await verifyImageBufferAndPixels({ fileBytes: tagged, rgba, width: 80, height: 80, localIdentity: identity });
    assert.equal(result.verified, true);
    assert.equal(result.hasPixelWatermark, false);
    assert.equal(result.hasIptcScreenCapture, false);

    const altered = new Uint8Array(tagged);
    altered[19] ^= 1;
    const alteredResult = await verifyImageBufferAndPixels({ fileBytes: altered, rgba, width: 80, height: 80, localIdentity: identity });
    assert.equal(alteredResult.verified, false);
  });

  test('does not imply an unknown signer has a verified identity', async () => {
    const signer = await generateProofIdentity();
    const verifier = await generateProofIdentity();
    const rgba = createSyntheticRgba(80, 80);
    const manifest = await createSignedProofManifest({ rgba, width: 80, height: 80, identity: signer, author: 'Claimed author' });
    embedLsbWatermark(rgba, manifest);
    const result = await verifyImageBufferAndPixels({ rgba, width: 80, height: 80, localIdentity: verifier });
    assert.equal(result.verified, true);
    assert.equal(result.isOwnCapture, false);
    assert.match(result.summary, /not independently verified/);
  });

  test('distinguishes edited/re-signed derivatives from original captures and records parent signature', async () => {
    const id = await generateProofIdentity();
    const origRgba = createSyntheticRgba(80, 80);
    const origManifest = await createSignedProofManifest({
      rgba: origRgba,
      width: 80,
      height: 80,
      url: 'https://bank.example/statement',
      title: 'Original Capture',
      identity: id,
    });
    embedLsbWatermark(origRgba, origManifest);

    const origVerify = await verifyImageBufferAndPixels({ rgba: origRgba, width: 80, height: 80, localIdentity: id });
    assert.equal(origVerify.verified, true);
    assert.equal(origVerify.captureKind, 'original');
    assert.equal(origVerify.isDerivative, false);

    // Produce redacted/edited derivative image
    const editedRgba = new Uint8ClampedArray(origRgba);
    editedRgba[80 * 40] = 0;
    editedRgba[80 * 40 + 1] = 0;
    editedRgba[80 * 40 + 2] = 0;

    const derivManifest = await createSignedProofManifest({
      rgba: editedRgba,
      width: 80,
      height: 80,
      url: 'https://bank.example/statement',
      title: 'Redacted Capture',
      source: '',
      kind: 'derivative',
      parent: {
        kid: origManifest.kid,
        sig: origManifest.sig,
        ph: origManifest.ph,
        ts: origManifest.ts,
        u: origManifest.u,
      },
      identity: id,
    });
    embedLsbWatermark(editedRgba, derivManifest);

    const derivVerify = await verifyImageBufferAndPixels({ rgba: editedRgba, width: 80, height: 80, localIdentity: id });
    assert.equal(derivVerify.verified, true);
    assert.equal(derivVerify.captureKind, 'derivative');
    assert.equal(derivVerify.isDerivative, true);
    assert.equal(derivVerify.manifest?.parent?.sig, origManifest.sig);
    assert.equal(derivVerify.manifest?.parent?.kid, origManifest.kid);
    assert.match(derivVerify.summary, /derivative|edited/i);

    // Tampering with kind or parent signature must invalidate ECDSA signature
    assert.equal(
      await verifyProofManifestSignature({ ...derivManifest, kind: 'original' }),
      false
    );
    assert.equal(
      await verifyProofManifestSignature({
        ...derivManifest,
        parent: { ...derivManifest.parent!, sig: 'forged' },
      }),
      false
    );
  });

  test('extractProofManifestFromDataUrl rejects forged manifests and identifies imported assets accurately', async () => {
    const id = await generateProofIdentity();
    const rgba = createSyntheticRgba(80, 80);
    const raw = createMinimalPngBytes();
    const bh = await computeVisualBitstreamHash(raw);
    const validImported = await createSignedProofManifest({
      rgba,
      width: 80,
      height: 80,
      identity: id,
      bitstreamHash: bh,
      source: '',
      kind: 'imported',
    });
    const taggedValid = injectContainerMetadata(raw, 'image/png', validImported);
    const extractedValid = await extractProofManifestFromDataUrl(bytesToDataUrl(taggedValid, 'image/png'));
    assert.ok(extractedValid);

    const verifyImported = await verifyImageBufferAndPixels({
      fileBytes: taggedValid,
      rgba,
      width: 80,
      height: 80,
      localIdentity: id,
    });
    assert.equal(verifyImported.verified, true);
    assert.equal(verifyImported.captureKind, 'imported');
    assert.equal(verifyImported.isDerivative, false);

    // Forged signature in container metadata must be rejected by extractProofManifestFromDataUrl
    const forgedManifest = { ...validImported, a: '@forged_author' };
    const taggedForged = injectContainerMetadata(raw, 'image/png', forgedManifest);
    const extractedForged = await extractProofManifestFromDataUrl(bytesToDataUrl(taggedForged, 'image/png'));
    assert.equal(extractedForged, null, 'Forged parent manifest must not be accepted for derivative lineage');
  });
});
