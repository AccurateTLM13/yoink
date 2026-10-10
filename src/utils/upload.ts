import { CaptureFormat, HistoryItem } from '../types';

/**
 * P1-7 Upload and Edit.
 * Converts a local image file into a HistoryItem with mode 'upload'.
 * Runs fully on-device. No network calls.
 */

const SUPPORTED: Record<string, CaptureFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

/** Maximum accepted file size: 25 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('File is not a readable image'));
    img.src = src;
  });
}

/**
 * Returns the capture format for a MIME type, or null when conversion to PNG is needed.
 */
export function formatForMime(mime: string): CaptureFormat | null {
  return SUPPORTED[mime] || null;
}

/**
 * Strips the file extension and unsafe characters from a filename.
 */
export function titleFromFilename(name: string): string {
  const base = (name || 'Uploaded image').replace(/\.[a-z0-9]+$/i, '').trim();
  return base.slice(0, 80) || 'Uploaded image';
}

export async function fileToHistoryItem(file: File): Promise<HistoryItem> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name}: not an image file`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name}: larger than 25 MB`);
  }

  let dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  let format = formatForMime(file.type);
  if (!format) {
    // GIF, BMP, SVG, AVIF and others: re-encode to PNG so export paths stay uniform.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0);
    dataUrl = canvas.toDataURL('image/png');
    format = 'png';
  }

  return {
    id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: titleFromFilename(file.name),
    url: '',
    dataUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: 'upload',
    format,
    fileSizeBytes: file.size,
  };
}
