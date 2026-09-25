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
} from 'lucide-react';
import { HistoryItem } from '../types';
import { copyImageToClipboard, downloadDataUrl, getFullResolutionImage } from '../utils/storage';

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
}

export const ImagePreviewModal: React.FC<Props> = ({ item, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [fullImage, setFullImage] = useState<string | null>(item?.dataUrl || item?.thumbnailUrl || null);

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
    getFullResolutionImage(item.id).then((full) => {
      if (isMounted && full) {
        setFullImage(full);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [item]);

  if (!item) return null;

  const currentImage = fullImage || item.dataUrl || item.thumbnailUrl;

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
              {item.width > 0 ? `${item.width} × ${item.height}px • ` : ''}
              {item.mode.toUpperCase()} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 shrink-0">
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
    </div>
  );
};
