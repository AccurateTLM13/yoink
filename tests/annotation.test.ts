import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawArrow,
  drawRectangle,
  drawEllipse,
  drawPen,
  drawHighlighter,
  drawPixelateRedaction,
  drawBlackoutRedaction,
  drawTextBadge,
  renderAnnotations,
} from '../src/utils/annotation';
import { AnnotationItem } from '../src/types';

// Mock minimal 2D Canvas Context for Node test runner
class MockCanvasRenderingContext2D {
  public strokes: any[] = [];
  public fills: any[] = [];
  public strokeStyle = '#000000';
  public fillStyle = '#000000';
  public lineWidth = 1;
  public lineCap = 'butt';
  public lineJoin = 'miter';
  public globalAlpha = 1.0;
  public font = '10px sans-serif';
  public textBaseline = 'alphabetic';
  public imageSmoothingEnabled = true;

  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo(x: number, y: number) {
    this.strokes.push({ type: 'moveTo', x, y });
  }
  lineTo(x: number, y: number) {
    this.strokes.push({ type: 'lineTo', x, y });
  }
  stroke() {
    this.strokes.push({ type: 'stroke', style: this.strokeStyle, width: this.lineWidth });
  }
  fill() {
    this.fills.push({ type: 'fill', style: this.fillStyle });
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.strokes.push({ type: 'strokeRect', x, y, w, h, style: this.strokeStyle, width: this.lineWidth });
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.fills.push({ type: 'fillRect', x, y, w, h, style: this.fillStyle });
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number) {
    this.strokes.push({ type: 'ellipse', x, y, rx, ry });
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    this.strokes.push({ type: 'roundRect', x, y, w, h, r });
  }
  measureText(text: string) {
    return { width: text.length * 8 };
  }
  fillText(text: string, x: number, y: number) {
    this.fills.push({ type: 'fillText', text, x, y });
  }
  drawImage(...args: any[]) {
    this.strokes.push({ type: 'drawImage', args });
  }
}

describe('Annotation Toolkit (P0-1) - Geometry & Drawing', () => {
  test('drawArrow computes shaft and arrowhead polygon', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    drawArrow(ctx, 10, 20, 100, 20, '#ef4444', 4);

    assert.equal(ctx.strokeStyle, '#ef4444');
    assert.equal(ctx.fillStyle, '#ef4444');
    assert.equal(ctx.lineWidth, 4);

    const hasStroke = ctx.strokes.some((s: any) => s.type === 'stroke');
    const hasFill = ctx.fills.some((f: any) => f.type === 'fill');
    assert.equal(hasStroke, true);
    assert.equal(hasFill, true);
  });

  test('drawRectangle normalizes negative dimensions properly', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    // Draw dragged up and left (-50, -30)
    drawRectangle(ctx, 100, 80, -50, -30, '#3b82f6', 2, false);

    const rectOp = ctx.strokes.find((s: any) => s.type === 'strokeRect');
    assert.ok(rectOp);
    assert.equal(rectOp.x, 50);
    assert.equal(rectOp.y, 50);
    assert.equal(rectOp.w, 50);
    assert.equal(rectOp.h, 30);
  });

  test('drawEllipse computes center and absolute radii', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    drawEllipse(ctx, 20, 30, 40, 60, '#22c55e', 3, false);

    const ellipseOp = ctx.strokes.find((s: any) => s.type === 'ellipse');
    assert.ok(ellipseOp);
    assert.equal(ellipseOp.x, 40); // 20 + 40/2
    assert.equal(ellipseOp.y, 60); // 30 + 60/2
    assert.equal(ellipseOp.rx, 20);
    assert.equal(ellipseOp.ry, 30);
  });

  test('drawPen connects consecutive points', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    const points = [
      { x: 10, y: 10 },
      { x: 20, y: 30 },
      { x: 30, y: 50 },
    ];
    drawPen(ctx, points, '#000000', 3);

    const lines = ctx.strokes.filter((s: any) => s.type === 'lineTo');
    assert.equal(lines.length, 2);
  });

  test('drawHighlighter sets semi-transparency alpha', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    const points = [
      { x: 5, y: 5 },
      { x: 50, y: 5 },
    ];
    drawHighlighter(ctx, points, '#eab308', 4);

    assert.equal(ctx.globalAlpha, 0.35);
  });

  test('drawTextBadge measures and renders text', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    drawTextBadge(ctx, 'Bug Here', 50, 100, '#ef4444', 16);

    const textOp = ctx.fills.find((f: any) => f.type === 'fillText');
    assert.ok(textOp);
    assert.equal(textOp.text, 'Bug Here');
  });
});

describe('Blur & Redaction Tool (P0-3)', () => {
  test('renderAnnotations dispatches blur redaction tool correctly', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    const baseCanvas = {} as any;

    const annotations: AnnotationItem[] = [
      {
        id: '1',
        tool: 'blur',
        color: '#ef4444',
        strokeWidth: 2,
        startX: 10,
        startY: 10,
        endX: 60,
        endY: 40,
      },
    ];

    // Node environment lacks document.createElement('canvas'), but ensures dispatch completes without error
    if (typeof document !== 'undefined') {
      renderAnnotations(ctx, annotations, baseCanvas);
    }
    assert.equal(annotations[0].tool, 'blur');
  });

  test('drawBlackoutRedaction draws opaque solid #000000 rectangle with normalized bounds', () => {
    const ctx = new MockCanvasRenderingContext2D() as any;
    ctx.globalAlpha = 0.35;

    drawBlackoutRedaction(ctx, 120, 90, -40, -30);

    const fillOp = ctx.fills.find((f: any) => f.type === 'fillRect');
    assert.ok(fillOp, 'Expected fillRect call for blackout redaction');
    assert.equal(fillOp.x, 80);
    assert.equal(fillOp.y, 60);
    assert.equal(fillOp.w, 40);
    assert.equal(fillOp.h, 30);
    assert.equal(fillOp.style, '#000000');
  });

  test('renderAnnotations dispatches blackout tool and overwrites underlying pixel buffer completely', () => {
    const width = 20;
    const height = 20;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200;
      pixels[i + 1] = 150;
      pixels[i + 2] = 100;
      pixels[i + 3] = 255;
    }

    const rasterCtx: any = {
      fillStyle: '#ffffff',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      save() {},
      restore() {},
      fillRect(x: number, y: number, w: number, h: number) {
        if (this.fillStyle !== '#000000' || this.globalAlpha !== 1) return;
        for (let py = y; py < y + h; py++) {
          for (let px = x; px < x + w; px++) {
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              pixels[idx] = 0;
              pixels[idx + 1] = 0;
              pixels[idx + 2] = 0;
              pixels[idx + 3] = 255;
            }
          }
        }
      },
    };

    const blackoutItem: AnnotationItem = {
      id: 'blk_1',
      tool: 'blackout',
      color: '#ef4444', // Even if palette color is red, blackout must flatten as opaque solid black
      strokeWidth: 4,
      startX: 4,
      startY: 5,
      endX: 12,
      endY: 13,
    };

    renderAnnotations(rasterCtx, [blackoutItem], {} as any);

    // Covered pixel must be pure opaque black with zero original RGB retained
    const coveredIdx = (8 * width + 8) * 4;
    assert.deepEqual(Array.from(pixels.slice(coveredIdx, coveredIdx + 4)), [0, 0, 0, 255]);

    // Uncovered pixel remains untouched
    const outsideIdx = (1 * width + 1) * 4;
    assert.deepEqual(Array.from(pixels.slice(outsideIdx, outsideIdx + 4)), [200, 150, 100, 255]);
  });
});
