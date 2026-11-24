import React, { useState, useEffect, useCallback } from 'react';
import {
  Check,
  Copy,
  Download,
  FileImage,
  FileText,
  Layers,
  Pencil,
  RotateCcw,
  ScanText,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { HistoryItem } from '../types';
import {
  copyImageToClipboard,
  downloadDataUrl,
  getFullResolutionImage,
  updateStoredHistoryItem,
} from '../utils/storage';
import { exportPdf } from '../utils/pdf';
import { downloadImageSlices } from '../utils/slicer';
import { formatDimensions, formatTimestamp, getModeLabel, safeHostname } from '../utils/studioFormat';
import { AnnotationEditor } from './AnnotationEditor';
import { OcrDrawer } from './OcrDrawer';
import { VerifyModal } from './VerifyModal';

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
  onSaved?: (newItem: HistoryItem) => void;
  initialAnnotating?: boolean;
  initialOcr?: boolean;
  onOpenAnnotate?: (item: HistoryItem) => void;
  maxSliceHeight?: number;
}

export const ImagePreviewModal: React.FC<Props> = ({
  item,
  onClose,
  onSaved,
  initialAnnotating = false,
  initialOcr = false,
  onOpenAnnotate,
  maxSliceHeight = 4000,
}) => {
  const [copied, setCopied] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(initialAnnotating);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [slicing, setSlicing] = useState(false);
  const [showOcr, setShowOcr] = useState(initialOcr);
  const [showVerify, setShowVerify] = useState(false);
  const [verifyDataUrl, setVerifyDataUrl] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [actionError, setActionError] = useState('');
  const initialFull = item?.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null;
  const [fullImage, setFullImage] = useState<string | null>(initialFull);
  const [measuredDims, setMeasuredDims] = useState<{ id: string; width: number; height: number } | null>(
    null
  );
  const [ocrTextOverride, setOcrTextOverride] = useState<{ id: string; text: string } | null>(null);

  const dimensions =
    measuredDims && item && measuredDims.id === item.id
      ? { width: measuredDims.width, height: measuredDims.height }
      : { width: item?.width || 0, height: item?.height || 0 };

  const handleSaveOcrText = async (newText: string) => {
    if (!item) return;
    setOcrTextOverride({ id: item.id, text: newText });
    await updateStoredHistoryItem(item.id, { ocrText: newText });
    onSaved?.({ ...item, ocrText: newText });
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAnnotating || showVerify) return;
        if (showOcr) setShowOcr(false);
        else onClose();
      }
    },
    [onClose, isAnnotating, showOcr, showVerify]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!item) return;
    let isMounted = true;
    if (item.dataUrl && item.dataUrl.length > 0) {
      setFullImage(item.dataUrl);
      setLoadingOriginal(false);
    } else {
      setFullImage(null);
      setLoadingOriginal(true);
    }
    getFullResolutionImage(item.id)
      .then((full) => {
        if (isMounted && full) setFullImage(full);
        if (isMounted) setLoadingOriginal(false);
      })
      .catch(() => {
        if (isMounted) setLoadingOriginal(false);
      });
    return () => {
      isMounted = false;
    };
  }, [item]);

  if (!item) return null;

  const currentImage = fullImage || item.dataUrl;
  const previewImage = currentImage || item.thumbnailUrl;

  if (isAnnotating && currentImage) {
    return (
      <AnnotationEditor
        item={item}
        imageSrc={currentImage}
        onClose={() => setIsAnnotating(false)}
        onOcrSaved={onSaved}
        onSaved={(newItem) => {
          if (onSaved) onSaved(newItem);
          setIsAnnotating(false);
        }}
      />
    );
  }

  const handleOpenVerify = async () => {
    let targetUrl = fullImage || (item.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null);
    if (!targetUrl) {
      const loaded = await getFullResolutionImage(item.id);
      if (loaded) {
        setFullImage(loaded);
        targetUrl = loaded;
      }
    }
    if (!targetUrl) {
      setActionError('The original image is unavailable.');
      return;
    }
    setVerifyDataUrl(targetUrl);
    setShowVerify(true);
  };

  const handleCopy = async () => {
    let targetUrl = fullImage || (item.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null);
    if (!targetUrl) {
      targetUrl = (await getFullResolutionImage(item.id)) || currentImage;
    }
    if (!targetUrl) return;
    const success = await copyImageToClipboard(targetUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = async () => {
    let targetUrl = fullImage || (item.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null);
    if (!targetUrl) {
      targetUrl = (await getFullResolutionImage(item.id)) || currentImage;
    }
    if (!targetUrl) return;
    const ext = item.format || 'png';
    const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    try {
      await downloadDataUrl(targetUrl, `${cleanTitle}_${Date.now()}.${ext}`);
      setActionError('');
    } catch (error) {
      setActionError(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleExportPdf = async () => {
    if (!currentImage || exportingPdf) return;
    setExportingPdf(true);
    try {
      await exportPdf([currentImage], item.title || 'capture');
    } catch (err) {
      setActionError(`PDF export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDownloadSlices = async () => {
    if (!currentImage || slicing) return;
    setSlicing(true);
    try {
      const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      await downloadImageSlices(currentImage, cleanTitle, maxSliceHeight || 4000, item.format || 'png');
    } catch (err) {
      setActionError(`Slice export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSlicing(false);
    }
  };

  const dimsLabel = formatDimensions(dimensions.width, dimensions.height);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title || 'Image preview'}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden"
    >
      {/* Edge-Docked 44px Top Toolbar */}
      <header className="h-[44px] px-3 md:px-4 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between gap-3 overflow-x-auto shrink-0">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <FileImage size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
          <span className="type-ui-medium text-[var(--ink)] truncate max-w-[160px] md:max-w-[260px]">
            {item.title || 'Untitled capture'}
          </span>
          {dimsLabel && (
            <span className="hidden sm:inline type-mono text-[var(--ink-muted)]">{dimsLabel}</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Zoom Controls */}
          <div className="flex items-center gap-1 pr-2 border-r border-[var(--border)]">
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.5))}
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
              onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 3))}
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

          {/* Single Primary CTA: Annotate */}
          <button
            type="button"
            onClick={() => (onOpenAnnotate ? onOpenAnnotate(item) : setIsAnnotating(true))}
            disabled={!currentImage}
            className="h-8 px-3 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <Pencil size={16} strokeWidth={1.5} />
            <span>Annotate</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!currentImage}
            className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exportingPdf || !currentImage}
            className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <FileText size={16} strokeWidth={1.5} />
            <span>{exportingPdf ? 'Building…' : 'PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadSlices}
            disabled={slicing || !currentImage}
            className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <Layers size={16} strokeWidth={1.5} />
            <span>{slicing ? 'Slicing…' : 'Slices'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowOcr(true)}
            disabled={!currentImage}
            className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <ScanText size={16} strokeWidth={1.5} />
            <span>OCR</span>
          </button>

          <button
            type="button"
            onClick={handleOpenVerify}
            disabled={!currentImage}
            className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <ShieldCheck size={16} strokeWidth={1.5} />
            <span>Proof</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!currentImage}
            className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <Download size={16} strokeWidth={1.5} />
            <span>Save</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            title="Close (Esc)"
            className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {(item.warning || actionError || (!currentImage && !loadingOriginal)) && (
        <div
          role="status"
          className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] type-ui text-[var(--ink)] shrink-0"
        >
          {actionError ||
            item.warning ||
            'The original image is unavailable. Export and editing require the original.'}
        </div>
      )}

      {/* Full-Bleed Canvas Viewport */}
      <div className="flex-1 overflow-auto p-4 md:p-6 flex items-center justify-center bg-[var(--canvas)]">
        <div
          className="origin-center flex items-center justify-center max-w-full max-h-full"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {previewImage ? (
            <div className="p-2 rounded-[12px] bg-[var(--surface)] border border-[var(--border)]">
              <img
                src={previewImage}
                alt={item.title || 'Captured screenshot'}
                onLoad={(e) => {
                  const target = e.currentTarget;
                  if (!dimensions.width || !dimensions.height) {
                    setMeasuredDims({
                      id: item.id,
                      width: target.naturalWidth,
                      height: target.naturalHeight,
                    });
                  }
                }}
                className="max-w-[90vw] max-h-[76vh] object-contain rounded-[4px] border border-[var(--border)] block"
              />
            </div>
          ) : (
            <div className="p-8 text-center space-y-2 text-[var(--ink-muted)]">
              <FileImage size={16} strokeWidth={1.5} className="mx-auto" />
              <p className="type-ui">Image data unavailable</p>
            </div>
          )}
        </div>
      </div>

      {/* 40px Docked Footer Readout */}
      <footer className="h-[40px] px-4 bg-[var(--surface)] border-t border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
        <span className="type-mono text-[var(--ink-muted)] truncate">
          {safeHostname(item.url)} · {getModeLabel(item.mode)} · {formatTimestamp(item.timestamp).short}
        </span>
        <span className="type-mono text-[var(--ink-muted)] shrink-0">
          {(item.format || 'png').toUpperCase()} · Esc to close
        </span>
      </footer>

      {showVerify && (verifyDataUrl || currentImage) && (
        <VerifyModal
          initialDataUrl={verifyDataUrl || currentImage}
          initialTitle={item.title}
          onClose={() => setShowVerify(false)}
        />
      )}
      {showOcr && currentImage && (
        <OcrDrawer
          dataUrl={currentImage}
          initialText={ocrTextOverride?.id === item.id ? ocrTextOverride.text : item.ocrText}
          onSaveText={handleSaveOcrText}
          onClose={() => setShowOcr(false)}
        />
      )}
    </div>
  );
};
