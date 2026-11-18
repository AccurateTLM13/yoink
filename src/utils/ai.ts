import Tesseract from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
  engine: 'shape-detection' | 'tesseract' | 'window-ai' | 'fallback';
  status?: 'success' | 'empty' | 'unavailable';
  message?: string;
}

const MAX_NATIVE_OCR_DIMENSION = 4096;
let nativeTextDetectorUnavailable = false;

/**
 * Reset cached native TextDetector availability state (used in tests)
 */
export function resetNativeTextDetectorCache(): void {
  nativeTextDetectorUnavailable = false;
}

/**
 * Detect if Chrome built-in On-Device AI (Prompt API / Gemini Nano) is supported
 */
export function hasOnDeviceAi(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!(
    w.ai?.languageModel ||
    w.ai?.createTextSession ||
    w.chrome?.aiOriginTrial?.languageModel
  );
}

/**
 * Execute on-device prompt using Chrome Prompt API (100% offline, 0 cost)
 */
export async function runOnDevicePrompt(prompt: string): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('Window environment required for on-device AI.');
  }

  const w = window as any;
  if (w.ai?.languageModel) {
    const session = await w.ai.languageModel.create();
    try {
      return await session.prompt(prompt);
    } finally {
      if (session?.destroy) session.destroy();
    }
  }

  if (w.ai?.createTextSession) {
    const session = await w.ai.createTextSession();
    try {
      return await session.prompt(prompt);
    } finally {
      if (session?.destroy) session.destroy();
    }
  }

  throw new Error('On-device AI is not enabled in this browser version.');
}

/**
 * Generate smart title & tags for a capture using on-device AI or local heuristics
 */
export async function generateSmartTitle(
  contextText: string,
  url?: string
): Promise<{ title: string; tags: string[] }> {
  if (hasOnDeviceAi()) {
    try {
      const prompt = `Given this web page context: "${contextText.slice(0, 500)}", generate a concise 3-to-6 word title and 3 single-word comma-separated tags. Format: TITLE: <title> | TAGS: <tag1>, <tag2>, <tag3>`;
      const res = await runOnDevicePrompt(prompt);
      const titleMatch = res.match(/TITLE:\s*([^|]+)/i);
      const tagsMatch = res.match(/TAGS:\s*(.+)/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Smart Capture';
      const tags = tagsMatch
        ? tagsMatch[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        : ['screenshot'];
      return { title, tags };
    } catch {}
  }

  // Fallback to domain and header heuristics
  let domain = 'Capture';
  if (url) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {}
  }

  return {
    title: `${domain} Snapshot`,
    tags: ['screenshot', domain.split('.')[0] || 'web'],
  };
}

/**
 * Extract text from capture image strictly on-device via Native Shape Detection API
 * or bundled offline Tesseract WASM (100% local, zero external network calls).
 */
export async function extractOcrText(dataUrl: string): Promise<OcrResult> {
  let detectorCompleted = false;

  // 1. Try Native Chrome TextDetector (Shape Detection API - 100% offline & free)
  if (
    !nativeTextDetectorUnavailable &&
    typeof window !== 'undefined' &&
    'TextDetector' in window
  ) {
    try {
      const img = new Image();
      img.src = dataUrl;
      if (typeof img.decode === 'function') {
        await img.decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image for OCR'));
        });
      }

      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;

      // OS native OCR backends (e.g., Windows.Media.Ocr) fail or disconnect the Mojo
      // service pipe when passed stitched captures exceeding 4096px.
      if (width <= MAX_NATIVE_OCR_DIMENSION && height <= MAX_NATIVE_OCR_DIMENSION) {
        const detector = new (window as any).TextDetector();

        let bitmap: ImageBitmap | null = null;
        if (typeof createImageBitmap === 'function') {
          try {
            bitmap = await createImageBitmap(img);
          } catch {
            bitmap = null;
          }
        }

        let detectedTexts: any[] | null = null;
        try {
          detectedTexts = await detector.detect(bitmap ?? img);
          detectorCompleted = true;
        } finally {
          if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close();
          }
        }

        if (detectedTexts && detectedTexts.length > 0) {
          const rawStrings: string[] = detectedTexts.map((item: any) => item.rawValue || '');
          const joined = rawStrings.filter(Boolean).join('\n');
          return {
            text: joined,
            confidence: 0.95,
            engine: 'shape-detection',
            status: 'success',
          };
        }
      }
    } catch (err: any) {
      if (
        err?.name === 'NotSupportedError' ||
        String(err?.message || '').includes('Text detection service unavailable')
      ) {
        nativeTextDetectorUnavailable = true;
      }
    }
  }

  // Resolve extension-local asset URLs when running inside a Chrome extension,
  // otherwise fall back to site-root relative paths (dev / tests).
  const resolveOcrUrl = (relativePath: string): string => {
    try {
      if (typeof chrome !== 'undefined' && (chrome as any)?.runtime?.getURL) {
        return (chrome as any).runtime.getURL(relativePath);
      }
    } catch {}
    return `/${relativePath.replace(/^\/+/, '')}`;
  };

  // 2. Default client-side OCR: Tesseract.js (pure WASM, works fully offline, no API key or chrome://flags needed)
  // Only attempt in a browser environment; Tesseract cannot run under Node.
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
    try {
      const worker = await Tesseract.createWorker('eng', undefined, {
        workerPath: resolveOcrUrl('ocr/worker.min.js'),
        corePath: resolveOcrUrl('ocr/tesseract-core-simd-lstm.wasm.js'),
        langPath: resolveOcrUrl('ocr/'),
        workerBlobURL: false,
        gzip: false,
      });
      try {
        const { data } = await worker.recognize(dataUrl);
        detectorCompleted = true;
        const joined = (data?.text || '').trim();
        if (joined) {
          return {
            text: joined,
            confidence: Number(data?.confidence) || 0.8,
            engine: 'tesseract',
            status: 'success',
          };
        }
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      console.warn('Tesseract OCR failed, falling back:', err);
    }
  }

  // A status message is not recognized text and must not be saved as a result.
  return {
    text: '',
    confidence: 0,
    engine: detectorCompleted ? 'shape-detection' : 'fallback',
    status: detectorCompleted ? 'empty' : 'unavailable',
    message: detectorCompleted
      ? 'No text was detected in this image.'
      : 'Text recognition is unavailable in this browser. Try a browser with a supported text detector.',
  };
}
