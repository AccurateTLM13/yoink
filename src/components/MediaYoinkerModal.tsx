import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronLeft,
  Download,
  Copy,
  Check,
  Search,
  RefreshCw,
  Image as ImageIcon,
  FileCode,
  Film,
  Share2,
  Layers,
  Sparkles,
  CheckSquare,
  Square,
  ExternalLink,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import {
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
  OpenWebsiteTab,
  sendMediaItemToStudio,
  svgToPngDataUrl,
  yoinkMediaFromTab,
} from '../utils/mediaExtractor';
import { copyImageToClipboard, downloadDataUrl, saveStoredSettings } from '../utils/storage';
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
  { id: 'all', label: 'All Media' },
  { id: 'img', label: 'Images' },
  { id: 'svg', label: 'SVGs' },
  { id: 'bg', label: 'CSS BG' },
  { id: 'video', label: 'Video Frames' },
  { id: 'og', label: 'Social / OG' },
];

const SIZE_FILTERS = [
  { min: 0, label: 'All Sizes' },
  { min: 64, label: '≥ 64px' },
  { min: 250, label: '≥ 250px' },
  { min: 600, label: '≥ 600px (HD)' },
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
  const [scannedTabUrl, setScannedTabUrl] = useState<string>('');

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
      setScannedTabUrl(res.tabUrl);
      if (res.tabId) setSelectedTabId(res.tabId);
      setSelectedIds(new Set());
    } catch (err: any) {
      if (scanRequestSeqRef.current !== reqId) return;
      setError(err.message || 'Could not extract media from tab.');
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
    runScan();
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
      filteredItems.forEach((item) => allVisibleSelected ? next.delete(item.id) : next.add(item.id));
      return next;
    });
  };

  const startDownload = async (url: string, filename: string) => {
    await downloadDataUrl(url, filename, { settings });
  };

  const triggerDownloadItem = async (item: YoinkedMediaItem, asRasterPng = false) => {
    const safeBase = (item.name || 'yoink_asset')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'yoink_asset';

    if (asRasterPng && item.category === 'svg') {
      try {
        const png = await svgToPngDataUrl(item, 2);
        await startDownload(png.dataUrl, `${safeBase}_2x.png`);
        return;
      } catch (error) {
        throw new Error(`Could not create or start the PNG download: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const ext =
      item.format === 'unknown'
        ? item.category === 'svg'
          ? 'svg'
          : 'png'
        : item.format === 'jpeg'
        ? 'jpg'
        : item.format;
    const filename = `${safeBase}.${ext}`;

    await startDownload(item.url, filename);
  };

  const handleDownloadItem = async (item: YoinkedMediaItem, asRasterPng = false) => {
    try {
      await triggerDownloadItem(item, asRasterPng);
      if (settings.saveLocationMode === 'folder') {
        setStatusNote(`Saved "${item.name}" to "${settings.customSaveFolderName || 'selected folder'}".`);
      } else {
        setStatusNote(`Download ${typeof chrome !== 'undefined' && chrome.downloads?.download ? 'saved' : 'started'} for "${item.name}".`);
      }
    } catch (error) {
      setStatusNote(`Download failed for "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleBatchDownload = async () => {
    const targets = items.filter((i) => selectedIds.has(i.id));
    if (targets.length === 0) return;
    setBatchDownloading(true);
    setStatusNote(`Yoinking ${targets.length} asset${targets.length === 1 ? '' : 's'}…`);
    const failed: string[] = [];
    let lastError = '';
    try {
      for (let i = 0; i < targets.length; i++) {
        try {
          await triggerDownloadItem(targets[i]);
        } catch (err) {
          failed.push(targets[i].name);
          if (!lastError && err instanceof Error) lastError = err.message;
        }
        if (i < targets.length - 1) {
          await new Promise((r) => setTimeout(r, 160));
        }
      }
      if (failed.length) {
        setStatusNote(
          `Saved ${targets.length - failed.length}; failed ${failed.length}: ${failed.join(', ')}.${lastError ? ` (${lastError})` : ''}`
        );
      } else if (settings.saveLocationMode === 'folder') {
        setStatusNote(
          `Saved ${targets.length} asset${targets.length === 1 ? '' : 's'} to "${settings.customSaveFolderName || 'selected folder'}".`
        );
      } else {
        setStatusNote(
          `${typeof chrome !== 'undefined' && chrome.downloads?.download ? 'Saved' : 'Started'} ${targets.length} download${targets.length === 1 ? '' : 's'}.`
        );
      }
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleCopyItem = async (item: YoinkedMediaItem) => {
    try {
      if (item.category === 'svg' && item.svgCode && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.svgCode);
        setCopiedId(item.id);
        setStatusNote(`Copied raw <svg> code for "${item.name}"`);
        setTimeout(() => setCopiedId(null), 2000);
        return;
      }

      const ok = await copyImageToClipboard(item.url);
      if (ok) {
        setCopiedId(item.id);
        setStatusNote(`Copied "${item.name}" to clipboard`);
        setTimeout(() => setCopiedId(null), 2000);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.url);
        setCopiedId(item.id);
        setStatusNote(`Copied asset URL for "${item.name}"`);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch {
      setStatusNote('Could not copy asset to clipboard.');
    }
  };

  const handleSendToStudioClick = async (item: YoinkedMediaItem) => {
    if (!onSendToStudio) return;
    setSendingId(item.id);
    setStatusNote(`Sealing "${item.name}" with Yoink Proof™…`);
    try {
      const historyItem = await sendMediaItemToStudio(item, settings);
      setStatusNote(`Imported "${item.name}" into the gallery.`);
      onSendToStudio(historyItem);
    } catch (err: any) {
      setStatusNote(err.message || 'Could not import remote image into Studio.');
    } finally {
      setSendingId(null);
    }
  };

  const categoryBadgeColor = (cat: YoinkMediaCategory) => {
    switch (cat) {
      case 'svg':
        return 'bg-amber-500/90 text-white';
      case 'video':
        return 'bg-rose-600/90 text-white';
      case 'bg':
        return 'bg-purple-600/90 text-white';
      case 'og':
        return 'bg-indigo-600/90 text-white';
      case 'canvas':
        return 'bg-teal-600/90 text-white';
      default:
        return 'bg-blue-600/90 text-white';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden">
      {/* Top Toolbar */}
      <div className="px-4 py-2.5 border-b border-zinc-200/80 bg-white flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {!isFullTab && (
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition cursor-pointer px-1.5 py-1 rounded-lg hover:bg-zinc-100"
            >
              <ChevronLeft size={15} />
              <span>Back</span>
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-zinc-900 truncate">
                Page Media Yoinker
              </span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200/70">
                {items.length} found
              </span>
            </div>
            {scannedTabTitle && (
              <p className="text-[10.5px] text-zinc-500 font-mono truncate max-w-[240px] sm:max-w-[420px]">
                Source: {scannedTabTitle}
              </p>
            )}
          </div>
        </div>

        {/* Right Controls: Target Tab Selector (in Studio Hub) + Re-Scan + Batch Download */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isFullTab && openTabs.length > 0 && (
            <select
              value={selectedTabId || ''}
              onChange={(e) => {
                const nextId = Number(e.target.value);
                setSelectedTabId(nextId);
                runScan(nextId);
              }}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-50 border border-zinc-200 text-zinc-800 max-w-[240px] truncate cursor-pointer focus:outline-none focus:border-blue-500"
              title="Choose which open browser tab to yoink media from"
            >
              {openTabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title.slice(0, 42)}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => runScan(selectedTabId)}
            disabled={loading}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
            title="Re-scan active webpage for newly loaded images, SVGs, and video frames"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin text-blue-600' : ''} />
            <span>Re-Scan</span>
          </button>

          {selectedIds.size > 0 && (
            <button
              onClick={handleBatchDownload}
              disabled={batchDownloading}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Download size={13} />
              <span>
                {batchDownloading ? 'Yoinking…' : `Yoink Selected (${selectedIds.size})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="px-4 py-2.5 bg-zinc-50/90 border-b border-zinc-200/80 space-y-2 shrink-0">
        {/* Category Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
          {CATEGORY_TABS.map((tab) => {
            const count = categoryCounts[tab.id] || 0;
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0 border ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                    : 'bg-white text-zinc-600 border-zinc-200/80 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[9.5px] font-mono ${
                    active ? 'bg-blue-700 text-blue-100' : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + Min Size Filter + Select All */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[140px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, format (svg, webp, png), or tag…"
              className="w-full pl-8 pr-3 py-1 text-xs bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 text-zinc-900 select-text"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-zinc-200 text-[11px]">
              <SlidersHorizontal size={11} className="text-zinc-400" />
              <select
                value={minDimension}
                onChange={(e) => setMinDimension(Number(e.target.value))}
                className="bg-transparent text-[11px] font-medium text-zinc-700 focus:outline-none cursor-pointer"
                title="Minimum pixel dimension filter"
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
                onClick={toggleSelectAllVisible}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-200 text-[11px] font-semibold text-zinc-700 transition cursor-pointer flex items-center gap-1"
              >
                {filteredItems.every((i) => selectedIds.has(i.id)) ? (
                  <>
                    <CheckSquare size={12} className="text-blue-600" />
                    <span>Deselect</span>
                  </>
                ) : (
                  <>
                    <Square size={12} className="text-zinc-400" />
                    <span>Select All ({filteredItems.length})</span>
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
          <div className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200/80 text-[11px] font-mono text-blue-800 flex items-center justify-between">
            <span className="truncate">{statusNote}</span>
            <button
              onClick={() => setStatusNote(null)}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-900 ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {diagnostics &&
          (diagnostics.crossOriginFrames > 0 ||
            diagnostics.taintedCanvases > 0 ||
            diagnostics.protectedVideos > 0 ||
            diagnostics.scanTruncated) && (
            <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200/80 text-[10.5px] text-amber-900 leading-snug space-y-0.5">
              {(diagnostics.crossOriginFrames > 0 ||
                diagnostics.taintedCanvases > 0 ||
                diagnostics.protectedVideos > 0) && (
                <div>
                  <b>Some protected assets were skipped by browser security:</b>{' '}
                  {[
                    diagnostics.crossOriginFrames > 0
                      ? `${diagnostics.crossOriginFrames} cross-origin frame(s)`
                      : '',
                    diagnostics.taintedCanvases > 0
                      ? `${diagnostics.taintedCanvases} CORS-tainted canvas(es)`
                      : '',
                    diagnostics.protectedVideos > 0
                      ? `${diagnostics.protectedVideos} DRM/cross-origin video(s)`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  . Use <b>Capture Selection</b> or <b>Visible</b> screenshot to grab protected regions.
                </div>
              )}
              {diagnostics.scanTruncated && (
                <div>
                  <b>Large-page budget reached:</b> Scanned{' '}
                  {diagnostics.scannedElements
                    ? `${diagnostics.scannedElements.toLocaleString()} DOM elements`
                    : 'available roots'}{' '}
                  before pausing background CSS scans so the page stays responsive. Images, videos, and SVGs already discovered remain listed below.
                </div>
              )}
            </div>
          )}
      </div>

      {/* Main Media Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-zinc-500 gap-2">
            <Loader2 size={24} className="animate-spin text-blue-600" />
            <p className="text-xs font-medium">
              Scanning DOM for high-res srcset images, inline SVGs, CSS backgrounds &amp; clean video frames…
            </p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-2 max-w-md mx-auto my-8">
            <p className="text-xs font-semibold text-amber-900">{error}</p>
            <p className="text-[11px] text-amber-800">
              Make sure you have a standard website (`https://`) open in your browser window, then click <b>Re-Scan</b>.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-zinc-500 gap-2 text-center">
            <ImageIcon size={28} className="text-zinc-300" />
            <p className="text-xs font-semibold text-zinc-700">No matching media assets found</p>
            <p className="text-[11px] text-zinc-500">
              Try switching the category filter to <b>All Media</b> or lowering the minimum pixel size filter.
            </p>
          </div>
        ) : (
          <div
            className={`grid gap-3.5 ${
              isFullTab
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                : 'grid-cols-2'
            }`}
          >
            {filteredItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const isCopied = copiedId === item.id;
              const isSending = sendingId === item.id;

              return (
                <div
                  key={item.id}
                  className={`group rounded-xl bg-white border transition overflow-hidden flex flex-col justify-between ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                      : 'border-zinc-200/90 hover:border-blue-300 hover:shadow-md'
                  }`}
                >
                  {/* Visual Preview Box (Checkerboard pattern so white SVGs & transparent PNGs stand out) */}
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
                    className="relative h-32 sm:h-36 bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f9_75%),linear-gradient(-45deg,transparent_75%,#f1f5f9_75%)] bg-[size:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] bg-zinc-200/60 flex items-center justify-center p-2 cursor-pointer overflow-hidden border-b border-zinc-100"
                  >
                    <img
                      src={item.url}
                      alt={item.name}
                      loading="lazy"
                      className="max-w-full max-h-full object-contain group-hover:scale-[1.03] transition duration-200"
                    />

                    {/* Top-Left Category & Format Badges */}
                    <div className="absolute top-2 left-2 flex items-center gap-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase shadow-2xs ${categoryBadgeColor(
                          item.category
                        )}`}
                      >
                        {item.category === 'video'
                          ? 'VIDEO FRAME'
                          : item.category === 'bg'
                          ? 'CSS BG'
                          : item.category === 'og'
                          ? 'OG CARD'
                          : item.category}
                      </span>
                      {item.format !== 'unknown' && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900/75 text-white text-[9px] font-mono font-bold uppercase backdrop-blur-xs">
                          {item.format}
                        </span>
                      )}
                    </div>

                    {/* Top-Right Selection Checkbox */}
                    <div className="absolute top-2 right-2">
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                            : 'bg-white/90 border-zinc-300 text-transparent group-hover:border-blue-400'
                        }`}
                      >
                        <Check size={12} />
                      </div>
                    </div>

                    {/* Bottom-Right Dimensions Pill */}
                    {(item.width > 0 || item.height > 0) && (
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/75 text-white font-mono text-[9.5px] backdrop-blur-xs">
                        {item.width}×{item.height}
                      </div>
                    )}
                  </div>

                  {/* Card Details & Action Strip */}
                  <div className="p-2.5 space-y-2">
                    <div>
                      <h4
                        className="text-xs font-bold text-zinc-900 truncate"
                        title={item.name}
                      >
                        {item.name}
                      </h4>
                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-0.5">
                        <span className="truncate">{item.sourceTag}</span>
                        {!item.url.startsWith('data:') && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline inline-flex items-center gap-0.5 shrink-0"
                            title="Open raw asset URL in new tab"
                          >
                            <span>Raw</span>
                            <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1 pt-1.5 border-t border-zinc-100">
                      {/* Primary Download */}
                      <button
                        onClick={() => handleDownloadItem(item, false)}
                        className="flex-1 py-1 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[10.5px] flex items-center justify-center gap-1 transition cursor-pointer"
                        title={`Download ${item.name}`}
                      >
                        <Download size={11} />
                        <span>Yoink</span>
                      </button>

                      {/* For SVGs: 1-Click Rasterize to 2x PNG */}
                      {item.category === 'svg' && (
                        <button
                          onClick={() => handleDownloadItem(item, true)}
                          className="py-1 px-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 font-mono font-bold text-[10px] transition cursor-pointer"
                          title="Rasterize vector SVG and download as 2x high-res PNG"
                        >
                          PNG
                        </button>
                      )}

                      {/* Copy Image or SVG Code */}
                      <button
                        onClick={() => handleCopyItem(item)}
                        className="py-1 px-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium text-[10.5px] flex items-center justify-center gap-1 transition cursor-pointer"
                        title={
                          item.category === 'svg'
                            ? 'Copy raw <svg> vector markup'
                            : 'Copy image to clipboard'
                        }
                      >
                        {isCopied ? (
                          <Check size={11} className="text-emerald-600" />
                        ) : item.category === 'svg' ? (
                          <FileCode size={11} />
                        ) : (
                          <Copy size={11} />
                        )}
                        <span>{isCopied ? 'OK' : item.category === 'svg' ? 'SVG' : 'Copy'}</span>
                      </button>

                      {/* Send to Studio (Annotate / OCR / Sign Proof) */}
                      {onSendToStudio && (
                        <button
                          onClick={() => handleSendToStudioClick(item)}
                          disabled={isSending}
                          className="py-1 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/70 font-semibold text-[10.5px] flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                          title="Import into Yoink Studio (Sign with Yoink Proof™, Annotate, Blur, or run OCR)"
                        >
                          {isSending ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Sparkles size={11} />
                          )}
                          <span className="hidden sm:inline">Studio</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

