import { AnnotationItem, AnnotationTool } from '../types';

/**
 * Draws an arrow from (startX, startY) to (endX, endY) with an arrowhead.
 */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: string,
  strokeWidth: number
): void {
  const headLength = Math.max(12, strokeWidth * 3.5);
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Shaft
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLength * Math.cos(angle - Math.PI / 6),
    endY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    endX - headLength * Math.cos(angle + Math.PI / 6),
    endY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Draws a rectangle with rounded corners or square corners.
 */
export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  strokeWidth: number,
  fill = false
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;

  const rectX = w < 0 ? x + w : x;
  const rectY = h < 0 ? y + h : y;
  const rectW = Math.abs(w);
  const rectH = Math.abs(h);

  if (fill) {
    ctx.fillRect(rectX, rectY, rectW, rectH);
  } else {
    ctx.strokeRect(rectX, rectY, rectW, rectH);
  }

  ctx.restore();
}

/**
 * Draws an ellipse bounding the rectangle (x, y, w, h).
 */
export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  strokeWidth: number,
  fill = false
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;

  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const radiusX = Math.abs(w / 2);
  const radiusY = Math.abs(h / 2);

  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fill();
  } else {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws freehand pen strokes.
 */
export function drawPen(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  strokeWidth: number
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Draws semi-transparent highlighter strokes.
 */
export function drawHighlighter(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  strokeWidth: number
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(16, strokeWidth * 2.5);
  ctx.lineCap = 'square';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a text badge on the canvas.
 */
export function drawTextBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  fontSize = 18
): void {
  if (!text) return;

  ctx.save();
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';

  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const paddingX = 8;
  const paddingY = 4;
  const badgeHeight = fontSize + paddingY * 2;
  const badgeWidth = textWidth + paddingX * 2;

  // Background pill for contrast
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y - badgeHeight / 2, badgeWidth, badgeHeight, 6);
  ctx.fill();

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + paddingX, y);

  ctx.restore();
}

/**
 * Redacts an image region using pixelation (P0-3).
 * Samples source pixels from sourceCanvas, downsamples, and draws without smoothing.
 */
export function drawPixelateRedaction(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement | CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  blockSize = 12
): void {
  const rectX = Math.round(w < 0 ? x + w : x);
  const rectY = Math.round(h < 0 ? y + h : y);
  const rectW = Math.round(Math.abs(w));
  const rectH = Math.round(Math.abs(h));

  if (rectW <= 0 || rectH <= 0) return;

  ctx.save();

  // Create miniature offscreen canvas
  const miniCanvas = document.createElement('canvas');
  const miniW = Math.max(1, Math.floor(rectW / blockSize));
  const miniH = Math.max(1, Math.floor(rectH / blockSize));
  miniCanvas.width = miniW;
  miniCanvas.height = miniH;

  const miniCtx = miniCanvas.getContext('2d');
  if (!miniCtx) {
    ctx.restore();
    return;
  }

  // Draw region to miniature canvas (downsample)
  miniCtx.drawImage(
    sourceCanvas,
    rectX,
    rectY,
    rectW,
    rectH,
    0,
    0,
    miniW,
    miniH
  );

  // Disable smoothing for pixelated aesthetic
  ctx.imageSmoothingEnabled = false;

  // Draw back upscaled
  ctx.drawImage(miniCanvas, 0, 0, miniW, miniH, rectX, rectY, rectW, rectH);

  // Subtle border indicating redaction zone
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rectX, rectY, rectW, rectH);

  ctx.restore();
}

/**
 * Renders all annotations onto a target canvas context.
 */
export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationItem[],
  baseCanvas: HTMLCanvasElement | CanvasImageSource
): void {
  for (const item of annotations) {
    switch (item.tool) {
      case 'arrow':
        if (
          item.startX !== undefined &&
          item.startY !== undefined &&
          item.endX !== undefined &&
          item.endY !== undefined
        ) {
          drawArrow(
            ctx,
            item.startX,
            item.startY,
            item.endX,
            item.endY,
            item.color,
            item.strokeWidth
          );
        }
        break;

      case 'rect':
        if (
          item.startX !== undefined &&
          item.startY !== undefined &&
          item.endX !== undefined &&
          item.endY !== undefined
        ) {
          drawRectangle(
            ctx,
            item.startX,
            item.startY,
            item.endX - item.startX,
            item.endY - item.startY,
            item.color,
            item.strokeWidth,
            item.fill
          );
        }
        break;

      case 'ellipse':
        if (
          item.startX !== undefined &&
          item.startY !== undefined &&
          item.endX !== undefined &&
          item.endY !== undefined
        ) {
          drawEllipse(
            ctx,
            item.startX,
            item.startY,
            item.endX - item.startX,
            item.endY - item.startY,
            item.color,
            item.strokeWidth,
            item.fill
          );
        }
        break;

      case 'pen':
        if (item.points && item.points.length > 1) {
          drawPen(ctx, item.points, item.color, item.strokeWidth);
        }
        break;

      case 'highlighter':
        if (item.points && item.points.length > 1) {
          drawHighlighter(ctx, item.points, item.color, item.strokeWidth);
        }
        break;

      case 'text':
        if (item.startX !== undefined && item.startY !== undefined && item.text) {
          drawTextBadge(
            ctx,
            item.text,
            item.startX,
            item.startY,
            item.color,
            item.fontSize || 18
          );
        }
        break;

      case 'blur':
        if (
          item.startX !== undefined &&
          item.startY !== undefined &&
          item.endX !== undefined &&
          item.endY !== undefined
        ) {
          drawPixelateRedaction(
            ctx,
            baseCanvas,
            item.startX,
            item.startY,
            item.endX - item.startX,
            item.endY - item.startY,
            12
          );
        }
        break;

      default:
        break;
    }
  }
}

/**
 * Creates a composite data URL merging the base image and annotations.
 * Never mutates original source image data.
 */
export async function createAnnotatedComposite(
  baseImageSrc: string,
  annotations: AnnotationItem[],
  format: 'png' | 'jpeg' | 'webp' = 'png',
  quality = 0.92
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Canvas 2D context unavailable'));
      }

      // Draw base screenshot
      ctx.drawImage(img, 0, 0);

      // Render annotations
      renderAnnotations(ctx, annotations, canvas);

      const mime =
        format === 'jpeg'
          ? 'image/jpeg'
          : format === 'webp'
          ? 'image/webp'
          : 'image/png';
      const dataUrl = canvas.toDataURL(mime, quality);

      resolve({ dataUrl, width, height });
    };

    img.onerror = () => reject(new Error('Failed to load base image for compositing'));
    img.src = baseImageSrc;
  });
}
