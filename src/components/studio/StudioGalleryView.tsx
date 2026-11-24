import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type { BatchReport, CaptureMode, CaptureSettings, HistoryItem } from '../../types';
import {
  computeLibrarySummary,
  filterHistoryItems,
  formatTimestamp,
  type GalleryFilter,
  getModeLabel,
  safeHostname,
} from '../../utils/studioFormat';
import { copyImageToClipboard, downloadDataUrl, getFullResolutionImage } from '../../utils/storage';
import { exportPdf } from '../../utils/pdf';
import { CropReticleFrame } from './CropReticleFrame';

const ORDERED_MODES: CaptureMode[] = [
  'full',
  'visible',
  'selection',
  'element',
  'desktop',
  'alltabs',
  'urllist',
  'multisize',
  'annotated',
  'upload',
  'media',
];

interface StudioGalleryViewProps {
  history: HistoryItem[];
  settings: CaptureSettings;
  selectedItemId: string | null;
  hasInspectorPrimaryCta: boolean;
  recentBatchReport?: BatchReport | null;
  onDismissBatchBanner?: () => void;
  onSelectItem: (item: HistoryItem) => void;
  onSelectPreview: (item: HistoryItem) => void;
  onSelectAnnotate: (item: HistoryItem) => void;
  onClearAll: () => void | Promise<void>;
  onImportFiles: (files: File[]) => void;
}

export const StudioGalleryView: React.FC<StudioGalleryViewProps> = ({
  history,
  settings,
  selectedItemId,
  hasInspectorPrimaryCta,
  recentBatchReport,
  onDismissBatchBanner,
  onSelectItem,
  onSelectPreview,
  onSelectAnnotate,
  onClearAll,
  onImportFiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<GalleryFilter>('all');
  const [visibleCount, setVisibleCount] = useState(40);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [errorNote, setErrorNote] = useState('');

  useEffect(() => {
    setVisibleCount(40);
  }, [search, activeFilter]);

  const summary = useMemo(() => computeLibrarySummary(history), [history]);
  const filtered = useMemo(
    () => filterHistoryItems(history, search, activeFilter),
    [history, search, activeFilter]
  );

  const resolveOriginal = async (item: HistoryItem): Promise<string | null> => {
    const src = (await getFullResolutionImage(item.id)) || item.dataUrl;
    if (!src) {
      setErrorNote(`Original image unavailable for ${item.title}. Preview thumbnail only.`);
      return null;
    }
    return src;
  };

  const handleCopy = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    const src = await resolveOriginal(item);
    if (!src) return;
    const ok = await copyImageToClipboard(src);
    if (ok) {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const handleDownload = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    const src = await resolveOriginal(item);
    if (!src) return;
    const ext = item.format || 'png';
    const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    try {
      await downloadDataUrl(src, `${cleanTitle}_${Date.now()}.${ext}`, { settings });
      setStatusNote(`Saved "${item.title || 'capture'}".`);
    } catch (err) {
      setErrorNote(err instanceof Error ? err.message : 'Could not save capture.');
    }
  };

  const handleDownloadAll = async () => {
    if (filtered.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    const failures: string[] = [];
    try {
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const src = await resolveOriginal(item);
        if (!src) {
          return;
        }
        const ext = item.format || 'png';
        const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
        try {
          await downloadDataUrl(src, `${cleanTitle}_${item.id.slice(-4)}.${ext}`, { settings });
        } catch {
          failures.push(item.title || item.id);
        }
        if (i < filtered.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      setStatusNote(
        failures.length > 0
          ? `Could not save ${failures.length} capture(s): ${failures.join(', ')}.`
          : `Exported ${filtered.length} capture(s).`
      );
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleExportPdf = async () => {
    if (filtered.length === 0 || exportingPdf) return;
    setExportingPdf(true);
    try {
      const sources: string[] = [];
      for (const item of filtered) {
        const src = await resolveOriginal(item);
        if (!src) return;
        sources.push(src);
      }
      if (sources.length > 0) {
        await exportPdf(sources, `yoink_gallery_${sources.length}_captures`);
        setStatusNote(`Exported ${sources.length} capture(s) to PDF.`);
      }
    } catch (err) {
      setErrorNote(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleConfirmClearAll = async () => {
    try {
      await onClearAll();
      setShowClearConfirm(false);
      setStatusNote('Gallery cleared.');
    } catch (err) {
      setErrorNote(err instanceof Error ? err.message : 'Could not clear gallery.');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length > 0) onImportFiles(files);
        }}
      />

      {/* Edge-docked Search, Filter & Batch Export Bar */}
      <div className="bg-[var(--surface)] border-b border-[var(--border)] px-4 md:px-6 py-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 min-w-0 flex items-center">
            <Search
              size={16}
              strokeWidth={1.5}
              className="absolute left-3 text-[var(--ink-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, URL, or OCR"
              aria-label="Search gallery"
              className="w-full h-9 pl-8 pr-8 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink)] placeholder:text-[var(--ink-muted)] select-text studio-focus"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 w-6 h-6 rounded-[4px] flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer studio-focus"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
            <button
              id="gallery-upload-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus"
            >
              <Upload size={16} strokeWidth={1.5} />
              <span>Upload</span>
            </button>

            {filtered.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloadingAll}
                  className={`h-9 px-3 rounded-[8px] type-ui-medium flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-colors studio-focus ${
                    !hasInspectorPrimaryCta
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)]'
                  }`}
                >
                  <Download size={16} strokeWidth={1.5} />
                  <span>{downloadingAll ? 'Exporting…' : `Export (${filtered.length})`}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={exportingPdf}
                  className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-colors studio-focus"
                >
                  <FileText size={16} strokeWidth={1.5} />
                  <span>{exportingPdf ? 'Building…' : 'PDF'}</span>
                </button>
              </>
            )}

            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                <Trash2 size={16} strokeWidth={1.5} />
                <span>Clear all</span>
              </button>
            )}
          </div>
        </div>

        {/* Wrapping filter chips — zero sideways scroll at 400px */}
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter captures">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              aria-pressed={activeFilter === 'all'}
              className={`h-8 px-3 rounded-[6px] border type-caption flex items-center gap-2 cursor-pointer transition-colors studio-focus ${
                activeFilter === 'all'
                  ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                  : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
              }`}
            >
              <span>All</span>
              <span className="type-mono">{history.length}</span>
            </button>

            {summary.signedCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter('signed')}
                aria-pressed={activeFilter === 'signed'}
                className={`h-8 px-3 rounded-[6px] border type-caption flex items-center gap-2 cursor-pointer transition-colors studio-focus ${
                  activeFilter === 'signed'
                    ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                    : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
                }`}
              >
                <span>Proof signed</span>
                <span className="type-mono">{summary.signedCount}</span>
              </button>
            )}

            {ORDERED_MODES.map((mode) => {
              const count = summary.modeCounts[mode] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setActiveFilter(mode)}
                  aria-pressed={activeFilter === mode}
                  className={`h-8 px-3 rounded-[6px] border type-caption flex items-center gap-2 cursor-pointer transition-colors studio-focus ${
                    activeFilter === mode
                      ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                      : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  <span>{getModeLabel(mode)}</span>
                  <span className="type-mono">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable Gallery Content */}
      <div className="flex-1 p-4 md:p-6 space-y-5">
        {showClearConfirm && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="type-body-medium text-[var(--ink)]">Clear all saved captures</h3>
              <p className="type-ui text-[var(--ink-muted)]">
                This removes all {history.length} captures from local gallery storage.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleConfirmClearAll}
                className="h-9 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-ui-medium cursor-pointer studio-focus"
              >
                Confirm clear
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {recentBatchReport && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {recentBatchReport.failures.length > 0 ? (
                  <XCircle
                    size={16}
                    strokeWidth={1.5}
                    className="text-[var(--semantic-error)] shrink-0"
                  />
                ) : (
                  <CheckCircle2
                    size={16}
                    strokeWidth={1.5}
                    className="text-[var(--semantic-valid)] shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="type-body-medium text-[var(--ink)] tabular-nums">
                    {recentBatchReport.count || 0} captured
                    {recentBatchReport.skipped.length > 0
                      ? ` · ${recentBatchReport.skipped.length} skipped`
                      : ''}
                    {recentBatchReport.failures.length > 0
                      ? ` · ${recentBatchReport.failures.length} failed`
                      : ''}
                  </div>
                  <p className="type-ui text-[var(--ink-muted)]">
                    Batch run indexed in Gallery.
                  </p>
                </div>
              </div>

              {onDismissBatchBanner && (
                <button
                  type="button"
                  onClick={onDismissBatchBanner}
                  aria-label="Dismiss batch report"
                  className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {(recentBatchReport.captured.length > 0 ||
              recentBatchReport.skipped.length > 0 ||
              recentBatchReport.failures.length > 0) && (
              <details className="border-t border-[var(--border)] pt-3">
                <summary className="type-caption text-[var(--ink)] cursor-pointer">
                  Completion log
                </summary>
                <ul className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                  {recentBatchReport.captured.map((entry, idx) => (
                    <li
                      key={`cap-${idx}-${entry.target}`}
                      className="flex items-start gap-2 type-mono text-[var(--ink)]"
                    >
                      <CheckCircle2
                        size={16}
                        strokeWidth={1.5}
                        className="text-[var(--semantic-valid)] shrink-0 mt-0.5"
                      />
                      <span className="break-words">
                        {entry.target}
                        {entry.reason ? ` — ${entry.reason}` : ''}
                      </span>
                    </li>
                  ))}
                  {recentBatchReport.skipped.map((entry, idx) => (
                    <li
                      key={`skip-${idx}-${entry.target}`}
                      className="type-mono text-[var(--ink-muted)] break-words"
                    >
                      Skipped · {entry.target}: {entry.reason}
                    </li>
                  ))}
                  {recentBatchReport.failures.map((entry, idx) => (
                    <li
                      key={`fail-${idx}-${entry.target}`}
                      className="flex items-start gap-2 type-mono text-[var(--ink)]"
                    >
                      <XCircle
                        size={16}
                        strokeWidth={1.5}
                        className="text-[var(--semantic-error)] shrink-0 mt-0.5"
                      />
                      <span className="break-words">
                        {entry.target}: {entry.error}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {errorNote && (
          <div
            role="alert"
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] px-4 py-3 flex items-center justify-between gap-3"
          >
            <span className="type-ui text-[var(--ink)]">{errorNote}</span>
            <button
              type="button"
              onClick={() => setErrorNote('')}
              className="type-caption text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer shrink-0 studio-focus"
            >
              Dismiss
            </button>
          </div>
        )}

        {statusNote && (
          <div
            role="status"
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] px-4 py-3 flex items-center justify-between gap-3"
          >
            <span className="type-mono text-[var(--ink-muted)]">{statusNote}</span>
            <button
              type="button"
              onClick={() => setStatusNote('')}
              className="type-caption text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer shrink-0 studio-focus"
            >
              Dismiss
            </button>
          </div>
        )}

        {history.length === 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-8 max-w-[440px] mx-auto text-center space-y-4">
            <div className="w-10 h-10 mx-auto rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] flex items-center justify-center text-[var(--ink-muted)]">
              <ImageIcon size={16} strokeWidth={1.5} />
            </div>
            <div className="space-y-1">
              <h2 className="type-display-s text-[var(--ink)]">No captures in gallery</h2>
              <p className="type-ui text-[var(--ink-muted)]">
                Capture any tab from Studio Hub, press Alt+Shift+1 on a webpage, or import a local image.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
            >
              <Upload size={16} strokeWidth={1.5} />
              <span>Import image</span>
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-8 text-center space-y-3">
            <p className="type-body text-[var(--ink-muted)]">
              No captures match the current filter{search ? ` "${search}"` : ''}.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setActiveFilter('all');
              }}
              className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="studio-gallery-grid">
            {filtered.slice(0, visibleCount).map((item) => {
              const isSelected = selectedItemId === item.id;
              return (
                <article key={item.id} className="min-w-0 space-y-2">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => onSelectItem(item)}
                    onDoubleClick={() => onSelectPreview(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectItem(item);
                      }
                    }}
                    className="cursor-pointer rounded-[12px] studio-focus"
                  >
                    <CropReticleFrame item={item} selected={isSelected} showProofStamp={true} />
                  </div>

                  <div className="px-1 space-y-1 min-w-0">
                    <h3 className="type-body-medium text-[var(--ink)] truncate">
                      {item.title || 'Untitled capture'}
                    </h3>
                    <p className="type-mono text-[var(--ink-muted)] truncate">
                      {getModeLabel(item.mode)} · {safeHostname(item.url)} ·{' '}
                      {formatTimestamp(item.timestamp).short}
                    </p>
                    {item.warning && (
                      <p className="type-caption text-[var(--ink-muted)] truncate" title={item.warning}>
                        {item.warning}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAnnotate(item);
                        }}
                        className="type-caption text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer transition-colors studio-focus rounded-[4px]"
                      >
                        <Pencil size={16} strokeWidth={1.5} />
                        <span>Annotate</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleCopy(e, item)}
                        className="type-caption text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer transition-colors studio-focus rounded-[4px]"
                      >
                        {copiedId === item.id ? (
                          <Check size={16} strokeWidth={1.5} />
                        ) : (
                          <Copy size={16} strokeWidth={1.5} />
                        )}
                        <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleDownload(e, item)}
                        className="type-caption text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer transition-colors studio-focus rounded-[4px]"
                      >
                        <Download size={16} strokeWidth={1.5} />
                        <span>Save</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {filtered.length > visibleCount && (
              <div className="col-span-full pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + 40)}
                  className="w-full h-9 px-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium cursor-pointer transition-colors studio-focus"
                >
                  Show more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
