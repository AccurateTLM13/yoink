import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  Undo2,
  Redo2,
  Trash2,
  Save,
  MousePointer,
  MoveUpRight,
  Square,
  Circle,
  Pencil,
  Highlighter,
  Type,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  FileText,
  ScanText,
} from 'lucide-react';
import { AnnotationItem, AnnotationTool, HistoryItem } from '../types';
import {
  drawArrow,
  drawRectangle,
  drawEllipse,
  drawPen,
  drawHighlighter,
  drawPixelateRedaction,
  drawTextBadge,
  renderAnnotations,
  createAnnotatedComposite,
} from '../utils/annotation';
import { addHistoryItem, copyImageToClipboard, downloadDataUrl, updateStoredHistoryItem } from '../utils/storage';
import { exportPdf } from '../utils/pdf';
import { OcrDrawer } from './OcrDrawer';

interface Props {
  item: HistoryItem;
  imageSrc: string;
  onClose: () => void;
  onSaved?: (newItem: HistoryItem) => void;
}

const COLOR_PALETTE = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Black', hex: '#09090b' },
  { name: 'White', hex: '#ffffff' },
];

const STROKE_WIDTHS = [
  { label: 'Thin', width: 2 },
  { label: 'Medium', width: 4 },
  { label: 'Thick', width: 8 },
];

export const AnnotationEditor: React.FC<Props> = ({
  item,
  imageSrc,
  onClose,
  onSaved,
}) => {
  const [activeTool, setActiveTool] = useState<AnnotationTool>('arrow');
  const [selectedColor, setSelectedColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [copied, setCopied] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showOcr, setShowOcr] = useState(false);

  const handleSaveOcrText = async (newText: string) => {
    item.ocrText = newText;
    await updateStoredHistoryItem(item.id, { ocrText: newText });
    if (onSaved) {
      onSaved({ ...item, ocrText: newText });
    }
  };

  // Annotations stack and undo/redo histories
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [undoStack, setUndoStack] = useState<AnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationItem[][]>([]);

  // Text input state
  const [textInputState, setTextInputState] = useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const [textValue, setTextValue] = useState('');

  // Canvas refs
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing tracking refs
  const isDrawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPointsRef = useRef<{ x: number; y: number }[]>([]);
  const baseImageRef = useRef<HTMLImageElement | null>(null);

  // Initialize base canvas with original image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      baseImageRef.current = img;
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      if (baseCanvasRef.current && drawCanvasRef.current) {
        baseCanvasRef.current.width = width;
        baseCanvasRef.current.height = height;
        drawCanvasRef.current.width = width;
        drawCanvasRef.current.height = height;

        const baseCtx = baseCanvasRef.current.getContext('2d');
        if (baseCtx) {
          baseCtx.drawImage(img, 0, 0);
        }
        redrawAll();
      }
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Redraw annotations on draw canvas
  const redrawAll = useCallback(
    (previewItem?: AnnotationItem) => {
      const drawCanvas = drawCanvasRef.current;
      const baseCanvas = baseCanvasRef.current;
      if (!drawCanvas || !baseCanvas) return;

      const ctx = drawCanvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

      // Render committed annotations
      renderAnnotations(ctx, annotations, baseCanvas);

      // Render active shape preview during drag
      if (previewItem) {
        renderAnnotations(ctx, [previewItem], baseCanvas);
      }
    },
    [annotations]
  );

  useEffect(() => {
    redrawAll();
  }, [annotations, redrawAll]);

  // Calculate coordinates relative to canvas pixels
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const commitAnnotation = (newItem: AnnotationItem) => {
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations((prev) => [...prev, newItem]);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select') return;
    const { x, y } = getCanvasCoords(e);

    if (activeTool === 'text') {
      const rect = drawCanvasRef.current?.getBoundingClientRect();
      if (rect) {
        setTextInputState({
          x: e.clientX,
          y: e.clientY,
          canvasX: x,
          canvasY: y,
        });
        setTextValue('');
      }
      return;
    }

    isDrawingRef.current = true;
    startPosRef.current = { x, y };
    currentPointsRef.current = [{ x, y }];

    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || activeTool === 'select' || activeTool === 'text') {
      return;
    }

    const { x, y } = getCanvasCoords(e);
    const startX = startPosRef.current.x;
    const startY = startPosRef.current.y;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      currentPointsRef.current.push({ x, y });
      redrawAll({
        id: 'preview',
        tool: activeTool,
        color: selectedColor,
        strokeWidth,
        points: [...currentPointsRef.current],
      });
      return;
    }

    // Shapes & redaction previews
    const preview: AnnotationItem = {
      id: 'preview',
      tool: activeTool,
      color: selectedColor,
      strokeWidth,
      startX,
      startY,
      endX: x,
      endY: y,
    };
    redrawAll(preview);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const { x, y } = getCanvasCoords(e);
    const startX = startPosRef.current.x;
    const startY = startPosRef.current.y;

    // Minimum movement check
    const dist = Math.hypot(x - startX, y - startY);

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      if (currentPointsRef.current.length > 1) {
        commitAnnotation({
          id: `ann_${Date.now()}`,
          tool: activeTool,
          color: selectedColor,
          strokeWidth,
          points: [...currentPointsRef.current],
        });
      }
      currentPointsRef.current = [];
      return;
    }

    if (dist >= 3) {
      commitAnnotation({
        id: `ann_${Date.now()}`,
        tool: activeTool,
        color: selectedColor,
        strokeWidth,
        startX,
        startY,
        endX: x,
        endY: y,
      });
    }

    redrawAll();
  };

  const handleCommitText = () => {
    if (textInputState && textValue.trim()) {
      commitAnnotation({
        id: `ann_${Date.now()}`,
        tool: 'text',
        color: selectedColor,
        strokeWidth: 2,
        startX: textInputState.canvasX,
        startY: textInputState.canvasY,
        text: textValue.trim(),
        fontSize: Math.max(16, strokeWidth * 4),
      });
    }
    setTextInputState(null);
    setTextValue('');
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setUndoStack((u) => u.slice(0, -1));
    setAnnotations(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, annotations]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next);
  };

  const handleClearAll = () => {
    if (annotations.length === 0) return;
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations([]);
  };

  // Keyboard shortcuts (Escape to cancel, Ctrl+Z to undo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (textInputState) {
          setTextInputState(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, annotations, textInputState, onClose]);

  // Export & Action Handlers
  const handleCopyComposite = async () => {
    const composite = await createAnnotatedComposite(imageSrc, annotations, 'png');
    const success = await copyImageToClipboard(composite.dataUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadComposite = async () => {
    const format = item.format || 'png';
    const composite = await createAnnotatedComposite(
      imageSrc,
      annotations,
      format,
      0.95
    );
    const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const filename = `${cleanTitle}_annotated_${Date.now()}.${format}`;
    downloadDataUrl(composite.dataUrl, filename);
  };

  const handleExportPdf = async () => {
    const composite = await createAnnotatedComposite(imageSrc, annotations, 'png');
    await exportPdf([composite.dataUrl], `${item.title || 'capture'}_annotated`);
  };

  const handleSaveToGallery = async () => {
    const composite = await createAnnotatedComposite(
      imageSrc,
      annotations,
      item.format || 'png',
      0.95
    );
    const newItem: HistoryItem = {
      id: `annotated_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `${item.title || 'Capture'} (Annotated)`,
      url: item.url || '',
      dataUrl: composite.dataUrl,
      timestamp: Date.now(),
      width: composite.width,
      height: composite.height,
      mode: 'annotated',
      format: item.format || 'png',
    };

    await addHistoryItem(newItem);
    setSavedSuccess(true);
    if (onSaved) onSaved(newItem);
    setTimeout(() => setSavedSuccess(false), 2200);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Annotation & Redaction Studio"
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950 font-sans select-none animate-in fade-in duration-150"
    >
      {/* Top Application Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 text-white z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center shrink-0">
            <Sparkles size={15} className="text-orange-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-zinc-100 truncate flex items-center gap-2">
              <span>Annotation & Redaction Studio</span>
              <span className="text-[10px] font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.2 rounded border border-orange-500/20">
                P0-1 // P0-3
              </span>
            </h3>
            <p className="text-[10px] text-zinc-400 font-mono truncate">
              {item.width} × {item.height}px • Non-destructive editor
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Undo / Redo / Clear */}
          <div className="flex items-center bg-zinc-800 rounded-lg p-0.5 border border-zinc-700 mr-1">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent rounded transition cursor-pointer"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent rounded transition cursor-pointer"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={13} />
            </button>
            <div className="w-px h-3.5 bg-zinc-700 mx-0.5" />
            <button
              onClick={handleClearAll}
              disabled={annotations.length === 0}
              className="p-1.5 text-zinc-300 hover:text-rose-400 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent rounded transition cursor-pointer"
              title="Clear all annotations"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-zinc-800 rounded-lg p-0.5 border border-zinc-700 mr-1 text-zinc-300">
            <button
              onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.4))}
              className="p-1 hover:text-white hover:bg-zinc-700 rounded transition cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut size={13} />
            </button>
            <span className="px-1.5 text-[10px] font-mono text-zinc-300 min-w-[34px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 2.5))}
              className="p-1 hover:text-white hover:bg-zinc-700 rounded transition cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
            {zoomLevel !== 1 && (
              <button
                onClick={() => setZoomLevel(1)}
                className="p-1 hover:text-white hover:bg-zinc-700 rounded transition cursor-pointer text-zinc-400"
                title="Reset zoom"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>

          {/* Copy to Clipboard */}
          <button
            onClick={handleCopyComposite}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition cursor-pointer border border-zinc-700"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Save to Gallery */}
          <button
            onClick={handleSaveToGallery}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs"
            title="Save annotated version as new capture"
          >
            {savedSuccess ? <Check size={13} /> : <Save size={13} />}
            <span>{savedSuccess ? 'Saved to Gallery!' : 'Save New'}</span>
          </button>

          {/* PDF */}
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition cursor-pointer border border-zinc-700"
            title="Export annotated image as PDF"
          >
            <FileText size={13} />
            <span>PDF</span>
          </button>

          {/* OCR */}
          <button
            onClick={() => setShowOcr(true)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
              showOcr
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
            }`}
            title="Extract text from capture (Offline OCR)"
          >
            <ScanText size={13} />
            <span>OCR</span>
          </button>

          {/* Download */}
          <button
            onClick={handleDownloadComposite}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs"
          >
            <Download size={13} />
            <span>Download</span>
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition cursor-pointer ml-1"
            title="Exit editor (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Canvas Workspace */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-zinc-950 p-6 flex items-center justify-center relative cursor-crosshair"
      >
        <div
          className="relative transition-transform duration-100 ease-out origin-center inline-block shadow-2xl rounded border border-zinc-800"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {/* Base pristine image canvas */}
          <canvas ref={baseCanvasRef} className="block max-w-none" />

          {/* Interactive drawing and redaction canvas overlay */}
          <canvas
            ref={drawCanvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute inset-0 block max-w-none touch-none"
          />

          {/* Floating inline text input modal */}
          {textInputState && (
            <div
              className="absolute z-30 flex items-center gap-1 bg-zinc-900 border border-zinc-700 p-1.5 rounded-lg shadow-xl"
              style={{
                left: `${textInputState.canvasX}px`,
                top: `${textInputState.canvasY}px`,
                transform: 'translate(0, -50%)',
              }}
            >
              <input
                type="text"
                autoFocus
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitText();
                  if (e.key === 'Escape') setTextInputState(null);
                }}
                placeholder="Enter text..."
                className="px-2 py-1 text-xs bg-zinc-800 text-white border border-zinc-700 rounded outline-none focus:border-blue-500 w-44 font-sans"
              />
              <button
                onClick={handleCommitText}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded cursor-pointer"
              >
                Add
              </button>
              <button
                onClick={() => setTextInputState(null)}
                className="p-1 text-zinc-400 hover:text-white rounded"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bottom Toolbar Dock */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-zinc-900/95 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-zinc-700/80 shadow-[0_12px_40px_rgba(0,0,0,0.6)] text-white">
        {/* Tool selector pills */}
        <div className="flex items-center gap-1 bg-zinc-800/80 p-0.5 rounded-xl border border-zinc-700/60">
          <button
            onClick={() => setActiveTool('select')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'select' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Inspect / Pan"
          >
            <MousePointer size={15} />
          </button>
          <button
            onClick={() => setActiveTool('arrow')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'arrow' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Arrow (Alt+A)"
          >
            <MoveUpRight size={15} />
          </button>
          <button
            onClick={() => setActiveTool('rect')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'rect' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Rectangle (Alt+R)"
          >
            <Square size={15} />
          </button>
          <button
            onClick={() => setActiveTool('ellipse')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'ellipse' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Circle / Ellipse"
          >
            <Circle size={15} />
          </button>
          <button
            onClick={() => setActiveTool('pen')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'pen' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Freehand Pen (Alt+P)"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setActiveTool('highlighter')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'highlighter' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Highlighter (Alt+H)"
          >
            <Highlighter size={15} />
          </button>
          <button
            onClick={() => setActiveTool('text')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'text' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Text Label (Alt+T)"
          >
            <Type size={15} />
          </button>
          <button
            onClick={() => setActiveTool('blur')}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              activeTool === 'blur'
                ? 'bg-rose-600 text-white'
                : 'text-rose-400 hover:text-rose-300'
            }`}
            title="Pixelate / Redact Sensitive Data (P0-3)"
          >
            <EyeOff size={15} />
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-zinc-700" />

        {/* Color Palette */}
        <div className="flex items-center gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c.hex}
              onClick={() => setSelectedColor(c.hex)}
              title={c.name}
              className={`w-5 h-5 rounded-full transition cursor-pointer ${
                selectedColor === c.hex
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110'
                  : 'hover:scale-105 opacity-80 hover:opacity-100'
              }`}
              style={{
                backgroundColor: c.hex,
                border: c.hex === '#ffffff' ? '1px solid #71717a' : 'none',
              }}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-zinc-700" />

        {/* Stroke Width Selector */}
        <div className="flex items-center gap-1 bg-zinc-800/80 p-0.5 rounded-xl border border-zinc-700/60">
          {STROKE_WIDTHS.map((s) => (
            <button
              key={s.width}
              onClick={() => setStrokeWidth(s.width)}
              className={`px-2 py-1 text-[11px] font-mono rounded-lg transition cursor-pointer ${
                strokeWidth === s.width
                  ? 'bg-zinc-700 text-white font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* OCR Drawer (P2-9) */}
      {showOcr && (
        <OcrDrawer
          dataUrl={imageSrc}
          initialText={item.ocrText}
          onSaveText={handleSaveOcrText}
          onClose={() => setShowOcr(false)}
        />
      )}
    </div>
  );
};
