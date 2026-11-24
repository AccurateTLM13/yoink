import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Save,
  ScanText,
  X,
} from 'lucide-react';
import { extractOcrText, type OcrResult } from '../utils/ai';

interface Props {
  dataUrl: string;
  initialText?: string;
  onSaveText?: (text: string) => void | Promise<void>;
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

  const performScan = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    try {
      const res: OcrResult = await extractOcrText(dataUrl);
      setText(res.text);
      setEngine(res.engine);
      if (res.status === 'unavailable' || res.status === 'empty') {
        setError(res.message || null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OCR extraction failed.');
    } finally {
      setIsScanning(false);
    }
  }, [dataUrl]);

  useEffect(() => {
    if (!initialText) {
      void performScan();
    }
  }, [initialText, performScan]);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy text to clipboard.');
    }
  };

  const handleSave = async () => {
    if (!onSaveText) return;
    try {
      await onSaveText(text);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(`Could not save text: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const lineCount = text ? text.split('\n').length : 0;
  const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Offline text extraction (OCR)"
      className="fixed inset-y-0 right-0 z-60 w-full max-w-[380px] bg-[var(--surface)] text-[var(--ink)] border-l border-[var(--border)] flex flex-col select-none"
    >
      {/* Header */}
      <header className="h-[56px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ScanText size={16} strokeWidth={1.5} className="text-[var(--ink)] shrink-0" />
          <div className="min-w-0">
            <h3 className="type-body-medium text-[var(--ink)] truncate">Offline OCR</h3>
            <p className="type-mono text-[var(--ink-muted)] truncate">
              {engine === 'shape-detection'
                ? 'Browser Shape Detection'
                : engine === 'tesseract'
                ? 'Local Tesseract WASM'
                : 'OCR unavailable'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close OCR drawer"
          className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </header>

      {/* Metrics & Action Toolbar */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--canvas)] space-y-2 shrink-0">
        <div className="type-mono text-[var(--ink-muted)]">
          {wordCount} words · {lineCount} lines · {text.length} chars
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!text}
            className="h-8 px-3 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
            <span>{copied ? 'Copied' : 'Copy text'}</span>
          </button>

          <button
            type="button"
            onClick={performScan}
            disabled={isScanning}
            className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            {isScanning ? (
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <ScanText size={16} strokeWidth={1.5} />
            )}
            <span>{isScanning ? 'Scanning…' : 'Re-scan'}</span>
          </button>

          {onSaveText && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!text}
              className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
            >
              {saved ? <Check size={16} strokeWidth={1.5} /> : <Save size={16} strokeWidth={1.5} />}
              <span>{saved ? 'Saved' : 'Save'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Editable Text Area */}
      <div className="flex-1 p-4 flex flex-col min-h-0 bg-[var(--canvas)] space-y-3">
        {error && (
          <div
            role="alert"
            className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] flex items-start gap-2"
          >
            <AlertCircle
              size={16}
              strokeWidth={1.5}
              className="text-[var(--semantic-error)] shrink-0 mt-0.5"
            />
            <span className="type-ui text-[var(--ink)]">{error}</span>
          </div>
        )}

        {isScanning ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)]" />
            <div className="space-y-1">
              <h4 className="type-body-medium text-[var(--ink)]">Scanning pixels locally…</h4>
              <p className="type-ui text-[var(--ink-muted)] max-w-[260px]">
                Optical character detection runs on-device with zero network uploads.
              </p>
            </div>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Extracted OCR text"
            placeholder="No text detected in this capture."
            className="flex-1 w-full p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] type-mono text-[var(--ink)] placeholder:text-[var(--ink-muted)] resize-none select-text studio-focus"
          />
        )}
      </div>

      {/* Footer */}
      <footer className="h-[40px] px-4 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
        <span className="type-mono text-[var(--ink-muted)]">100% local processing</span>
        <button
          type="button"
          onClick={onClose}
          className="type-ui-medium text-[var(--ink)] hover:text-[var(--ink-muted)] cursor-pointer studio-focus rounded-[4px]"
        >
          Done
        </button>
      </footer>
    </div>
  );
};
