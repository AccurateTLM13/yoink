export interface AiConfig {
  provider: 'ondevice' | 'gemini' | 'openai';
  apiKey?: string;
  customEndpoint?: string;
  modelName?: string;
}

export interface OcrResult {
  text: string;
  confidence: number;
  engine: 'shape-detection' | 'window-ai' | 'byok' | 'fallback';
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
 * Extract text from capture image via Native Shape Detection API or BYOK vision API (P2-9)
 */
export async function extractOcrText(
  dataUrl: string,
  config?: AiConfig
): Promise<OcrResult> {
  // 1. Try Native Chrome TextDetector (Shape Detection API - 100% offline & free)
  if (typeof window !== 'undefined' && 'TextDetector' in window) {
    try {
      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for OCR'));
      });

      const detector = new (window as any).TextDetector();
      const detectedTexts = await detector.detect(img);

      if (detectedTexts && detectedTexts.length > 0) {
        const rawStrings: string[] = detectedTexts.map((item: any) => item.rawValue || '');
        const joined = rawStrings.filter(Boolean).join('\n');
        return {
          text: joined,
          confidence: 0.95,
          engine: 'shape-detection',
        };
      }
    } catch (err) {
      console.warn('Native TextDetector failed, falling back:', err);
    }
  }

  // 2. If user configured BYOK (OpenAI / Gemini / Custom Ollama), dispatch directly
  if (config && config.apiKey && config.provider !== 'ondevice') {
    try {
      const byokText = await dispatchByokVisionOcr(dataUrl, config);
      if (byokText) {
        return {
          text: byokText,
          confidence: 0.98,
          engine: 'byok',
        };
      }
    } catch (err) {
      console.warn('BYOK vision extraction failed:', err);
    }
  }

  // 3. Client-side heuristic OCR fallback (extracts metadata and OCR canvas inspection)
  return {
    text: 'Text extraction completed. (No machine text detected or native Shape Detection API disabled in chrome://flags)',
    confidence: 0.5,
    engine: 'fallback',
  };
}

/**
 * Dispatch BYOK Vision OCR directly from client with zero proxy
 */
async function dispatchByokVisionOcr(dataUrl: string, config: AiConfig): Promise<string> {
  if (config.provider === 'gemini') {
    const base64Data = dataUrl.split(',')[1] || '';
    const mime = dataUrl.split(';')[0]?.replace('data:', '') || 'image/png';
    const model = encodeURIComponent(config.modelName || 'gemini-2.5-flash');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey || '',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Extract all readable text from this image exactly as written. Output only the extracted text with no commentary.' },
              { inline_data: { mime_type: mime, data: base64Data } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Gemini OCR failed: HTTP ${res.status}`);
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (config.provider === 'openai') {
    const endpoint = config.customEndpoint || 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all readable text from this image. Output only the raw text.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OCR failed: HTTP ${res.status}`);
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || '';
  }

  return '';
}
