import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Pencil,
  ScanText,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type { BatchReport, CaptureMode, HistoryItem } from '../types';
import { copyImageToClipboard, downloadDataUrl, getFullResolutionImage } from '../utils/storage';
import { exportPdf } from '../utils/pdf';
import {
  filterHistoryItems,
  formatCaptureReadout,
  formatTimestamp,
  type GalleryFilter,
  getModeLabel,
  safeHostname,
} from '../utils/studioFormat';
import { CaptureThumbnail } from './studio/CaptureThumbnail';

interface Props {
  history: HistoryItem[];
  onBack: () => void;
  onSelectPreview: (item: HistoryItem) => void;
  onSelectAnnotate?: (item: HistoryItem) => void;
  onSelectOcr?: (item: HistoryItem) => void;
  onSelectVerify?: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void | Promise<void>;
  onClearAll: () => void | Promise<void>;
  onOpenStudio?: () => void;
  recentBatchReport?: BatchReport | null;
  onDismissBatchBanner?: () => void;
  isFullTab?: boolean;
  onImportFiles?: (files: File[]) => void;
}

const ORDERED_MODES: CaptureMode[] = [
  'visible',
  'selection',
  'full',
  'element',
  'desktop',
  'alltabs',
  'urllist',
  'multisize',
  'annotated',
  'upload',
  'media',
];

export const HistoryDrawer: React.FC<Props> = React.memo(function HistoryDrawer({
  history,
  onBack,
  onSelectPreview,
  onSelectAnnotate,
  onSelectOcr,
  onSelectVerify,
  onDeleteItem,
  onClearAll,
  onOpenStudio,
  recentBatchReport,
  onDismissBatchBanner,
  isFullTab,
  onImportFiles,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<GalleryFilter>('all');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [imageError, setImageError] = useState('');
  const [visibleCount, setVisibleCount] = useState(40);

  useEffect(() => setVisibleCount(40), [search, activeFilter]);

  const originalFor = async (item: HistoryItem) => {
    const src = (await getFullResolutionImage(item.id)) || item.dataUrl;
    if (!src) {
      setImageError(`Original image unavailable for ${item.title}. Preview thumbnail only.`);
    }
    return src;
  };

  const filtered = useMemo(
    () => filterHistoryItems(history, search, activeFilter),
    [history, search, activeFilter]
  );

  const handleCopy = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    const imageSrc = await originalFor(item);
    if (!imageSrc) return;
    const success = await copyImageToClipboard(imageSrc);
    if (success) {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const handleDownload = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    const imageSrc = await originalFor(item);
    if (!imageSrc) return;
    const ext = item.format || 'png';
    const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    try {
      await downloadDataUrl(imageSrc, `${cleanTitle}_${Date.now()}.${ext}`);
      setActionMessage(`Saved "${item.title}".`);
    } catch (error) {
      setActionMessage(
        `Could not save "${item.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const handleDownloadAll = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (filtered.length === 0) return;

    setDownloadingAll(true);
    const failures: string[] = [];
    try {
      for (let idx = 0; idx < filtered.length; idx++) {
        const item = filtered[idx];
        const imageSrc = await originalFor(item);
        if (!imageSrc) return;
        const ext = item.format || 'png';
        const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
        try {
          await downloadDataUrl(imageSrc, `${cleanTitle}_${item.id.slice(-4)}.${ext}`);
        } catch {
          failures.push(item.title);
        }
        if (idx < filtered.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      setActionMessage(
        failures.length
          ? `Could not save ${failures.length} capture(s): ${failures.join(', ')}.`
          : `Exported ${filtered.length} capture(s).`
      );
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleExportAllPdf = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (filtered.length === 0 || exportingPdf) return;
    setExportingPdf(true);
    try {
      const sources: string[] = [];
      for (const item of filtered) {
        const src = await originalFor(item);
        if (!src) return;
        sources.push(src);
      }
      if (sources.length > 0) {
        await exportPdf(sources, `yoink_gallery_${sources.length}_captures`);
      }
    } catch (err) {
      setActionMessage(`PDF export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExportingPdf(false);
    }
  };

  const confirmClearAll = async () => {
    try {
      await onClearAll();
      setShowClearConfirm(false);
    } catch (error) {
      setActionMessage(
        `Could not clear history: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const confirmDelete = async (id: string) => {
    try {
      await onDeleteItem(id);
      setDeleteConfirmId(null);
    } catch (error) {
      setActionMessage(
        `Could not delete capture: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden">
      {/* 44px Header */}
      <header className="h-[44px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="h-8 px-2 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {onImportFiles && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? (Array.from(e.target.files) as File[]) : [];
                  e.target.value = '';
                  if (files.length > 0) onImportFiles(files);
                }}
              />
              <button
                id="gallery-upload-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload image"
                title="Upload image"
                className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
              >
                <Upload size={16} strokeWidth={1.5} />
              </button>
            </>
          )}

          {!isFullTab && onOpenStudio && (
            <button
              type="button"
              onClick={onOpenStudio}
              className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
            >
              <span>Studio</span>
              <ExternalLink size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
            </button>
          )}

          <span className="type-mono text-[var(--ink-muted)]">{history.length}</span>

          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              aria-label="Clear gallery"
              title="Clear all captures"
              className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </header>

      {/* Search & Mode Filter Bar */}
      {history.length > 0 && (
        <div className="px-4 py-3 bg-[var(--surface)] border-b border-[var(--border)] space-y-2 shrink-0">
          <div className="relative flex items-center">
            <Search
              size={16}
              strokeWidth={1.5}
              className="absolute left-3 text-[var(--ink-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search captures"
              aria-label="Search gallery"
              className="w-full h-9 pl-8 pr-8 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink)] placeholder:text-[var(--ink-muted)] select-text studio-focus"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              aria-pressed={activeFilter === 'all'}
              className={`h-7 px-2 rounded-[6px] border type-caption cursor-pointer studio-focus ${
                activeFilter === 'all'
                  ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                  : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
              }`}
            >
              All {history.length}
            </button>

            {ORDERED_MODES.map((mode) => {
              const count = history.filter((h) => h.mode === mode).length;
              if (count === 0) return null;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setActiveFilter(mode)}
                  aria-pressed={activeFilter === mode}
                  className={`h-7 px-2 rounded-[6px] border type-caption cursor-pointer studio-focus ${
                    activeFilter === mode
                      ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                      : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {getModeLabel(mode)} {count}
                </button>
              );
            })}

            {filtered.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                {filtered.length > 1 && (
                  <button
                    type="button"
                    onClick={handleDownloadAll}
                    disabled={downloadingAll}
                    className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                  >
                    <Download size={12} strokeWidth={1.5} />
                    <span>Export</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportAllPdf}
                  disabled={exportingPdf}
                  className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                >
                  <FileText size={12} strokeWidth={1.5} />
                  <span>PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alerts & Confirmations */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {imageError && (
          <div
            role="alert"
            className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] type-ui text-[var(--ink)] flex items-center justify-between gap-2"
          >
            <span>{imageError}</span>
            <button
              type="button"
              onClick={() => setImageError('')}
              className="type-caption text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {showClearConfirm && (
          <div className="p-3 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
            <p className="type-ui text-[var(--ink)]">
              Remove all {history.length} saved captures from local storage?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={confirmClearAll}
                className="h-8 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-caption cursor-pointer studio-focus"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] type-caption cursor-pointer studio-focus"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {recentBatchReport && (
          <div className="p-3 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {recentBatchReport.failures.length > 0 ? (
                  <XCircle size={16} strokeWidth={1.5} className="text-[var(--semantic-error)] shrink-0" />
                ) : (
                  <CheckCircle2 size={16} strokeWidth={1.5} className="text-[var(--semantic-valid)] shrink-0" />
                )}
                <span className="type-ui-medium text-[var(--ink)] truncate">
                  {recentBatchReport.count || 0} captured
                  {recentBatchReport.skipped.length ? ` · ${recentBatchReport.skipped.length} skipped` : ''}
                  {recentBatchReport.failures.length ? ` · ${recentBatchReport.failures.length} failed` : ''}
                </span>
              </div>
              {onDismissBatchBanner && (
                <button
                  type="button"
                  onClick={onDismissBatchBanner}
                  aria-label="Dismiss batch report"
                  className="text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer shrink-0"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>
        )}

        {actionMessage && (
          <div
            role="status"
            className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] type-mono text-[var(--ink-muted)] flex items-center justify-between gap-2"
          >
            <span className="truncate">{actionMessage}</span>
            <button
              type="button"
              onClick={() => setActionMessage('')}
              className="type-caption text-[var(--ink)] cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {history.length === 0 ? (
          <div className="p-6 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] text-center space-y-2">
            <ImageIcon size={16} strokeWidth={1.5} className="mx-auto text-[var(--ink-muted)]" />
            <h3 className="type-body-medium text-[var(--ink)]">No captures yet</h3>
            <p className="type-ui text-[var(--ink-muted)]">
              Run a capture from the command menu or press Alt+Shift+1 on any webpage.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center type-ui text-[var(--ink-muted)]">
            No captures match &ldquo;{search}&rdquo;.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.slice(0, visibleCount).map((item) => (
              <article
                key={item.id}
                onClick={() => onSelectPreview(item)}
                className="p-3 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--canvas)] transition-colors cursor-pointer space-y-2"
              >
                <div className="flex items-start gap-3">
                  <div className="w-16 h-12 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] overflow-hidden shrink-0">
                    <CaptureThumbnail item={item} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <h4 className="type-body-medium text-[var(--ink)] truncate">
                      {item.title || 'Untitled capture'}
                    </h4>
                    <p className="type-mono text-[var(--ink-muted)] truncate">
                      {formatCaptureReadout(item)}
                    </p>
                    <p className="type-mono text-[var(--ink-muted)] truncate">
                      {getModeLabel(item.mode)} · {safeHostname(item.url)} ·{' '}
                      {formatTimestamp(item.timestamp).short}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border)]">
                  {onSelectAnnotate && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAnnotate(item);
                      }}
                      className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                      <span>Edit</span>
                    </button>
                  )}

                  {onSelectOcr && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectOcr(item);
                      }}
                      className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                    >
                      <ScanText size={12} strokeWidth={1.5} />
                      <span>OCR</span>
                    </button>
                  )}

                  {onSelectVerify && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectVerify(item);
                      }}
                      className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                    >
                      <ShieldCheck size={12} strokeWidth={1.5} />
                      <span>Proof</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => handleCopy(e, item)}
                    className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                  >
                    {copiedId === item.id ? (
                      <Check size={12} strokeWidth={1.5} />
                    ) : (
                      <Copy size={12} strokeWidth={1.5} />
                    )}
                    <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDownload(e, item)}
                    className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer studio-focus"
                  >
                    <Download size={12} strokeWidth={1.5} />
                    <span>Save</span>
                  </button>

                  {deleteConfirmId === item.id ? (
                    <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => confirmDelete(item.id)}
                        className="h-7 px-2 rounded-[6px] bg-[var(--ink)] text-[var(--surface)] type-caption cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="h-7 px-2 rounded-[6px] text-[var(--ink-muted)] type-caption cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(item.id);
                      }}
                      aria-label={`Delete ${item.title}`}
                      className="ml-auto w-7 h-7 rounded-[6px] hover:bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </article>
            ))}

            {filtered.length > visibleCount && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 40)}
                className="w-full h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
              >
                Show more ({filtered.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
