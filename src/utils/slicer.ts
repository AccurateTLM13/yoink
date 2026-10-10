import { CaptureFormat } from '../types';
import { downloadDataUrl } from './storage';

/**
 * Image Slicing Utilities
 * Slices tall screenshots into web-friendly vertical parts (e.g. max 4,000 px)
 * to prevent upload platforms (Discord, Slack, Jira, GitHub, Notion, etc.)
 * from crushing the image down to tiny, unreadable dimensions.
 */

export interface SliceRect {
  index: number;
  y: number;
  height: number;
}

export interface ImageSliceItem {
  dataUrl: string;
  part: number;
  total: number;
  y: number;
  height: number;
}

/**
 * Computes contiguous vertical slices for an image. Pure function.
 */
export function computeImageSlices(
  totalWidth: number,
  totalHeight: number,
  maxSliceHeight: number = 4000
): SliceRect[] {
  if (totalWidth <= 0 || totalHeight <= 0) return [];
  const limit = Math.max(500, Math.floor(maxSliceHeight || 4000));
  const slices: SliceRect[] = [];
  let y = 0;
  let index = 0;

  while (y < totalHeight) {
    const height = Math.min(limit, totalHeight - y);
    slices.push({ index, y, height });
    y += height;
    index++;
  }

  return slices;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for slicing'));
    img.src = src;
  });
}

/**
 * Slices an image dataUrl into vertical chunks.
 */
export async function sliceImage(
  src: string,
  maxSliceHeight: number = 4000,
  format: CaptureFormat = 'png',
  quality: number = 0.95
): Promise<ImageSliceItem[]> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return [{ dataUrl: src, part: 1, total: 1, y: 0, height: 0 }];
  }

  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  if (w <= 0 || h <= 0) {
    return [{ dataUrl: src, part: 1, total: 1, y: 0, height: 0 }];
  }

  const slices = computeImageSlices(w, h, maxSliceHeight);
  if (slices.length <= 1) {
    return [{ dataUrl: src, part: 1, total: 1, y: 0, height: h }];
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const q = format === 'png' ? undefined : quality;
  const items: ImageSliceItem[] = [];

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = slice.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, slice.height);
    }

    ctx.drawImage(img, 0, slice.y, w, slice.height, 0, 0, w, slice.height);
    const dataUrl = canvas.toDataURL(mime, q);
    canvas.width = 0;
    canvas.height = 0;

    items.push({
      dataUrl,
      part: i + 1,
      total: slices.length,
      y: slice.y,
      height: slice.height,
    });
  }

  return items;
}

/**
 * Slices an image and triggers downloads for each part.
 */
export async function downloadImageSlices(
  src: string,
  baseFilename: string,
  maxSliceHeight: number = 4000,
  format: CaptureFormat = 'png',
  quality: number = 0.95
): Promise<number> {
  const parts = await sliceImage(src, maxSliceHeight, format, quality);
  const cleanBase = (baseFilename || 'capture').replace(/\.[a-z0-9]+$/i, '');
  const ext = format === 'jpeg' ? 'jpg' : format;

  for (let i = 0; i < parts.length; i++) {
    const item = parts[i];
    const filename =
      parts.length > 1
        ? `${cleanBase}_part${item.part}_of_${item.total}.${ext}`
        : `${cleanBase}.${ext}`;

    downloadDataUrl(item.dataUrl, filename);
    if (i < parts.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return parts.length;
}
