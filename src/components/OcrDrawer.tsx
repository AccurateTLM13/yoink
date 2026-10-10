import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  ScanText,
  Save,
  Loader2,
  Sparkles,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { extractOcrText, OcrResult } from '../utils/ai';

interface Props {
  dataUrl: string;
  initialText?: string;
  onSaveText?: (text: string) => void;
  onClose: () => void;
}

export const OcrDrawer: React.FC<Props> = ({
  dataUrl,
  initialText,
  onSaveText,
  onClose,
}) => {
  const [text, setText] = useState<string>(initialText || '');
  const [isScanning, setIsScanning] = useState<boolean>(!initialText);
  const [copied, setCopied] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [engine, setEngine] = useState<string>('shape-detection');
  const [error, setError] = useState<string | null>(null);

  const performScan = async () => {
    setIsScanning(true);
    setError(null);
    try {
      const res: OcrResult = await extractOcrText(dataUrl);
      setText(res.text);
      setEngine(res.engine);
    } catch (err: any) {
      setError(err.message || 'OCR extraction failed');
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!initialText) {
      performScan();
    }
  }, [dataUrl]);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleSave = () => {
    if (onSaveText) {
      onSaveText(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const lineCount = text ? text.split('\n').length : 0;
  const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Text Extraction (OCR)"
      className="fixed inset-y-0 right-0 z-60 w-full max-w-md bg-white border-l border-zinc-200/90 shadow-2xl flex flex-col font-sans select-none animate-in slide-in-from-right-4 duration-200"
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-zinc-50/80">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <ScanText size={16} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-zinc-900 leading-tight">
              Text Extraction (OCR)
            </h3>
            <span className="text-[10.5px] font-mono text-zinc-500">
              {engine === 'shape-detection'
                ? 'Offline Native Shape Detection'
                : engine === 'byok'
                ? 'BYOK Vision Model'
                : 'Local Canvas Scanner'}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-200/60 transition cursor-pointer"
          title="Close drawer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100 bg-white text-xs">
        <div className="flex items-center gap-2 text-zinc-500 font-mono text-[11px]">
          <span>{wordCount} words</span>
          <span>•</span>
          <span>{lineCount} lines</span>
          <span>•</span>
          <span>{text.length} chars</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={performScan}
            disabled={isScanning}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition cursor-pointer disabled:opacity-50"
            title="Re-scan image"
          >
            {isScanning ? <Loader2 size={12} className="animate-spin" /> : <ScanText size={12} />}
            <span>{isScanning ? 'Scanning…' : 'Re-scan'}</span>
          </button>

          <button
            onClick={handleCopy}
            disabled={!text}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Copy text to clipboard"
          >
            {copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy Text'}</span>
          </button>

          {onSaveText && (
            <button
              onClick={handleSave}
              disabled={!text}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition cursor-pointer disabled:opacity-50"
              title="Save recognized text to capture note"
            >
              {saved ? <Check size={12} className="text-emerald-600" /> : <Save size={12} />}
              <span>{saved ? 'Saved' : 'Save'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 flex flex-col min-h-0 bg-[#fbfbfd]">
        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {isScanning ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <Loader2 size={32} className="text-blue-600 animate-spin" />
            <div>
              <h4 className="text-sm font-semibold text-zinc-800">
                Scanning pixels for text…
              </h4>
              <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                Running optical character detection directly in your browser. No image data is sent to external servers.
              </p>
            </div>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="No text detected in this capture."
            className="flex-1 w-full p-3 font-mono text-xs text-zinc-900 bg-white border border-zinc-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 leading-relaxed scrollbar-thin select-text"
          />
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2.5 border-t border-zinc-200/80 bg-zinc-50 text-[11px] text-zinc-500 flex items-center justify-between font-mono">
        <span className="flex items-center gap-1">
          <Sparkles size={11} className="text-blue-600" />
          <span>Yoink Local Intelligence (Free)</span>
        </span>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-900 font-semibold cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
};
