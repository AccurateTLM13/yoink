import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Check,
  CheckSquare,
  ChevronLeft,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type {
  CaptureSettings,
  HistoryItem,
  MediaExtractionDiagnostics,
  YoinkedMediaItem,
  YoinkMediaCategory,
} from '../types';
import {
  cancelMediaScan,
  filterAndSortMedia,
  getInjectableOpenTabs,
  type OpenWebsiteTab,
  sendMediaItemToStudio,
  svgToPngDataUrl,
  yoinkMediaFromTab,
} from '../utils/mediaExtractor';
import { copyImageToClipboard, downloadDataUrl, saveStoredSettings } from '../utils/storage';
import { formatMediaStamp } from '../utils/studioFormat';
import { SaveDestinationControl } from './SaveDestinationControl';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onSendToStudio?: (item: HistoryItem) => void;
  onUpdateSettings?: (newSettings: CaptureSettings) => void;
  isFullTab?: boolean;
  highlightFolderPicker?: boolean;
}

const CATEGORY_TABS: { id: 'all' | YoinkMediaCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'img', label: 'Images' },
  { id: 'svg', label: 'SVGs' },
  { id: 'bg', label: 'CSS BG' },
  { id: 'video', label: 'Video frames' },
  { id: 'og', label: 'Social' },
];

const SIZE_FILTERS = [
  { min: 0, label: 'All sizes' },
  { min: 64, label: '≥ 64px' },
  { min: 250, label: '≥ 250px' },
  { min: 600, label: '≥ 600px' },
];

export const MediaYoinkerModal: React.FC<Props> = ({
  settings,
  onBack,
  onSendToStudio,
  onUpdateSettings,
  isFullTab = false,
  highlightFolderPicker = false,
}) => {
  const [items, setItems] = useState<YoinkedMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenWebsiteTab[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | undefined>(undefined);
  const [scannedTabTitle, setScannedTabTitle] = useState<string>('');

  const [category, setCategory] = useState<'all' | YoinkMediaCategory>('all');
  const [minDimension, setMinDimension] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<MediaExtractionDiagnostics | null>(null);
  const scanRequestSeqRef = useRef(0);
  const activeTabRef = useRef<number | undefined>(undefined);

  const runScan = useCallback(async (targetTabId?: number) => {
    const prevTabId = activeTabRef.current;
    if (prevTabId && prevTabId !== targetTabId) {
      void cancelMediaScan(prevTabId);
    } else if (targetTabId) {
      void cancelMediaScan(targetTabId);
    }
    const reqId = ++scanRequestSeqRef.current;
    activeTabRef.current = targetTabId;
    setLoading(true);
    setError(null);
    try {
      const res = await yoinkMediaFromTab(targetTabId);
      if (scanRequestSeqRef.current !== reqId) return;
      if (res.diagnostics?.cancelled) return;
      if (res.tabId) activeTabRef.current = res.tabId;
      setItems(res.items);
      setDiagnostics(res.diagnostics || null);
      setScannedTabTitle(res.tabTitle);
      if (res.tabId) setSelectedTabId(res.tabId);
      setSelectedIds(new Set());
    } catch (err: unknown) {
      if (scanRequestSeqRef.current !== reqId) return;
      setError(err instanceof Error ? err.message : 'Could not extract media from tab.');
    } finally {
      if (scanRequestSeqRef.current === reqId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    getInjectableOpenTabs().then((tabs) => {
      setOpenTabs(tabs);
    });
    void runScan();
    return () => {
      scanRequestSeqRef.current++;
      if (activeTabRef.current) {
        void cancelMediaScan(activeTabRef.current);
      }
    };
  }, [runScan]);

  const filteredItems = useMemo(
    () =>
      filterAndSortMedia(items, {
        category,
        minDimension,
        searchQuery,
      }),
    [items, category, minDimension, searchQuery]
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: items.length,
      img: 0,
      svg: 0,
      bg: 0,
      video: 0,
      og: 0,
      canvas: 0,
    };
    for (const item of items) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [items]);

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const allVisibleSelected =
      filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));
    setSelectedIds((previous) => {
      const next = new Set(previous);
      filteredItems.forEach((item) =>
        allVisibleSelected ? next.delete(item.id) : next.add(item.id)
      );
      return next;
    });
  };

  const triggerDownloadItem = async (item: YoinkedMediaItem, asRasterPng = false) => {
    const safeBase =
      (item.name || 'yoink_asset')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'yoink_asset';

    if (asRasterPng && item.category === 'svg') {
      const png = await svgToPngDataUrl(item, 2);
      await downloadDataUrl(png.dataUrl, `${safeBase}_2x.png`, { settings });
      return;
    }

    const ext =
      item.format === 'unknown'
        ? item.category === 'svg'
          ? 'svg'
          : 'png'
        : item.format === 'jpeg'
        ? 'jpg'
        : item.format;

    await downloadDataUrl(item.url, `${safeBase}.${ext}`, { settings });
  };

  const handleDownloadItem = async (item: YoinkedMediaItem, asRasterPng = false) => {
    try {
      await triggerDownloadItem(item, asRasterPng);
      setStatusNote(`Saved "${item.name}".`);
    } catch (err) {
      setStatusNote(
        `Download failed for "${item.name}": ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };

  const handlePrimaryDownload = async () => {
    const targets =
      selectedIds.size > 0 ? items.filter((i) => selectedIds.has(i.id)) : filteredItems;
    if (targets.length === 0 || batchDownloading) return;
    setBatchDownloading(true);
    setStatusNote(`Downloading ${targets.length} asset${targets.length === 1 ? '' : 's'}…`);
    const failed: string[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        try {
          await triggerDownloadItem(targets[i]);
        } catch {
          failed.push(targets[i].name);
        }
        if (i < targets.length - 1) {
          await new Promise((r) => setTimeout(r, 160));
        }
      }
      setStatusNote(
        failed.length > 0
          ? `Saved ${targets.length - failed.length}; failed ${failed.length}: ${failed.join(', ')}.`
          : `Downloaded ${targets.length} asset${targets.length === 1 ? '' : 's'}.`
      );
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleCopyItem = async (item: YoinkedMediaItem) => {
    try {
      if (item.category === 'svg' && item.svgCode && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.svgCode);
        setCopiedId(item.id);
        setStatusNote(`Copied <svg> markup for "${item.name}".`);
        setTimeout(() => setCopiedId(null), 1800);
        return;
      }

      const ok = await copyImageToClipboard(item.url);
      if (ok) {
        setCopiedId(item.id);
        setStatusNote(`Copied "${item.name}" to clipboard.`);
        setTimeout(() => setCopiedId(null), 1800);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.url);
        setCopiedId(item.id);
        setStatusNote(`Copied asset URL for "${item.name}".`);
        setTimeout(() => setCopiedId(null), 1800);
      }
    } catch {
      setStatusNote('Could not copy asset to clipboard.');
    }
  };

  const handleSendToStudioClick = async (item: YoinkedMediaItem) => {
    if (!onSendToStudio) return;
    setSendingId(item.id);
    setStatusNote(`Importing "${item.name}" into Studio…`);
    try {
      const historyItem = await sendMediaItemToStudio(item, settings);
      setStatusNote(`Imported "${item.name}" into Gallery.`);
      onSendToStudio(historyItem);
    } catch (err: unknown) {
      setStatusNote(err instanceof Error ? err.message : 'Could not import image into Studio.');
    } finally {
      setSendingId(null);
    }
  };

  const downloadTargetCount = selectedIds.size > 0 ? selectedIds.size : filteredItems.length;

  return (
    <div className="flex flex-col h-full bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden">
      {/* Popup-only 44px Header */}
      {!isFullTab && (
        <header className="h-[44px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="h-8 px-2 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
            <span>Back</span>
          </button>
          <span className="type-mono text-[var(--ink-muted)]">{items.length} assets</span>
        </header>
      )}

      {/* Edge-Docked Scan, Filter & Save Destination Toolbar */}
      <div className="bg-[var(--surface)] border-b border-[var(--border)] px-4 md:px-6 py-3 space-y-3 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {isFullTab && openTabs.length > 0 && (
              <select
                value={selectedTabId || ''}
                onChange={(e) => {
                  const nextId = Number(e.target.value);
                  setSelectedTabId(nextId);
                  void runScan(nextId);
                }}
                aria-label="Target browser tab"
                className="h-9 px-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink)] max-w-full sm:max-w-[260px] truncate cursor-pointer studio-focus"
              >
                {openTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => void runScan(selectedTabId)}
              disabled={loading}
              className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
            >
              <RefreshCw size={16} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
              <span>Re-scan</span>
            </button>

            {scannedTabTitle && (
              <span className="type-mono text-[var(--ink-muted)] truncate max-w-[260px]">
                {scannedTabTitle} · {items.length} found
              </span>
            )}
          </div>

          {/* Single Primary CTA: Download all / Download selected */}
          {downloadTargetCount > 0 && (
            <button
              type="button"
              onClick={handlePrimaryDownload}
              disabled={batchDownloading}
              className="h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 studio-focus"
            >
              <Download size={16} strokeWidth={1.5} />
              <span>
                {batchDownloading
                  ? 'Downloading…'
                  : selectedIds.size > 0
                  ? `Download selected (${selectedIds.size})`
                  : `Download all (${filteredItems.length})`}
              </span>
            </button>
          )}
        </div>

        {/* Wrapping Category Chips — zero sideways scroll */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Media category">
          {CATEGORY_TABS.map((tab) => {
            const count = categoryCounts[tab.id] || 0;
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                aria-pressed={active}
                className={`h-8 px-3 rounded-[6px] border type-caption inline-flex items-center gap-2 cursor-pointer transition-colors studio-focus ${
                  active
                    ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                    : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="type-mono">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search + Min Size + Select All */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative flex-1 min-w-0 flex items-center">
            <Search
              size={16}
              strokeWidth={1.5}
              className="absolute left-3 text-[var(--ink-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, format, or tag"
              aria-label="Filter media assets"
              className="w-full h-9 pl-8 pr-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink)] placeholder:text-[var(--ink-muted)] select-text studio-focus"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="h-9 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] inline-flex items-center gap-2">
              <SlidersHorizontal size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
              <select
                value={minDimension}
                onChange={(e) => setMinDimension(Number(e.target.value))}
                aria-label="Minimum pixel dimension"
                className="bg-transparent type-ui text-[var(--ink)] cursor-pointer focus:outline-none"
              >
                {SIZE_FILTERS.map((sf) => (
                  <option key={sf.min} value={sf.min}>
                    {sf.label}
                  </option>
                ))}
              </select>
            </div>

            {filteredItems.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
              >
                {filteredItems.every((i) => selectedIds.has(i.id)) ? (
                  <>
                    <CheckSquare size={16} strokeWidth={1.5} />
                    <span>Deselect</span>
                  </>
                ) : (
                  <>
                    <Square size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                    <span>Select all</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <SaveDestinationControl
          settings={settings}
          onUpdateSettings={(patch) => {
            const next = { ...settings, ...patch };
            if (onUpdateSettings) onUpdateSettings(next);
            else void saveStoredSettings(next);
          }}
          isFullTab={isFullTab}
          returnView="media"
          variant="compact"
          highlightPicker={highlightFolderPicker}
        />

        {statusNote && (
          <div
            role="status"
            className="px-3 py-2 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] flex items-center justify-between gap-2"
          >
            <span className="type-mono text-[var(--ink-muted)] truncate">{statusNote}</span>
            <button
              type="button"
              onClick={() => setStatusNote(null)}
              aria-label="Dismiss status"
              className="text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer shrink-0 studio-focus rounded-[4px]"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {diagnostics &&
          (diagnostics.crossOriginFrames > 0 ||
            diagnostics.taintedCanvases > 0 ||
            diagnostics.protectedVideos > 0 ||
            diagnostics.scanTruncated) && (
            <div className="px-3 py-2 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] space-y-1">
              {(diagnostics.crossOriginFrames > 0 ||
                diagnostics.taintedCanvases > 0 ||
                diagnostics.protectedVideos > 0) && (
                <p className="type-ui text-[var(--ink-muted)]">
                  Protected assets skipped by browser security:{' '}
                  {[
                    diagnostics.crossOriginFrames > 0
                      ? `${diagnostics.crossOriginFrames} cross-origin frame(s)`
                      : '',
                    diagnostics.taintedCanvases > 0
                      ? `${diagnostics.taintedCanvases} tainted canvas(es)`
                      : '',
                    diagnostics.protectedVideos > 0
                      ? `${diagnostics.protectedVideos} protected video(s)`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  . Use Region selection to capture protected areas.
                </p>
              )}
              {diagnostics.scanTruncated && (
                <p className="type-ui text-[var(--ink-muted)]">
                  Large-page scan budget reached after{' '}
                  {diagnostics.scannedElements
                    ? `${diagnostics.scannedElements.toLocaleString()} elements`
                    : 'available roots'}
                  ; discovered media remains listed below.
                </p>
              )}
            </div>
          )}
      </div>

      {/* Scrollable Media Grid */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="p-8 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)]" />
            <p className="type-body text-[var(--ink-muted)]">
              Scanning page for srcset images, inline SVGs, CSS backgrounds, and video frames…
            </p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] max-w-[440px] mx-auto text-center space-y-2">
            <p className="type-body-medium text-[var(--ink)]">{error}</p>
            <p className="type-ui text-[var(--ink-muted)]">
              Open a standard https webpage in another tab, then click Re-scan.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] max-w-[440px] mx-auto text-center space-y-2">
            <ImageIcon size={16} strokeWidth={1.5} className="mx-auto text-[var(--ink-muted)]" />
            <p className="type-body-medium text-[var(--ink)]">No matching media assets</p>
            <p className="type-ui text-[var(--ink-muted)]">
              Switch category back to All or lower the minimum pixel dimension filter.
            </p>
          </div>
        ) : (
          <div className={isFullTab ? 'studio-gallery-grid' : 'space-y-4'}>
            {filteredItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const isCopied = copiedId === item.id;
              const isSending = sendingId === item.id;

              return (
                <article
                  key={item.id}
                  className={`rounded-[12px] bg-[var(--surface)] border overflow-hidden flex flex-col ${
                    isSelected ? 'border-[var(--accent)]' : 'border-[var(--border)]'
                  }`}
                >
                  {/* Clean Media Preview — zero badges floating over the asset */}
                  <div
                    role="checkbox"
                    tabIndex={0}
                    aria-checked={isSelected}
                    aria-label={`Select ${item.name}`}
                    onClick={() => toggleSelectItem(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        toggleSelectItem(item.id);
                      }
                    }}
                    className="h-36 media-checkerboard flex items-center justify-center p-3 cursor-pointer overflow-hidden studio-focus"
                  >
                    <img
                      src={item.url}
                      alt={item.name}
                      loading="lazy"
                      className="max-w-full max-h-full object-contain block"
                    />
                  </div>

                  {/* Flush JetBrains Mono Readout + Selection Control underneath */}
                  <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--canvas)] flex items-center justify-between gap-2">
                    <span className="type-mono text-[var(--ink)] truncate">
                      {formatMediaStamp(item)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleSelectItem(item.id)}
                      aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}
                      className="text-[var(--ink)] shrink-0 cursor-pointer studio-focus rounded-[4px]"
                    >
                      {isSelected ? (
                        <CheckSquare size={16} strokeWidth={1.5} className="text-[var(--accent)]" />
                      ) : (
                        <Square size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                      )}
                    </button>
                  </div>

                  {/* Title & Action Bar */}
                  <div className="p-3 space-y-3 border-t border-[var(--border)]">
                    <div className="space-y-1 min-w-0">
                      <h4 className="type-body-medium text-[var(--ink)] truncate" title={item.name}>
                        {item.name}
                      </h4>
                      <div className="flex items-center justify-between gap-2">
                        <span className="type-mono text-[var(--ink-muted)] truncate">
                          {item.sourceTag}
                        </span>
                        {!item.url.startsWith('data:') && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="type-mono text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 shrink-0 studio-focus rounded-[4px]"
                          >
                            <span>Raw</span>
                            <ExternalLink size={12} strokeWidth={1.5} />
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border)]">
                      <button
                        type="button"
                        onClick={() => handleDownloadItem(item, false)}
                        className="flex-1 h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center justify-center gap-1 cursor-pointer studio-focus"
                      >
                        <Download size={16} strokeWidth={1.5} />
                        <span>Save</span>
                      </button>

                      {item.category === 'svg' && (
                        <button
                          type="button"
                          onClick={() => handleDownloadItem(item, true)}
                          className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-mono cursor-pointer studio-focus"
                          title="Rasterize SVG and download as 2x PNG"
                        >
                          PNG
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCopyItem(item)}
                        className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center justify-center gap-1 cursor-pointer studio-focus"
                      >
                        {isCopied ? (
                          <Check size={16} strokeWidth={1.5} />
                        ) : item.category === 'svg' ? (
                          <FileCode size={16} strokeWidth={1.5} />
                        ) : (
                          <Copy size={16} strokeWidth={1.5} />
                        )}
                        <span>{isCopied ? 'Copied' : item.category === 'svg' ? 'SVG' : 'Copy'}</span>
                      </button>

                      {onSendToStudio && (
                        <button
                          type="button"
                          onClick={() => handleSendToStudioClick(item)}
                          disabled={isSending}
                          className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 studio-focus"
                          title="Import into Studio to annotate, redact, or run OCR"
                        >
                          {isSending ? (
                            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                          ) : (
                            <Layers size={16} strokeWidth={1.5} />
                          )}
                          <span>Studio</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
