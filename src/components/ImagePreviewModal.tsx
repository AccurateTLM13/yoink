import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileImage,
  ExternalLink,
  RotateCcw,
  Pencil,
  FileText,
  ScanText,
  Layers,
} from 'lucide-react';
import { HistoryItem } from '../types';
import { copyImageToClipboard, downloadDataUrl, getFullResolutionImage, updateStoredHistoryItem } from '../utils/storage';
import { exportPdf } from '../utils/pdf';
import { downloadImageSlices } from '../utils/slicer';
import { AnnotationEditor } from './AnnotationEditor';
import { OcrDrawer } from './OcrDrawer';

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
  onSaved?: (newItem: HistoryItem) => void;
  initialAnnotating?: boolean;
  initialOcr?: boolean;
}

export const ImagePreviewModal: React.FC<Props> = ({
  item,
  onClose,
  onSaved,
  initialAnnotating = false,
  initialOcr = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(initialAnnotating);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [slicing, setSlicing] = useState(false);
  const [showOcr, setShowOcr] = useState(initialOcr);
  const [zoomLevel, setZoomLevel] = useState(1);
  const initial = (item?.dataUrl && item.dataUrl.length > 50000) ? item.dataUrl : (item?.dataUrl || item?.thumbnailUrl || null);
  const [fullImage, setFullImage] = useState<string | null>(initial);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: item?.width || 0,
    height: item?.height || 0,
  });

  const handleSaveOcrText = async (newText: string) => {
    if (!item) return;
    item.ocrText = newText;
    await updateStoredHistoryItem(item.id, { ocrText: newText });
    if (onSaved) {
      onSaved({ ...item, ocrText: newText });
    }
  };

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Load full-resolution image asynchronously if separated from index
  useEffect(() => {
    if (!item) return;
    let isMounted = true;
    const init = (item.dataUrl && item.dataUrl.length > 50000) ? item.dataUrl : (item.dataUrl || item.thumbnailUrl);
    if (init) {
      setFullImage(init);
    }
    if (item.width && item.height) {
      setDimensions({ width: item.width, height: item.height });
    }
    getFullResolutionImage(item.id).then((full) => {
      if (isMounted && full) {
        setFullImage(full);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [item?.id, item?.dataUrl, item?.thumbnailUrl, item?.width, item?.height]);

  if (!item) return null;

  const currentImage = fullImage || item.dataUrl || item.thumbnailUrl;

  if (isAnnotating && currentImage) {
    return (
      <AnnotationEditor
        item={item}
        imageSrc={currentImage}
        onClose={() => setIsAnnotating(false)}
        onSaved={(newItem) => {
          if (onSaved) onSaved(newItem);
          setIsAnnotating(false);
        }}
      />
    );
  }

  const handleCopy = async () => {
    if (!currentImage) return;
    const success = await copyImageToClipboard(currentImage);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!currentImage) return;
    const ext = item.format || 'png';
    const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const filename = `${cleanTitle}_${Date.now()}.${ext}`;
    downloadDataUrl(currentImage, filename);
  };

  const handleExportPdf = async () => {
    if (!currentImage || exportingPdf) return;
    setExportingPdf(true);
    try {
      await exportPdf([currentImage], item.title || 'capture');
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDownloadSlices = async () => {
    if (!currentImage || slicing) return;
    setSlicing(true);
    try {
      const cleanTitle = (item?.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      await downloadImageSlices(currentImage, cleanTitle, 4000, item?.format || 'png');
    } catch (err) {
      console.error('Image slicing failed:', err);
    } finally {
      setSlicing(false);
    }
  };

  const zoomIn = () => setZoomLevel((z) => Math.min(z + 0.25, 3));
  const zoomOut = () => setZoomLevel((z) => Math.max(z - 0.25, 0.5));
  const resetZoom = () => setZoomLevel(1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-sans select-none"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/95 border-b border-zinc-800/80 text-white">
        <div className="flex items-center space-x-2.5 min-w-0 pr-3">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <FileImage size={15} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold truncate text-zinc-100 leading-tight">
              {item.title}
            </h3>
            <p className="text-[10px] text-zinc-400 font-mono truncate tabular-nums">
              {dimensions.width > 0 ? `${dimensions.width} × ${dimensions.height}px • ` : ''}
              {item.mode.toUpperCase()} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {/* Annotate / Redact Button */}
          <button
            onClick={() => setIsAnnotating(true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs mr-1"
            title="Open Annotation & Redaction Studio (P0-1 // P0-3)"
          >
            <Pencil size={13} />
            <span>Annotate & Redact</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-zinc-800/90 rounded-lg p-0.5 border border-zinc-700/60 mr-1 text-zinc-300">
            <button
              onClick={zoomOut}
              className="p-1 hover:text-white hover:bg-zinc-700 rounded transition cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut size={13} />
            </button>
            <span className="px-1.5 text-[10px] font-mono tabular-nums text-zinc-300 min-w-[34px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="p-1 hover:text-white hover:bg-zinc-700 rounded transition cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn size={13} />
            </button>
            {zoomLevel !== 1 && (
              <button
                onClick={resetZoom}
                className="p-1 hover:text-white hover:bg-zinc-700 rounded transition cursor-pointer text-zinc-400"
                title="Reset Zoom"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition cursor-pointer border border-zinc-700/60"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check size={13} className="text-emerald-400" />
            ) : (
              <Copy size={13} />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* PDF Export Button (P0-2) */}
          <button
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-zinc-200 rounded-lg text-xs font-medium transition cursor-pointer border border-zinc-700/60"
            title="Export as PDF (tall pages split across A4 pages)"
          >
            <FileText size={13} />
            <span>{exportingPdf ? 'Building…' : 'PDF'}</span>
          </button>

          {/* Slices Button (Anti-Squish multi-part export) */}
          <button
            onClick={handleDownloadSlices}
            disabled={slicing}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-zinc-200 rounded-lg text-xs font-medium transition cursor-pointer border border-zinc-700/60"
            title="Split tall image into web-friendly parts (max 4,000px per part) so upload platforms don't squash it"
          >
            <Layers size={13} />
            <span>{slicing ? 'Slicing…' : 'Slices'}</span>
          </button>

          {/* Extract Text / OCR Button (P2-9) */}
          <button
            onClick={() => setShowOcr(true)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
              showOcr
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/60'
            }`}
            title="Extract text from capture (Offline OCR // Shape Detection API)"
          >
            <ScanText size={13} />
            <span>OCR</span>
          </button>

          {/* Download Button */}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs"
            title="Download image file"
          >
            <Download size={13} />
            <span>Download</span>
          </button>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition cursor-pointer ml-1"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Image Viewport with smooth scroll & zoom */}
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-zinc-950/80">
        <div
          className="transition-transform duration-150 ease-out origin-center flex items-center justify-center max-w-full max-h-full"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {currentImage ? (
            <img
              src={currentImage}
              alt={item.title}
              onLoad={(e) => {
                const target = e.currentTarget;
                if (!dimensions.width || !dimensions.height) {
                  setDimensions({ width: target.naturalWidth, height: target.naturalHeight });
                }
              }}
              className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg border border-zinc-800 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
            />
          ) : (
            <div className="p-8 text-zinc-500 text-center">
              <FileImage size={40} className="mx-auto mb-2 opacity-50" />
              <p className="text-xs">Image data unavailable</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 bg-zinc-900/95 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400 font-mono">
        <span className="truncate max-w-[400px]">
          {item.url || 'local-tab'}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <span>{item.format.toUpperCase()}</span>
          <span className="text-zinc-500">•</span>
          <span>Press ESC to close</span>
        </div>
      </div>

      {/* OCR Drawer (P2-9) */}
      {showOcr && currentImage && (
        <OcrDrawer
          dataUrl={currentImage}
          initialText={item.ocrText}
          onSaveText={handleSaveOcrText}
          onClose={() => setShowOcr(false)}
        />
      )}
    </div>
  );
};
