import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  Trash2,
  Download,
  Copy,
  Check,
  Clock,
  Image as ImageIcon,
  Search,
  Layers,
  X,
  AlertTriangle,
  ExternalLink,
  Pencil,
  FileText,
  Upload,
  ScanText,
  ShieldCheck,
} from 'lucide-react';
import { BatchReport, HistoryItem, CaptureMode } from '../types';
import { copyImageToClipboard, downloadDataUrl, getFullResolutionImage } from '../utils/storage';
import { exportPdf } from '../utils/pdf';

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

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  full: { label: 'Full Page', color: 'bg-indigo-50 text-indigo-700 border-indigo-200/70' },
  visible: { label: 'Visible', color: 'bg-emerald-50 text-emerald-700 border-emerald-200/70' },
  selection: { label: 'Selection', color: 'bg-blue-50 text-blue-700 border-blue-200/70' },
  element: { label: 'Scroll Element', color: 'bg-cyan-50 text-cyan-700 border-cyan-200/70' },
  alltabs: { label: 'Tab Batch', color: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  urllist: { label: 'URL List', color: 'bg-purple-50 text-purple-700 border-purple-200/70' },
  multisize: { label: 'Responsive', color: 'bg-sky-50 text-sky-700 border-sky-200/70' },
  annotated: { label: 'Annotated', color: 'bg-orange-50 text-orange-700 border-orange-200/70' },
  upload: { label: 'Uploaded', color: 'bg-teal-50 text-teal-700 border-teal-200/70' },
  desktop: { label: 'Desktop', color: 'bg-emerald-50 text-emerald-800 border-emerald-200/70' },
  media: { label: 'Media', color: 'bg-violet-50 text-violet-800 border-violet-200/70' },
};

function safeHostname(url?: string): string {
  if (!url) return 'capture';
  try {
    return new URL(url).hostname || 'capture';
  } catch {
    return 'capture';
  }
}

const HistoryThumbnail: React.FC<{ item: HistoryItem; isFullTab?: boolean }> = React.memo(({ item, isFullTab }) => {
  const initial = (item.dataUrl && item.dataUrl.length > 50000) ? item.dataUrl : (item.thumbnailUrl || item.dataUrl || null);
  const [src, setSrc] = useState<string | null>(initial);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (item.dataUrl && item.dataUrl.length > 50000) {
      setSrc(item.dataUrl);
      setLoadFailed(false);
      return;
    }

    if (item.thumbnailUrl || item.dataUrl) {
      setSrc(item.thumbnailUrl || item.dataUrl);
      setLoadFailed(false);
      return;
    }

    getFullResolutionImage(item.id).then((full) => {
      if (isMounted) {
        if (full) {
          setSrc(full);
          setLoadFailed(false);
        } else {
          setLoadFailed(true);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [item.id, item.dataUrl, item.thumbnailUrl]);

  if (!src || loadFailed) {
    return <ImageIcon size={isFullTab ? 24 : 18} className="text-zinc-400" />;
  }

  return (
    <img
      src={src}
      alt={item.title}
      onError={() => {
        getFullResolutionImage(item.id)
          .then((full) => {
            if (full && full !== src) {
              setSrc(full);
            } else {
              setLoadFailed(true);
            }
          })
          .catch(() => setLoadFailed(true));
      }}
      className={`w-full h-full object-cover object-top transition-transform duration-200 ${
        isFullTab ? 'group-hover:scale-102' : 'group-hover:scale-105'
      }`}
      loading="lazy"
    />
  );
});

export const HistoryDrawer: React.FC<Props> = React.memo(({
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
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | CaptureMode>('all');
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
    if (!src) setImageError(`Original image unavailable for ${item.title}. The thumbnail is preview only.`);
    return src;
  };

  const filtered = useMemo(() => {
    let list = history;

    if (activeFilter !== 'all') {
      list = list.filter((item) => item.mode === activeFilter);
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(s) ||
          (item.url && item.url.toLowerCase().includes(s)) ||
          item.mode.toLowerCase().includes(s)
      );
    }

    return list;
  }, [history, search, activeFilter]);

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
    const filename = `${cleanTitle}_${Date.now()}.${ext}`;
    try {
      await downloadDataUrl(imageSrc, filename);
      setActionMessage(`Download ${typeof chrome !== 'undefined' && chrome.downloads?.download ? 'saved' : 'started'} for “${item.title}”.`);
    } catch (error) {
      setActionMessage(`Could not save “${item.title}”: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDownloadAll = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const itemsToDownload = filtered;
    if (itemsToDownload.length === 0) return;

    setDownloadingAll(true);
    const failures: string[] = [];
    try {
      for (let idx = 0; idx < itemsToDownload.length; idx++) {
        const item = itemsToDownload[idx];
        const imageSrc = await originalFor(item);
        if (!imageSrc) {
          setDownloadingAll(false);
          return;
        }
        const ext = item.format || 'png';
        const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
        const filename = `${cleanTitle}_${item.id.slice(-4)}.${ext}`;
        try {
          await downloadDataUrl(imageSrc, filename);
        } catch {
          failures.push(item.title);
        }
        if (idx < itemsToDownload.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      setActionMessage(
        failures.length
          ? `Could not save ${failures.length} capture(s): ${failures.join(', ')}.`
          : `Exported ${itemsToDownload.length} capture(s).`
      );
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleExportAllPdf = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const items = filtered;
    if (items.length === 0 || exportingPdf) return;
    setExportingPdf(true);
    try {
      const sources: string[] = [];
      for (const item of items) {
        const src = await originalFor(item);
        if (!src) return;
        sources.push(src);
      }
      if (sources.length > 0) {
        await exportPdf(sources, `yoink_gallery_${sources.length}_captures`);
      }
    } catch (err) {
      console.error('Gallery PDF export failed:', err);
      setActionMessage(`PDF export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmClearAll = async () => {
    try {
      await onClearAll();
      setShowClearConfirm(false);
    } catch (error) {
      setActionMessage(`Could not clear history: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const confirmDelete = async (id: string) => {
    try {
      await onDeleteItem(id);
      setDeleteConfirmId(null);
    } catch (error) {
      setActionMessage(`Could not delete capture: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden">
      {imageError && (
        <div role="alert" className="p-3 bg-amber-50 text-amber-950 border border-amber-300 text-xs">
          {imageError}{' '}
          <button type="button" onClick={() => setImageError('')} className="underline font-semibold">
            Dismiss
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xs">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition cursor-pointer px-1 py-1 rounded hover:bg-zinc-100"
        >
          <ChevronLeft size={16} />
          <span>Back to Menu</span>
        </button>

        <div className="flex items-center gap-1.5">
          {onImportFiles && (
            <>
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
              <button
                id="gallery-upload-button"
                onClick={() => fileInputRef.current?.click()}
                title="Upload images to annotate (or drag-drop / paste anywhere)"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100/70 border border-teal-200/70 transition cursor-pointer"
              >
                <Upload size={10} />
                <span>Upload</span>
              </button>
            </>
          )}
          {!isFullTab && onOpenStudio && (
            <button
              onClick={onOpenStudio}
              title="Open full gallery in Studio Hub"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/70 border border-blue-200/70 transition cursor-pointer"
            >
              <span>Studio</span>
              <ExternalLink size={10} />
            </button>
          )}

          <span className="text-[11px] font-mono tabular-nums text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200/60">
            {history.length} {history.length === 1 ? 'item' : 'items'}
          </span>

          {history.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="text-[11px] font-medium text-rose-600 hover:text-rose-700 px-2 py-0.5 rounded hover:bg-rose-50 transition cursor-pointer"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Dialog for Clear All */}
      {showClearConfirm && (
        <div className="p-3 m-3 bg-rose-50/90 border border-rose-200 rounded-xl shadow-xs animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-rose-900 leading-tight">Clear Capture History?</h4>
              <p className="text-[11px] text-rose-700 mt-0.5 leading-snug">
                This will remove all {history.length} captures from your local gallery.
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={confirmClearAll}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition cursor-pointer shadow-2xs"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 bg-white hover:bg-zinc-100 rounded-lg border border-zinc-200 transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Batch Success & Completion Report Banner */}
      {recentBatchReport && (
        <div className="m-3 p-3 bg-blue-50/90 border border-blue-200/90 rounded-xl flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Layers size={16} />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-blue-950 truncate">
                {recentBatchReport.count || 0} captured
                {recentBatchReport.skipped.length ? ` · ${recentBatchReport.skipped.length} skipped` : ''}
                {recentBatchReport.failures.length ? ` · ${recentBatchReport.failures.length} failed` : ''}
              </h4>
              <p className="text-[11px] text-blue-700 truncate">
                {recentBatchReport.failures.length || recentBatchReport.skipped.length
                  ? 'Expand completion report to inspect captured, skipped, or failed tabs.'
                  : 'Ready to inspect in your gallery.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {history.length > 0 && (
              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                className="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition cursor-pointer flex items-center gap-1 shadow-xs disabled:opacity-50"
              >
                <Download size={12} />
                <span>{downloadingAll ? 'Saving...' : 'Export gallery'}</span>
              </button>
            )}
            {onDismissBatchBanner && (
              <button
                onClick={onDismissBatchBanner}
                className="p-1 text-blue-500 hover:text-blue-900 rounded transition cursor-pointer"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {(recentBatchReport.captured.length > 0 ||
            recentBatchReport.skipped.length > 0 ||
            recentBatchReport.failures.length > 0) && (
            <details className="w-full text-xs text-blue-950">
              <summary className="cursor-pointer font-semibold">Show completion report</summary>
              <ul className="mt-2 space-y-1 break-words max-h-40 overflow-y-auto">
                {recentBatchReport.captured.map((item, index) => (
                  <li key={`cap-${index}-${item.target}`} className="text-emerald-800">
                    <span className="font-semibold">[Captured]</span> {item.target}
                    {item.reason ? ` (${item.reason})` : ''}
                  </li>
                ))}
                {recentBatchReport.skipped.map((item, index) => (
                  <li key={`skip-${index}-${item.target}`} className="text-zinc-700">
                    <span className="font-semibold">[Skipped]</span> {item.target}: {item.reason}
                  </li>
                ))}
                {recentBatchReport.failures.map((failure, index) => (
                  <li key={`fail-${index}-${failure.target}`} className="text-rose-800">
                    <span className="font-semibold">[Failed]</span> {failure.target}: {failure.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {actionMessage && (
        <div role="status" className="mx-3 mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-800">
          {actionMessage}
          <button onClick={() => setActionMessage('')} className="ml-2 font-semibold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Mode Filters */}
      {history.length > 0 && (
        <div className="px-3.5 py-2.5 bg-zinc-50/80 border-b border-zinc-200/70 space-y-2">
          <div className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, URL, or type..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-zinc-900 placeholder:text-zinc-400 transition"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 text-zinc-400 hover:text-zinc-600 p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer font-medium shrink-0 ${
                activeFilter === 'all'
                  ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                  : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              All ({history.length})
            </button>

            {(['visible', 'selection', 'full', 'element', 'desktop', 'alltabs', 'urllist', 'multisize', 'annotated', 'upload', 'media'] as CaptureMode[]).map((mode) => {
              const count = history.filter((h) => h.mode === mode).length;
              if (count === 0) return null;
              const meta = MODE_LABELS[mode] || { label: mode };
              return (
                <button
                  key={mode}
                  onClick={() => setActiveFilter(mode)}
                  className={`px-2 py-0.5 rounded-full transition cursor-pointer font-medium shrink-0 ${
                    activeFilter === mode
                      ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                      : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {meta.label} ({count})
                </button>
              );
            })}

            {filtered.length > 1 && (
              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                className="ml-auto px-2 py-0.5 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-semibold transition cursor-pointer shrink-0 flex items-center gap-1 border border-zinc-200"
                title="Download all filtered captures"
              >
                <Download size={10} />
                <span>Export ({filtered.length})</span>
              </button>
            )}

            {filtered.length > 0 && (
              <button
                onClick={handleExportAllPdf}
                disabled={exportingPdf}
                className={`${filtered.length > 1 ? '' : 'ml-auto '}px-2 py-0.5 rounded-full bg-zinc-100 hover:bg-zinc-200 disabled:opacity-60 text-zinc-700 text-[10px] font-semibold transition cursor-pointer shrink-0 flex items-center gap-1 border border-zinc-200`}
                title="Combine all filtered captures into 1 PDF"
              >
                <FileText size={10} />
                <span>{exportingPdf ? 'Building…' : `PDF (${filtered.length})`}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* History Items List / Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center p-6">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200/70 flex items-center justify-center text-blue-600 mb-3 shadow-[0_2px_8px_rgba(37,99,235,0.06)]">
              <ImageIcon size={22} />
            </div>
            <h3 className="text-sm font-bold text-zinc-900">No Captures Yet</h3>
            <p className="text-xs text-zinc-600 mt-1 max-w-[240px] leading-relaxed">
              Use the capture options from the main menu or press <kbd className="font-mono text-[10px] bg-zinc-100 px-1 py-0.5 rounded border border-zinc-200">Alt+Shift+1</kbd> to take your first screenshot.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-xs text-zinc-500">
            No captures match &ldquo;{search}&rdquo;.
          </div>
        ) : (
          <div className={isFullTab ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5' : 'space-y-2'}>
            {filtered.slice(0, visibleCount).map((item) => {
              const meta = MODE_LABELS[item.mode] || {
                label: item.mode,
                color: 'bg-zinc-100 text-zinc-700 border-zinc-200',
              };

              return (
                <div
                  key={item.id}
                  onClick={() => onSelectPreview(item)}
                  className="group relative flex flex-col bg-white border border-zinc-200/90 hover:border-blue-400 rounded-xl p-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-md transition-all duration-150 cursor-pointer"
                >
                  {isFullTab && (
                    <div className="w-full h-40 rounded-lg bg-zinc-100/80 border border-zinc-200/60 overflow-hidden mb-2.5 flex items-center justify-center relative">
                      <HistoryThumbnail item={item} isFullTab={true} />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                  )}

                  <div className="flex items-start gap-2.5">
                    {!isFullTab && (
                      <div className="w-14 h-14 rounded-lg bg-zinc-100 border border-zinc-200/70 overflow-hidden flex items-center justify-center shrink-0 relative">
                        <HistoryThumbnail item={item} isFullTab={false} />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-md border font-mono tracking-wide ${meta.color}`}>
                          {meta.label}
                        </span>
                        {item.ocrText && (
                          <span
                            className="px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 bg-indigo-50 rounded border border-indigo-200/70 font-mono tracking-wide"
                            title="Text extracted from capture"
                          >
                            OCR
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-600 font-mono flex items-center gap-1 tabular-nums">
                          <Clock size={10} />
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <h4 className="text-xs font-semibold text-zinc-900 truncate leading-tight mb-0.5">
                        {item.title}
                      </h4>

                      {item.warning && (
                        <p className="text-[11px] text-amber-800 font-medium" title={item.warning}>
                          {item.warning}
                        </p>
                      )}

                      <p className="text-[10px] text-zinc-600 truncate font-mono tabular-nums">
                        {item.width > 0 ? `${item.width} × ${item.height}px • ` : ''}
                        {item.format.toUpperCase()}
                      </p>
                    </div>
                  </div>

                  {/* Quick Card Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 mt-2 pt-2 border-t border-zinc-100">
                    <span className="text-[10px] text-zinc-600 truncate max-w-[120px] font-mono">
                      {safeHostname(item.url)}
                    </span>

                    <div className="flex flex-wrap items-center gap-1">
                      {onSelectAnnotate && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAnnotate(item);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-orange-700 hover:text-orange-800 bg-orange-50 hover:bg-orange-100/80 rounded-md border border-orange-200 transition cursor-pointer"
                          title="Open in Annotation & Redaction Studio"
                        >
                          <Pencil size={11} />
                          <span>Annotate</span>
                        </button>
                      )}

                      {onSelectVerify && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectVerify(item);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100/80 rounded-md border border-emerald-200 transition cursor-pointer"
                          title="Verify Yoink Proof™ cryptographic signature & pixel watermark"
                        >
                          <ShieldCheck size={11} />
                          <span>Proof</span>
                        </button>
                      )}
                      {onSelectOcr && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectOcr(item);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/80 rounded-md border border-indigo-200 transition cursor-pointer"
                          title="Extract text from capture (OCR)"
                        >
                          <ScanText size={11} />
                          <span>OCR</span>
                        </button>
                      )}

                      <button
                        onClick={(e) => handleCopy(e, item)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:text-blue-600 bg-zinc-50 hover:bg-blue-50 rounded-md border border-zinc-200 hover:border-blue-200 transition cursor-pointer"
                        title="Copy image to clipboard"
                      >
                        {copiedId === item.id ? (
                          <Check size={11} className="text-emerald-600" />
                        ) : (
                          <Copy size={11} />
                        )}
                        <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        onClick={(e) => handleDownload(e, item)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:text-blue-600 bg-zinc-50 hover:bg-blue-50 rounded-md border border-zinc-200 hover:border-blue-200 transition cursor-pointer"
                        title="Download file"
                      >
                        <Download size={11} />
                        <span>Save</span>
                      </button>

                      {deleteConfirmId === item.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => confirmDelete(item.id)} className="rounded-md bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white">
                            Delete?
                          </button>
                          <button onClick={() => setDeleteConfirmId(null)} className="rounded-md px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => handleDelete(e, item.id)}
                          className="p-1 text-zinc-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition cursor-pointer"
                          title="Delete capture"
                          aria-label={`Delete ${item.title}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((count) => count + 40)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 sm:col-span-full"
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
