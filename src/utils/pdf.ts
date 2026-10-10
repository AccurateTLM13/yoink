/**
 * P0-2 PDF Export
 *
 * Dependency-free PDF 1.4 writer. Each page holds 1 JPEG image (DCTDecode).
 * buildPdf() is pure and runs in Node tests. The browser helpers below
 * slice tall captures into A4-ratio pages with a canvas.
 */

import { downloadDataUrl } from './storage';

export interface PdfPage {
  /** Raw JPEG file bytes. */
  jpeg: Uint8Array;
  /** Image pixel width. */
  pixelWidth: number;
  /** Image pixel height. */
  pixelHeight: number;
  /** Page width in PDF points (1/72 in). */
  pageWidth: number;
  /** Page height in PDF points. */
  pageHeight: number;
}

/** A4 portrait width in points. */
export const A4_WIDTH_PT = 595.28;
/** A4 portrait height in points. */
export const A4_HEIGHT_PT = 841.89;

const encoder = new TextEncoder();

function ascii(s: string): Uint8Array {
  return encoder.encode(s);
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/**
 * Builds a PDF document. Returns the file bytes.
 */
export function buildPdf(pages: PdfPage[], title = 'Yoink Export'): Uint8Array {
  if (pages.length === 0) {
    throw new Error('buildPdf requires at least 1 page');
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (data: Uint8Array) => {
    chunks.push(data);
    length += data.length;
  };

  // Object numbering:
  // 1 = Catalog, 2 = Pages, 3 = Info, then 3 objects per page (Page, Content, Image).
  const pageObjNum = (i: number) => 4 + i * 3;
  const contentObjNum = (i: number) => 5 + i * 3;
  const imageObjNum = (i: number) => 6 + i * 3;
  const totalObjects = 3 + pages.length * 3;

  const beginObj = (num: number) => {
    offsets[num] = length;
    push(ascii(`${num} 0 obj\n`));
  };
  const endObj = () => push(ascii('endobj\n'));

  // Header with binary marker comment.
  push(ascii('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObj(1);
  push(ascii('<< /Type /Catalog /Pages 2 0 R >>\n'));
  endObj();

  beginObj(2);
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ');
  push(ascii(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\n`));
  endObj();

  beginObj(3);
  const safeTitle = title.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '');
  push(ascii(`<< /Title (${safeTitle}) /Producer (Yoink) >>\n`));
  endObj();

  pages.forEach((page, i) => {
    const w = fmt(page.pageWidth);
    const h = fmt(page.pageHeight);

    beginObj(pageObjNum(i));
    push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/Resources << /XObject << /Im${i} ${imageObjNum(i)} 0 R >> >> ` +
          `/Contents ${contentObjNum(i)} 0 R >>\n`
      )
    );
    endObj();

    const stream = ascii(`q\n${w} 0 0 ${h} 0 0 cm\n/Im${i} Do\nQ\n`);
    beginObj(contentObjNum(i));
    push(ascii(`<< /Length ${stream.length} >>\nstream\n`));
    push(stream);
    push(ascii('endstream\n'));
    endObj();

    beginObj(imageObjNum(i));
    push(
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
      )
    );
    push(page.jpeg);
    push(ascii('\nendstream\n'));
    endObj();
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjects; n++) {
    xref += `${offsets[n].toString().padStart(10, '0')} 00000 n \n`;
  }
  push(ascii(xref));
  push(ascii(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Computes the pixel slices for 1 image on A4-width pages.
 * Returns the [startY, height] pairs in source pixels.
 */
export function computePageSlices(
  pixelWidth: number,
  pixelHeight: number,
  pageWidthPt = A4_WIDTH_PT,
  pageHeightPt = A4_HEIGHT_PT
): { y: number; height: number }[] {
  if (pixelWidth <= 0 || pixelHeight <= 0) return [];
  const sliceHeightPx = Math.max(1, Math.floor((pageHeightPt / pageWidthPt) * pixelWidth));
  const slices: { y: number; height: number }[] = [];
  for (let y = 0; y < pixelHeight; y += sliceHeightPx) {
    slices.push({ y, height: Math.min(sliceHeightPx, pixelHeight - y) });
  }
  return slices;
}

// ---------------------------------------------------------------------------
// Browser-only helpers
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for PDF export'));
    img.src = src;
  });
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('JPEG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Converts 1 image into A4-width PDF pages.
 * Short images get 1 page sized to the image ratio. Tall images split into A4 pages.
 */
export async function imageToPdfPages(src: string, quality = 0.9): Promise<PdfPage[]> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const slices = computePageSlices(w, h);
  const pages: PdfPage[] = [];

  for (const slice of slices) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = slice.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    // JPEG has no alpha. Fill white so transparent areas do not turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, slice.height);
    ctx.drawImage(img, 0, slice.y, w, slice.height, 0, 0, w, slice.height);

    const jpeg = await canvasToJpegBytes(canvas, quality);
    canvas.width = 0;
    canvas.height = 0;

    pages.push({
      jpeg,
      pixelWidth: w,
      pixelHeight: slice.height,
      pageWidth: A4_WIDTH_PT,
      pageHeight: (slice.height / w) * A4_WIDTH_PT,
    });
  }

  return pages;
}

/**
 * Builds 1 PDF from 1 or more images. Each image starts on a new page.
 * Returns a blob: URL. The caller revokes it.
 */
export async function createPdfBlobUrl(sources: string[], title: string): Promise<string> {
  const pages: PdfPage[] = [];
  for (const src of sources) {
    pages.push(...(await imageToPdfPages(src)));
  }
  const bytes = buildPdf(pages, title);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

/**
 * Builds a PDF and starts the download. Frees the blob URL after 60 s.
 */
export async function exportPdf(sources: string[], baseName: string): Promise<void> {
  const clean = (baseName || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'capture';
  const url = await createPdfBlobUrl(sources, baseName || 'Yoink Export');
  downloadDataUrl(url, `${clean}_${Date.now()}.pdf`);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
