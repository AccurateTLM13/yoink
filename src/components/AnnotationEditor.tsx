import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Check,
  Circle,
  Copy,
  Download,
  EyeOff,
  FileText,
  Highlighter,
  MousePointer,
  MoveUpRight,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  ScanText,
  SlidersHorizontal,
  Square,
  SquareSlash,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AnnotationItem, AnnotationTool, HistoryItem } from '../types';
import { renderAnnotations, createAnnotatedComposite } from '../utils/annotation';
import {
  addHistoryItem,
  copyImageToClipboard,
  createRandomId,
  downloadDataUrl,
  getStoredSettings,
  updateStoredHistoryItem,
} from '../utils/storage';
import { exportPdf } from '../utils/pdf';
import { formatDimensions } from '../utils/studioFormat';
import { OcrDrawer } from './OcrDrawer';

interface Props {
  item: HistoryItem;
  imageSrc: string;
  onClose: () => void;
  onSaved?: (newItem: HistoryItem) => void;
  onOcrSaved?: (updatedItem: HistoryItem) => void;
}

// Canvas drawing ink colors (applied to drawn annotations, not UI chrome)
const INK_SWATCHES = [
  { name: 'Red', hex: '#EF4444' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Green', hex: '#22C55E' },
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Violet', hex: '#A855F7' },
  { name: 'Black', hex: '#09090B' },
  { name: 'White', hex: '#FFFFFF' },
];

const STROKE_WIDTHS = [
  { label: 'Thin', width: 2 },
  { label: 'Medium', width: 4 },
  { label: 'Thick', width: 8 },
];

const EDITOR_TOOLS: Array<{ id: AnnotationTool; label: string; icon: React.ReactNode }> = [
  { id: 'select', label: 'Select', icon: <MousePointer size={16} strokeWidth={1.5} /> },
  { id: 'arrow', label: 'Arrow', icon: <MoveUpRight size={16} strokeWidth={1.5} /> },
  { id: 'rect', label: 'Rectangle', icon: <Square size={16} strokeWidth={1.5} /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle size={16} strokeWidth={1.5} /> },
  { id: 'pen', label: 'Pen', icon: <Pencil size={16} strokeWidth={1.5} /> },
  { id: 'highlighter', label: 'Highlighter', icon: <Highlighter size={16} strokeWidth={1.5} /> },
  { id: 'text', label: 'Text', icon: <Type size={16} strokeWidth={1.5} /> },
  { id: 'blur', label: 'Blur redact', icon: <EyeOff size={16} strokeWidth={1.5} /> },
  { id: 'blackout', label: 'Blackout', icon: <SquareSlash size={16} strokeWidth={1.5} /> },
];

export const AnnotationEditor: React.FC<Props> = ({
  item,
  imageSrc,
  onClose,
  onSaved,
  onOcrSaved,
}) => {
  const [activeTool, setActiveTool] = useState<AnnotationTool>('arrow');
  const [selectedColor, setSelectedColor] = useState('#EF4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [copied, setCopied] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [mobileTrayOpen, setMobileTrayOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [actionError, setActionError] = useState('');
  const [ocrTextOverride, setOcrTextOverride] = useState<string | null>(null);
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number }>({
    w: item.width || 0,
    h: item.height || 0,
  });

  const handleSaveOcrText = async (newText: string) => {
    setOcrTextOverride(newText);
    await updateStoredHistoryItem(item.id, { ocrText: newText });
    if (onOcrSaved) onOcrSaved({ ...item, ocrText: newText });
  };

  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [undoStack, setUndoStack] = useState<AnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationItem[][]>([]);

  const [textInputState, setTextInputState] = useState<{
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const [textValue, setTextValue] = useState('');

  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPointsRef = useRef<{ x: number; y: number }[]>([]);

  const redrawAll = useCallback(
    (previewItem?: AnnotationItem) => {
      const drawCanvas = drawCanvasRef.current;
      const baseCanvas = baseCanvasRef.current;
      if (!drawCanvas || !baseCanvas) return;

      const ctx = drawCanvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      renderAnnotations(ctx, annotations, baseCanvas);
      if (previewItem) {
        renderAnnotations(ctx, [previewItem], baseCanvas);
      }
    },
    [annotations]
  );

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      setCanvasDims({ w: width, h: height });

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
  }, [imageSrc, redrawAll]);

  useEffect(() => {
    redrawAll();
  }, [annotations, redrawAll]);

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
      setTextInputState({ canvasX: x, canvasY: y });
      setTextValue('');
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
    if (!isDrawingRef.current || activeTool === 'select' || activeTool === 'text') return;
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

    redrawAll({
      id: 'preview',
      tool: activeTool,
      color: selectedColor,
      strokeWidth,
      startX,
      startY,
      endX: x,
      endY: y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const { x, y } = getCanvasCoords(e);
    const startX = startPosRef.current.x;
    const startY = startPosRef.current.y;
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

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setUndoStack((u) => u.slice(0, -1));
    setAnnotations(prev);
  }, [undoStack, annotations]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, annotations]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next);
  }, [redoStack, annotations]);

  const handleClearAll = () => {
    if (annotations.length === 0) return;
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations([]);
  };

  const requestClose = useCallback(() => {
    if (annotations.length > 0 || (textInputState && textValue.trim())) setConfirmDiscard(true);
    else onClose();
  }, [annotations.length, textInputState, textValue, onClose]);

  useEffect(() => {
    if (annotations.length === 0 && !(textInputState && textValue.trim())) return;
    const warnBeforeClosing = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClosing);
    return () => window.removeEventListener('beforeunload', warnBeforeClosing);
  }, [annotations.length, textInputState, textValue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) handleRedo();
        else handleUndo();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (confirmDiscard) setConfirmDiscard(false);
        else if (showOcr) setShowOcr(false);
        else if (textInputState) setTextInputState(null);
        else requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, textInputState, showOcr, confirmDiscard, requestClose]);

  const getProofMeta = async () => {
    const settings = await getStoredSettings().catch(() => null);
    return {
      url: item.url,
      title: item.title,
      enableProof: settings ? settings.enableProof !== false : true,
      proofAuthor: settings?.proofAuthor || '',
    };
  };

  const handleCopyComposite = async () => {
    const composite = await createAnnotatedComposite(
      imageSrc,
      annotations,
      'png',
      0.95,
      await getProofMeta()
    );
    const success = await copyImageToClipboard(composite.dataUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownloadComposite = async () => {
    try {
      const format = item.format || 'png';
      const composite = await createAnnotatedComposite(
        imageSrc,
        annotations,
        format,
        0.95,
        await getProofMeta()
      );
      const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      await downloadDataUrl(composite.dataUrl, `${cleanTitle}_annotated_${Date.now()}.${format}`);
      setActionError('');
    } catch (error) {
      setActionError(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleExportPdf = async () => {
    try {
      const composite = await createAnnotatedComposite(
        imageSrc,
        annotations,
        'png',
        0.95,
        await getProofMeta()
      );
      await exportPdf([composite.dataUrl], `${item.title || 'capture'}_annotated`);
      setActionError('');
    } catch (error) {
      setActionError(`PDF export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSaveToGallery = async () => {
    try {
      const composite = await createAnnotatedComposite(
        imageSrc,
        annotations,
        item.format || 'png',
        0.95,
        await getProofMeta()
      );
      const newItem: HistoryItem = {
        id: createRandomId('annotated'),
        title: `${item.title || 'Capture'} (Annotated)`,
        url: item.url || '',
        dataUrl: composite.dataUrl,
        timestamp: Date.now(),
        width: composite.width,
        height: composite.height,
        mode: 'annotated',
        format: item.format || 'png',
        proofKeyId: composite.proofKeyId,
        proofSigned: composite.proofSigned,
      };

      await addHistoryItem(newItem);
      setSavedSuccess(true);
      if (onSaved) onSaved(newItem);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (error) {
      setActionError(
        `Could not save edits: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const dimsLabel = formatDimensions(canvasDims.w, canvasDims.h);

  const styleControlsContent = (
    <div className="space-y-5">
      {/* Ink Color */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="type-caption text-[var(--ink-muted)]">Ink color</span>
          <span className="type-mono text-[var(--ink)]">{selectedColor}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {INK_SWATCHES.map((swatch) => {
            const active = selectedColor === swatch.hex;
            return (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => setSelectedColor(swatch.hex)}
                aria-label={swatch.name}
                aria-pressed={active}
                title={swatch.name}
                className={`h-8 rounded-[6px] border cursor-pointer studio-focus ${
                  active ? 'border-[var(--ink)] outline-2 outline-[var(--ink)] -outline-offset-2' : 'border-[var(--border)]'
                }`}
                style={{ backgroundColor: swatch.hex }}
              />
            );
          })}
        </div>
      </div>

      {/* Stroke Width */}
      <div className="space-y-2 pt-4 border-t border-[var(--border)]">
        <div className="flex items-center justify-between gap-2">
          <span className="type-caption text-[var(--ink-muted)]">Stroke width</span>
          <span className="type-mono text-[var(--ink)]">{strokeWidth}px</span>
        </div>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)]">
          {STROKE_WIDTHS.map((s) => (
            <button
              key={s.width}
              type="button"
              onClick={() => setStrokeWidth(s.width)}
              aria-pressed={strokeWidth === s.width}
              className={`h-8 rounded-[6px] type-caption cursor-pointer transition-colors studio-focus ${
                strokeWidth === s.width
                  ? 'bg-[var(--ink)] text-[var(--surface)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Redaction Shortcuts */}
      <div className="space-y-2 pt-4 border-t border-[var(--border)]">
        <span className="type-caption text-[var(--ink-muted)] block">Redaction</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTool('blur')}
            aria-pressed={activeTool === 'blur'}
            className={`h-9 px-2 rounded-[8px] border type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer studio-focus ${
              activeTool === 'blur'
                ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]'
                : 'border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <EyeOff size={16} strokeWidth={1.5} />
            <span>Blur</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTool('blackout')}
            aria-pressed={activeTool === 'blackout'}
            className={`h-9 px-2 rounded-[8px] border type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer studio-focus ${
              activeTool === 'blackout'
                ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]'
                : 'border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <SquareSlash size={16} strokeWidth={1.5} />
            <span>Blackout</span>
          </button>
        </div>
        <p className="type-ui text-[var(--ink-muted)]">
          Blackout permanently overwrites underlying pixels on export.
        </p>
      </div>

      {/* Output Actions */}
      <div className="space-y-2 pt-4 border-t border-[var(--border)]">
        <span className="type-caption text-[var(--ink-muted)] block">Outputs</span>
        <button
          type="button"
          onClick={handleSaveToGallery}
          className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer studio-focus"
        >
          {savedSuccess ? <Check size={16} strokeWidth={1.5} /> : <Save size={16} strokeWidth={1.5} />}
          <span>{savedSuccess ? 'Saved to gallery' : 'Save new to gallery'}</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopyComposite}
            className="h-9 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer studio-focus"
          >
            {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            className="h-9 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer studio-focus"
          >
            <FileText size={16} strokeWidth={1.5} />
            <span>PDF</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Annotation editor"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden"
    >
      {/* Edge-Docked 44px Top Toolbar (Shottr pattern — nothing floats over screenshot) */}
      <header className="h-[44px] px-3 md:px-4 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between gap-3 overflow-x-auto shrink-0">
        {/* Tools Strip (Accent #1: active tool) */}
        <div className="flex items-center gap-1 shrink-0" role="toolbar" aria-label="Annotation tools">
          {EDITOR_TOOLS.map((tool) => {
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
                aria-label={tool.label}
                aria-pressed={active}
                title={tool.label}
                className={`w-8 h-8 rounded-[8px] flex items-center justify-center cursor-pointer transition-colors studio-focus ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--canvas)]'
                }`}
              >
                {tool.icon}
              </button>
            );
          })}
        </div>

        {/* Center Readouts & History */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileTrayOpen((open) => !open)}
            aria-label="Toggle style options"
            aria-pressed={mobileTrayOpen}
            title="Style options"
            className="md:hidden h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] inline-flex items-center gap-2 cursor-pointer studio-focus"
          >
            <span
              className="w-3 h-3 rounded-[4px] border border-[var(--border)] shrink-0"
              style={{ backgroundColor: selectedColor }}
            />
            <SlidersHorizontal size={16} strokeWidth={1.5} />
          </button>

          {dimsLabel && (
            <span className="hidden lg:inline type-mono text-[var(--ink-muted)]">{dimsLabel}</span>
          )}

          {/* Undo / Redo / Clear */}
          <div className="flex items-center gap-1 border-l border-[var(--border)] pl-3">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] disabled:opacity-40 flex items-center justify-center cursor-pointer studio-focus"
            >
              <Undo2 size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] disabled:opacity-40 flex items-center justify-center cursor-pointer studio-focus"
            >
              <Redo2 size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={annotations.length === 0}
              aria-label="Clear annotations"
              title="Clear all annotations"
              className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-40 flex items-center justify-center cursor-pointer studio-focus"
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 border-l border-[var(--border)] pl-3">
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.4))}
              aria-label="Zoom out"
              className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
            >
              <ZoomOut size={16} strokeWidth={1.5} />
            </button>
            <span className="type-mono text-[var(--ink)] min-w-[40px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 2.5))}
              aria-label="Zoom in"
              className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
            >
              <ZoomIn size={16} strokeWidth={1.5} />
            </button>
            {zoomLevel !== 1 && (
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                aria-label="Reset zoom"
                className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
              >
                <RotateCcw size={16} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        {/* Right Actions: OCR + Single Primary Export CTA (Accent #2) + Close */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowOcr((o) => !o)}
            aria-pressed={showOcr}
            className={`h-8 px-3 rounded-[8px] border type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus ${
              showOcr
                ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]'
                : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)]'
            }`}
          >
            <ScanText size={16} strokeWidth={1.5} />
            <span>OCR</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadComposite}
            className="h-8 px-3 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
          >
            <Download size={16} strokeWidth={1.5} />
            <span>Export</span>
          </button>

          <button
            type="button"
            onClick={requestClose}
            aria-label="Close editor"
            title="Exit editor (Esc)"
            className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {actionError && (
        <div
          role="alert"
          className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] type-ui text-[var(--semantic-error)] shrink-0"
        >
          {actionError}
        </div>
      )}

      {/* Edge-Docked Text Insertion Bar (never floats over image pixels) */}
      {textInputState && (
        <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center gap-2 shrink-0">
          <span className="type-mono text-[var(--ink-muted)]">
            Text at {Math.round(textInputState.canvasX)}, {Math.round(textInputState.canvasY)}
          </span>
          <input
            type="text"
            autoFocus
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCommitText();
              if (e.key === 'Escape') setTextInputState(null);
            }}
            placeholder="Type annotation text"
            className="flex-1 min-w-[160px] h-8 px-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink)] select-text studio-focus"
          />
          <button
            type="button"
            onClick={handleCommitText}
            className="h-8 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-ui-medium cursor-pointer studio-focus"
          >
            Insert
          </button>
          <button
            type="button"
            onClick={() => setTextInputState(null)}
            className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Body: 240px Left Style Panel (Desktop) + Full-Bleed Canvas Pasteboard */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <aside
          aria-label="Annotation styles"
          className="hidden md:flex w-[240px] shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex-col overflow-y-auto p-4"
        >
          {styleControlsContent}
        </aside>

        {/* Full-Bleed Pasteboard */}
        <div className="flex-1 min-w-0 overflow-auto bg-[var(--canvas)] p-4 md:p-6 flex items-center justify-center cursor-crosshair">
          <div
            className="origin-center inline-block p-2 rounded-[12px] bg-[var(--surface)] border border-[var(--border)]"
            style={{ transform: `scale(${zoomLevel})` }}
          >
            <div className="rounded-[4px] overflow-hidden border border-[var(--border)] bg-[var(--canvas)]">
              <div className="relative">
                <canvas ref={baseCanvasRef} className="block max-w-none" />
                <canvas
                  ref={drawCanvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="absolute inset-0 block max-w-none touch-none"
                />
              </div>

              {/* Flush Pixel Stamp directly below canvas */}
              <div className="px-3 py-1 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
                <span className="type-mono text-[var(--ink)]">
                  {dimsLabel ? `${dimsLabel} · ` : ''}
                  {(item.format || 'png').toUpperCase()} · {Math.round(zoomLevel * 100)}%
                </span>
                <span className="type-mono text-[var(--ink-muted)]">
                  {annotations.length} {annotations.length === 1 ? 'edit' : 'edits'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Narrow / Phone (< 768px) Toggleable Bottom Style Tray (edge-docked, never floating over canvas) */}
      {mobileTrayOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--surface)] p-4 max-h-[45vh] overflow-y-auto shrink-0">
          {styleControlsContent}
        </div>
      )}

      {/* Discard Confirmation Dialog */}
      {confirmDiscard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Keep editing"
            onClick={() => setConfirmDiscard(false)}
            className="absolute inset-0 bg-[var(--ink)] opacity-35 cursor-pointer"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-annotations-title"
            className="relative z-10 w-full max-w-[360px] rounded-[12px] bg-[var(--surface)] border border-[var(--border)] p-5 space-y-4"
          >
            <div className="space-y-1">
              <h2 id="discard-annotations-title" className="type-display-s text-[var(--ink)]">
                Discard unsaved annotations
              </h2>
              <p className="type-ui text-[var(--ink-muted)]">
                Your original capture remains in Gallery. Edits in this editor have not been saved.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-ui-medium cursor-pointer studio-focus"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline OCR Drawer */}
      {showOcr && (
        <OcrDrawer
          dataUrl={imageSrc}
          initialText={ocrTextOverride ?? item.ocrText}
          onSaveText={handleSaveOcrText}
          onClose={() => setShowOcr(false)}
        />
      )}
    </div>
  );
};
