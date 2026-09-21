import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, ExternalLink } from 'lucide-react';
import { HistoryItem } from '../types';
import { copyImageToClipboard, downloadDataUrl } from '../utils/storage';

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
}

export const ImagePreviewModal: React.FC<Props> = ({ item, onClose }) => {
  const [copied, setCopied] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!item) return null;

  const handleCopy = async () => {
    if (!item.dataUrl) return;
    const success = await copyImageToClipboard(item.dataUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!item.dataUrl) return;
    const ext = item.format || 'png';
    const filename = `${item.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}_${Date.now()}.${ext}`;
    downloadDataUrl(item.dataUrl, filename);
  };

  const handleOpenUrl = () => {
    if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/95 border-b border-zinc-800 text-white">
        <div className="flex items-center space-x-2 min-w-0 pr-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate text-zinc-100">{item.title}</h3>
            <p className="text-[11px] text-zinc-400 font-mono truncate">
              {item.width > 0 ? `${item.width} × ${item.height}px • ` : ''}
              {item.mode.toUpperCase()} • {new Date(item.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {item.url && (
            <button
              onClick={handleOpenUrl}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-medium transition cursor-pointer"
              title="Open source URL in new tab"
            >
              <ExternalLink size={14} />
              <span>Open URL</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-medium transition cursor-pointer"
            title="Copy image to clipboard"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition cursor-pointer"
            title="Download image"
          >
            <Download size={14} />
            <span>Download</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition cursor-pointer"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Image Preview Canvas */}
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-zinc-950/90">
        <img
          src={item.dataUrl}
          alt={item.title}
          className="max-w-full max-h-full object-contain rounded border border-zinc-800 shadow-2xl"
        />
      </div>

      {/* Footer Info */}
      {item.url && (
        <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
          <span className="truncate max-w-[280px]">{item.url}</span>
          <span className="font-mono uppercase text-zinc-500">{item.format.toUpperCase()}</span>
        </div>
      )}
    </div>
  );
};
