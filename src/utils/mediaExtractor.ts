import {
  CaptureSettings,
  HistoryItem,
  MediaFilterOptions,
  YoinkedMediaItem,
  YoinkMediaCategory,
  YoinkMediaFormat,
} from '../types';
import { isChromeExtension } from './capture';
import { applyProofToCanvasAndEncode } from './proof';
import { addHistoryItem } from './storage';

/**
 * Resolves a potentially relative URL against an optional base URL.
 */
export function resolveMediaUrl(rawUrl: string, baseUrl?: string): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed === 'none' || trimmed === 'about:blank') return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  try {
    return baseUrl ? new URL(trimmed, baseUrl).href : new URL(trimmed).href;
  } catch {
    return null;
  }
}

/**
 * Parses an HTML `srcset` attribute and returns the highest-resolution candidate URL.
 * Supports both width descriptors (`1920w`) and pixel density descriptors (`2x`, `3x`).
 */
export function pickHighestResSrcset(srcset: string, baseUrl?: string): string | null {
  if (!srcset || typeof srcset !== 'string') return null;

  // Split srcset candidates (comma-separated, minding commas inside URLs without whitespace after)
  const parts = srcset
    .split(/,\s+(?=\S)/)
    .map((s) => s.trim())
    .filter(Boolean);

  let bestUrl: string | null = null;
  let bestScore = -1;

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const rawCandidateUrl = tokens[0];
    if (!rawCandidateUrl) continue;

    let score = 1;
    if (tokens.length > 1) {
      const desc = tokens[tokens.length - 1].toLowerCase();
      if (desc.endsWith('w')) {
        const w = parseFloat(desc.slice(0, -1));
        if (Number.isFinite(w) && w > 0) score = w;
      } else if (desc.endsWith('x')) {
        const x = parseFloat(desc.slice(0, -1));
        if (Number.isFinite(x) && x > 0) score = x * 1000;
      }
    }

    const resolved = resolveMediaUrl(rawCandidateUrl, baseUrl) || rawCandidateUrl;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = resolved;
    }
  }

  return bestUrl;
}

/**
 * Extracts all `url(...)` image references from a CSS property value (e.g. `background-image`).
 */
export function extractCssUrls(cssValue: string, baseUrl?: string): string[] {
  if (!cssValue || typeof cssValue !== 'string' || cssValue === 'none') return [];
  const results: string[] = [];
  const regex = /url\(\s*(?:(['"])(.*?)\1|([^)'"]+))\s*\)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cssValue)) !== null) {
    const raw = (match[2] ?? match[3] ?? '').trim();
    if (!raw) continue;
    // Skip 1x1 transparent spacer GIFs
    if (raw.startsWith('data:image/gif;base64,R0lGOD')) continue;
    const resolved = resolveMediaUrl(raw, baseUrl);
    if (resolved && !results.includes(resolved)) {
      results.push(resolved);
    }
  }

  return results;
}

/**
 * Infers the image format from a URL, data URI, or category.
 */
export function inferImageFormat(url: string, category?: YoinkMediaCategory): YoinkMediaFormat {
  if (category === 'svg') return 'svg';
  const lower = (url || '').toLowerCase();
  if (lower.startsWith('data:image/svg')) return 'svg';
  if (lower.startsWith('data:image/png')) return 'png';
  if (lower.startsWith('data:image/jpeg') || lower.startsWith('data:image/jpg')) return 'jpeg';
  if (lower.startsWith('data:image/webp')) return 'webp';
  if (lower.startsWith('data:image/gif')) return 'gif';
  if (lower.startsWith('data:image/avif')) return 'avif';

  try {
    const parsed = new URL(url, 'https://example.com');
    const path = parsed.pathname.toLowerCase();
    const fmtParam = (parsed.searchParams.get('format') || parsed.searchParams.get('fm') || '').toLowerCase();

    if (path.endsWith('.svg') || fmtParam === 'svg') return 'svg';
    if (path.endsWith('.png') || fmtParam === 'png') return 'png';
    if (path.endsWith('.webp') || fmtParam === 'webp') return 'webp';
    if (path.endsWith('.gif') || fmtParam === 'gif') return 'gif';
    if (path.endsWith('.avif') || fmtParam === 'avif') return 'avif';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg') || fmtParam === 'jpg' || fmtParam === 'jpeg') return 'jpeg';
  } catch {
    // ignore URL parse failure
  }

  if (category === 'video' || category === 'canvas') return 'png';
  return 'unknown';
}

/**
 * Generates a clean, human-friendly asset name from alt/title text or URL path.
 */
export function deriveMediaName(
  url: string,
  labelHint?: string,
  category: YoinkMediaCategory = 'img',
  index: number = 1
): string {
  const cleanHint = (labelHint || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  if (cleanHint && cleanHint.length >= 2) {
    return cleanHint;
  }

  if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
    try {
      const u = new URL(url, 'https://example.com');
      const segs = u.pathname.split('/').filter(Boolean);
      const last = segs[segs.length - 1];
      if (last) {
        const withoutExt = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '');
        const cleaned = withoutExt.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
        if (cleaned.length >= 2) return cleaned;
      }
    } catch {
      // fallback
    }
  }

  const prefixMap: Record<YoinkMediaCategory, string> = {
    img: 'Page_Image',
    svg: 'Vector_SVG',
    bg: 'CSS_Background',
    video: 'Video_Frame',
    og: 'Social_Card',
    canvas: 'Canvas_Graphic',
  };

  return `${prefixMap[category] || 'Asset'}_${index}`;
}

/**
 * Filters and sorts extracted media items (largest pixel area first).
 */
export function filterAndSortMedia(
  items: YoinkedMediaItem[],
  options: MediaFilterOptions = {}
): YoinkedMediaItem[] {
  const { category = 'all', minDimension = 0, searchQuery = '' } = options;
  const q = searchQuery.trim().toLowerCase();

  return items
    .filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (minDimension > 0) {
        const maxSide = Math.max(item.width || 0, item.height || 0);
        // Keep SVGs or OG cards that might report 0 before render unless they have explicit smaller size
        if (maxSide > 0 && maxSide < minDimension) return false;
      }
      if (q) {
        const hay = `${item.name} ${item.format} ${item.sourceTag} ${item.category} ${item.url.startsWith('data:') ? '' : item.url}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const areaA = (a.width || 100) * (a.height || 100);
      const areaB = (b.width || 100) * (b.height || 100);
      return areaB - areaA;
    });
}

/**
 * Converts an SVG data URL or raw SVG markup into a high-resolution PNG dataUrl.
 */
export async function svgToPngDataUrl(
  item: YoinkedMediaItem,
  scale: number = 2
): Promise<{ dataUrl: string; width: number; height: number }> {
  const targetW = Math.max(64, (item.width || 256) * scale);
  const targetH = Math.max(64, (item.height || 256) * scale);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        width: targetW,
        height: targetH,
      });
    };
    img.onerror = () => reject(new Error('Could not rasterize SVG to PNG'));
    img.src = item.url;
  });
}

/**
 * Converts any YoinkedMediaItem into a signed HistoryItem in Yoink Studio so the user
 * can annotate, blur, OCR, or inspect Yoink Proof™ on it.
 */
export async function sendMediaItemToStudio(
  item: YoinkedMediaItem,
  settings: CaptureSettings
): Promise<HistoryItem> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load image due to cross-origin restrictions. Try downloading directly.'));
    el.src = item.url;
  });

  const w = Math.max(1, img.naturalWidth || item.width || 512);
  const h = Math.max(1, img.naturalHeight || item.height || 512);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(img, 0, 0, w, h);

  const encoded = await applyProofToCanvasAndEncode(canvas, {
    format: 'png',
    quality: 1,
    enableProof: settings.enableProof !== false,
    proofAuthor: settings.proofAuthor || '',
    proofVisualStamp: settings.proofVisualStamp || false,
    title: item.name,
    url: item.pageUrl || item.url,
    source: '', // An imported asset is not itself a screen capture.
  });

  const historyItem: HistoryItem = {
    id: `yoink_media_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: item.name,
    url: item.pageUrl || item.url,
    dataUrl: encoded.dataUrl,
    timestamp: Date.now(),
    width: encoded.width,
    height: encoded.height,
    mode: 'media',
    format: 'png',
    proofSigned: encoded.proofSigned,
    proofKeyId: encoded.proofKeyId,
  };

  await addHistoryItem(historyItem);
  return historyItem;
}

export interface OpenWebsiteTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

/**
 * Lists all open injectable website tabs in the browser so Studio Hub users can pick which tab to yoink from.
 */
export async function getInjectableOpenTabs(): Promise<OpenWebsiteTab[]> {
  if (isChromeExtension() && chrome.tabs?.query) {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const valid = (tabs || [])
          .filter((t) => {
            if (!t.id || !t.url) return false;
            try {
              const parsed = new URL(t.url);
              const isAllowedProtocol =
                parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
              return isAllowedProtocol && parsed.hostname !== 'chromewebstore.google.com';
            } catch {
              return false;
            }
          })
          .map((t) => ({
            id: t.id!,
            title: t.title || t.url || 'Webpage',
            url: t.url!,
            favIconUrl: t.favIconUrl,
          }));
        resolve(valid);
      });
    });
  }

  return [
    {
      id: 101,
      title: 'Stripe Press — High Growth Handbook',
      url: 'https://press.stripe.com/high-growth-handbook',
    },
    {
      id: 102,
      title: 'Linear — Plan and build products',
      url: 'https://linear.app/features',
    },
  ];
}

/**
 * Yoinks all images, SVGs, CSS background images, OpenGraph cards, and clean <video> frames from the target tab.
 */
export async function yoinkMediaFromTab(tabId?: number): Promise<{
  items: YoinkedMediaItem[];
  tabTitle: string;
  tabUrl: string;
  tabId?: number;
}> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'YOINK_PAGE_MEDIA',
          payload: { tabId },
        },
        (response) => {
          if (response?.error) {
            return reject(new Error(response.error));
          }
          resolve({
            items: response?.items || [],
            tabTitle: response?.tabTitle || 'Webpage',
            tabUrl: response?.tabUrl || '',
            tabId: response?.tabId,
          });
        }
      );
    });
  }

  // Rich standalone demo fallback for local preview / non-extension testing
  return buildDemoYoinkedMedia();
}

function buildDemoYoinkedMedia(): {
  items: YoinkedMediaItem[];
  tabTitle: string;
  tabUrl: string;
  tabId: number;
} {
  const svgLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80"><rect width="240" height="80" rx="16" fill="#0f172a"/><circle cx="44" cy="40" r="20" fill="#3b82f6"/><path d="M36 40l6 6 12-12" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="78" y="47" fill="#f8fafc" font-family="monospace" font-weight="bold" font-size="22">YOINK.SVG</text></svg>`;
  const svgBadge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs><rect width="120" height="120" rx="28" fill="url(#g)"/><path d="M60 26l26 11v21c0 18-11 33-26 39-15-6-26-21-26-39V37l26-11z" fill="none" stroke="#fff" stroke-width="5"/><path d="M48 60l8 8 16-16" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;

  const makeCanvasUrl = (w: number, h: number, bg1: string, bg2: string, label: string, sub: string) => {
    if (typeof document === 'undefined') return '';
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, bg1);
    g.addColorStop(1, bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(label, 40, h / 2 - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '16px monospace';
    ctx.fillText(`${sub} • ${w}×${h}px`, 40, h / 2 + 24);
    return c.toDataURL('image/png');
  };

  const items: YoinkedMediaItem[] = [
    {
      id: 'demo_video_1',
      url: makeCanvasUrl(1920, 1080, '#0f172a', '#1e3a8a', 'Clean <video> Frame Snap', 'Zero Player Controls / UI'),
      name: 'Product_Keynote_1080p_Frame',
      category: 'video',
      format: 'png',
      width: 1920,
      height: 1080,
      sourceTag: '<video> Clean Frame',
      pageUrl: 'https://linear.app/features',
      pageTitle: 'Linear — Plan and build products',
    },
    {
      id: 'demo_og_1',
      url: makeCanvasUrl(1200, 630, '#1e1b4b', '#4338ca', 'OpenGraph Social Banner', 'meta[property="og:image"]'),
      name: 'OpenGraph_Social_Preview_Card',
      category: 'og',
      format: 'png',
      width: 1200,
      height: 630,
      sourceTag: 'meta og:image',
      pageUrl: 'https://linear.app/features',
      pageTitle: 'Linear — Plan and build products',
    },
    {
      id: 'demo_img_1',
      url: makeCanvasUrl(1600, 1000, '#064e3b', '#047857', 'Hero Dashboard Preview (2x srcset)', '<img srcset="1600w">'),
      name: 'Hero_Dashboard_Retina_2x',
      category: 'img',
      format: 'png',
      width: 1600,
      height: 1000,
      sourceTag: '<img srcset>',
      pageUrl: 'https://linear.app/features',
      pageTitle: 'Linear — Plan and build products',
    },
    {
      id: 'demo_bg_1',
      url: makeCanvasUrl(1440, 800, '#3b0764', '#6d28d9', 'Hero Mesh Gradient Banner', 'CSS background-image'),
      name: 'Hero_Section_Mesh_Backdrop',
      category: 'bg',
      format: 'png',
      width: 1440,
      height: 800,
      sourceTag: 'CSS background-image',
      pageUrl: 'https://linear.app/features',
      pageTitle: 'Linear — Plan and build products',
    },
    {
      id: 'demo_svg_1',
      url: `data:image/svg+xml;utf8,${encodeURIComponent(svgLogo)}`,
      name: 'Brand_Header_Wordmark',
      category: 'svg',
      format: 'svg',
      width: 240,
      height: 80,
      sourceTag: 'Inline <svg>',
      svgCode: svgLogo,
      pageUrl: 'https://linear.app/features',
      pageTitle: 'Linear — Plan and build products',
    },
    {
      id: 'demo_svg_2',
      url: `data:image/svg+xml;utf8,${encodeURIComponent(svgBadge)}`,
      name: 'Security_Shield_Vector_Icon',
      category: 'svg',
      format: 'svg',
      width: 120,
      height: 120,
      sourceTag: 'Inline <svg>',
      svgCode: svgBadge,
      pageUrl: 'https://linear.app/features',
      pageTitle: 'Linear — Plan and build products',
    },
  ];

  return {
    items,
    tabTitle: 'Linear — Plan and build products (Demo)',
    tabUrl: 'https://linear.app/features',
    tabId: 101,
  };
}

