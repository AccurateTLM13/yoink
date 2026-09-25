import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Monitor,
  Crop,
  Layers,
  Globe,
  Smartphone,
  History,
  Settings,
  Sparkles,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Loader2,
  Check,
  Copy,
} from 'lucide-react';
import { CaptureSettings, HistoryItem } from './types';
import {
  DEFAULT_SETTINGS,
  getStoredSettings,
  saveStoredSettings,
  getStoredHistory,
  deleteStoredHistoryItem,
  clearStoredHistory,
} from './utils/storage';
import {
  captureFullPage,
  captureVisible,
  captureSelection,
  captureAllTabs,
} from './utils/capture';
import { QuickMenu } from './components/QuickMenu';
import { UrlBatchModal } from './components/UrlBatchModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { OptionsDrawer } from './components/OptionsDrawer';
import { MultiSizeModal } from './components/MultiSizeModal';
import { ImagePreviewModal } from './components/ImagePreviewModal';

type CurrentView = 'menu' | 'urllist' | 'history' | 'options' | 'multisize';

const getInitialView = (): CurrentView => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    if (v && ['menu', 'urllist', 'history', 'options', 'multisize'].includes(v)) {
      return v as CurrentView;
    }
  }
  return 'menu';
};

const getInitialBatchCount = (): number | null => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const b = params.get('batch');
    if (b) {
      const num = parseInt(b, 10);
      if (!isNaN(num)) return num;
    }
  }
  return null;
};

export default function App() {
  const [view, setView] = useState<CurrentView>(getInitialView);
  const [recentBatchCount, setRecentBatchCount] = useState<number | null>(getInitialBatchCount);
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [previewItem, setPreviewItem] = useState<HistoryItem | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [copiedShortcut, setCopiedShortcut] = useState<string | null>(null);

  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 370
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forcePopup = searchParams?.get('popup') === 'true';
  const forceTab = searchParams?.get('tab') === 'true';

  // Full Tab Studio Hub vs Chrome Extension Popup window
  const isFullTab = !forcePopup && (forceTab || windowWidth > 480);

  // Sync body styling based on popup vs full tab mode
  useEffect(() => {
    if (isFullTab) {
      document.body.className = 'bg-[#f8f9fc] w-full min-h-screen m-0 p-0 select-none antialiased overflow-y-auto text-zinc-900 font-sans';
    } else {
      document.body.className = 'bg-[#fbfbfd] w-[370px] h-[550px] m-0 p-0 overflow-hidden select-none antialiased text-zinc-900 font-sans';
    }
  }, [isFullTab]);

  // Load initial settings and history, plus check for pending_view from background captures
  useEffect(() => {
    async function loadInitialData() {
      const s = await getStoredSettings();
      setSettings(s);
      const h = await getStoredHistory();
      setHistory(h);
    }
    loadInitialData();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pending_view', 'last_batch_count'], (res) => {
        if (res.pending_view) {
          setView(res.pending_view as CurrentView);
          if (res.last_batch_count) {
            setRecentBatchCount(res.last_batch_count);
          }
          chrome.storage.local.remove(['pending_view', 'last_batch_count']);
        }
      });
    }

    // Listen for storage changes from background worker
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      const listener = (changes: any, area: string) => {
        if (area === 'local') {
          if (changes.omnicapture_history) {
            setHistory(changes.omnicapture_history.newValue || []);
          }
          if (changes.pending_view && changes.pending_view.newValue) {
            setView(changes.pending_view.newValue as CurrentView);
            chrome.storage.local.remove(['pending_view']);
          }
          if (changes.last_batch_count && changes.last_batch_count.newValue) {
            setRecentBatchCount(changes.last_batch_count.newValue);
            chrome.storage.local.remove(['last_batch_count']);
          }
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, []);

  const handleCaptureFullPage = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Capturing entire page...');
    try {
      const item = await captureFullPage(settings);
      setStatusMessage('Full page capture complete!');
      if (item.dataUrl) {
        setHistory((prev) => [item, ...prev]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Full page capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings]);

  const handleCaptureVisible = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Capturing visible viewport...');
    try {
      const item = await captureVisible(settings);
      setStatusMessage('Visible viewport captured!');
      if (item && item.dataUrl) {
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Visible capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings]);

  const handleCaptureSelection = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Starting selection overlay...');
    try {
      const item = await captureSelection(settings);
      setStatusMessage('Selection initiated. Select region on page.');
      if (item.dataUrl) {
        setHistory((prev) => [item, ...prev]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Selection failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings]);

  const handleCaptureAllTabs = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Capturing all tabs in window...');
    try {
      const results = await captureAllTabs(settings, (curr, total, title) => {
        setStatusMessage(`Capturing tab ${curr}/${total}: ${title}`);
      });
      const updated = await getStoredHistory();
      setHistory(updated);
      setStatusMessage(`All ${results.length} tabs captured!`);
      if (results.length > 0) {
        setRecentBatchCount(results.length);
        setView('history');
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'All tabs capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings]);

  const handleSaveSettings = useCallback(async (newSettings: CaptureSettings) => {
    setSettings(newSettings);
    await saveStoredSettings(newSettings);
    setStatusMessage('Options saved successfully');
  }, []);

  const handleDeleteHistoryItem = useCallback(async (id: string) => {
    const updated = await deleteStoredHistoryItem(id);
    setHistory(updated);
  }, []);

  const handleClearHistory = useCallback(async () => {
    await clearStoredHistory();
    setHistory([]);
    setStatusMessage('History cleared');
  }, []);

  const handleBatchResults = useCallback((items: HistoryItem[]) => {
    setHistory((prev) => [...items, ...prev]);
  }, []);

  const handleOpenStudio = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html?tab=true') });
    } else {
      window.open('/?tab=true', '_blank');
    }
  }, []);

  const handleCopyShortcut = useCallback((shortcut: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(shortcut);
    }
    setCopiedShortcut(shortcut);
    setStatusMessage(`Shortcut ${shortcut} copied! Navigate to any tab and press it to ${label.toLowerCase()}.`);
    setTimeout(() => setCopiedShortcut(null), 2500);
  }, []);

  // Full Tab Gallery Hub View
  if (isFullTab) {
    return (
      <div className="min-h-screen w-full bg-[#f8f9fc] flex flex-col items-center py-6 px-4 sm:px-6">
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.02)] border border-zinc-200/80 overflow-hidden min-h-[750px] flex flex-col">
          {/* Full Tab Navigation Bar */}
          <header className="px-6 py-3.5 border-b border-zinc-200/80 flex items-center justify-between bg-white/90 backdrop-blur-xs sticky top-0 z-20">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-blue-50 border border-blue-200/70 shadow-2xs">
                <img src="/yoink-symbol.png" alt="Yoink" className="h-5 w-5 object-contain" />
              </div>
              <img src="/yoink-text.png" alt="Yoink" className="h-6 w-auto object-contain" />
              <span className="text-zinc-300">|</span>
              <span className="text-xs font-semibold text-zinc-600 font-mono">
                Studio Hub
              </span>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200/70 text-xs">
              <button
                onClick={() => setView('history')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  view === 'history'
                    ? 'bg-white text-blue-600 font-semibold shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <History size={14} />
                <span>Gallery</span>
                <span className="text-[10px] font-mono tabular-nums bg-zinc-200/70 text-zinc-700 px-1.5 py-0.2 rounded-full">
                  {history.length}
                </span>
              </button>

              <button
                onClick={() => setView('menu')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  view === 'menu'
                    ? 'bg-white text-blue-600 font-semibold shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Crop size={14} />
                <span>Capture Suite</span>
              </button>

              <button
                onClick={() => setView('urllist')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  view === 'urllist'
                    ? 'bg-white text-blue-600 font-semibold shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Globe size={14} />
                <span>Batch URLs</span>
              </button>

              <button
                onClick={() => setView('multisize')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  view === 'multisize'
                    ? 'bg-white text-blue-600 font-semibold shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Smartphone size={14} />
                <span>Responsive</span>
              </button>

              <button
                onClick={() => setView('options')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  view === 'options'
                    ? 'bg-white text-blue-600 font-semibold shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
            </nav>

            {/* Quick Status Chip */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-50" />
              <span className="text-xs font-mono text-zinc-600">Local Engine Ready</span>
            </div>
          </header>

          {/* Content Area */}
          <main className="flex-1 overflow-hidden relative flex flex-col">
            {view === 'history' && (
              <HistoryDrawer
                history={history}
                onBack={() => {
                  setRecentBatchCount(null);
                  setView('menu');
                }}
                recentBatchBanner={recentBatchCount}
                onDismissBatchBanner={() => setRecentBatchCount(null)}
                onSelectPreview={(item) => setPreviewItem(item)}
                onDeleteItem={handleDeleteHistoryItem}
                onClearAll={handleClearHistory}
                isFullTab={true}
              />
            )}

            {view === 'menu' && (
              <div className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6">
                {/* Hero Header */}
                <div className="bg-gradient-to-br from-blue-50/70 via-white to-indigo-50/40 p-6 rounded-2xl border border-blue-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold tracking-wider uppercase text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded-md">
                      <Sparkles size={11} /> Studio Command Hub
                    </span>
                    <h2 className="text-xl md:text-2xl font-bold text-zinc-900 font-display tracking-tight">
                      Capture, Stitch & Organize with Yoink
                    </h2>
                    <p className="text-xs md:text-sm text-zinc-600 max-w-xl leading-relaxed">
                      All your screenshots, stitches, and batch workflows save directly to this central studio. Use keyboard shortcuts or the toolbar popup on any target tab.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setView('history')}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Open Gallery ({history.length})</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>

                {/* 3-Step Quick Start Workflow */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 p-4 bg-white rounded-2xl border border-zinc-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                  <div className="flex items-start gap-3 p-1">
                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-700 font-mono font-bold flex items-center justify-center shrink-0 text-xs border border-blue-200/60">
                      1
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-900">Browse to Target</h4>
                      <p className="text-[11.5px] text-zinc-600 mt-0.5 leading-snug">
                        Open the website, dashboard, or app you want to capture in any Chrome tab.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-1">
                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-700 font-mono font-bold flex items-center justify-center shrink-0 text-xs border border-blue-200/60">
                      2
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-900">Trigger on Webpage</h4>
                      <p className="text-[11.5px] text-zinc-600 mt-0.5 leading-snug">
                        Press the global shortcut (<kbd className="px-1 py-0.2 bg-zinc-100 rounded border border-zinc-200 font-mono text-[10px]">Alt+Shift+1</kbd>) or click the Yoink toolbar popup.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-1">
                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-700 font-mono font-bold flex items-center justify-center shrink-0 text-xs border border-blue-200/60">
                      3
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-900">Review in Studio</h4>
                      <p className="text-[11.5px] text-zinc-600 mt-0.5 leading-snug">
                        Screenshots land automatically right here in your Gallery to zoom, copy, and export.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Core Capture Capabilities & Global Shortcuts */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-700">
                        Capture Capabilities & Shortcuts
                      </h3>
                      <p className="text-xs text-zinc-600 mt-0.5">
                        These tools operate on any active webpage. Click a shortcut to copy it to your clipboard.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Full Page */}
                    <div
                      onClick={() => handleCopyShortcut('Alt+Shift+1', 'Full Page Capture')}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition cursor-pointer space-y-3 relative"
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                          <FileText size={20} />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyShortcut('Alt+Shift+1', 'Full Page Capture');
                          }}
                          className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 text-zinc-700 hover:text-blue-700 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition"
                          title="Click to copy shortcut"
                        >
                          {copiedShortcut === 'Alt+Shift+1' ? (
                            <>
                              <Check size={11} className="text-emerald-600" />
                              <span className="text-emerald-700">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} className="text-zinc-500" />
                              <span>Alt+Shift+1</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-blue-600 transition">
                          Full Page Capture
                        </h4>
                        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                          Scrolls the entire webpage automatically, suppresses sticky navbars to avoid duplication, and stitches DOM chunks into one seamless image.
                        </p>
                      </div>
                      <div className="pt-1 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span>Trigger: Anywhere on Web</span>
                        <span className="text-blue-600 font-semibold group-hover:underline">Copy Shortcut →</span>
                      </div>
                    </div>

                    {/* Visible Viewport */}
                    <div
                      onClick={() => handleCopyShortcut('Alt+Shift+3', 'Visible Viewport')}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition cursor-pointer space-y-3 relative"
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                          <Monitor size={20} />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyShortcut('Alt+Shift+3', 'Visible Viewport');
                          }}
                          className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 text-zinc-700 hover:text-blue-700 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition"
                          title="Click to copy shortcut"
                        >
                          {copiedShortcut === 'Alt+Shift+3' ? (
                            <>
                              <Check size={11} className="text-emerald-600" />
                              <span className="text-emerald-700">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} className="text-zinc-500" />
                              <span>Alt+Shift+3</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-blue-600 transition">
                          Visible Viewport
                        </h4>
                        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                          Instant 1:1 hardware pixel ratio snapshot of whatever is currently displayed on your active screen with zero compression delay.
                        </p>
                      </div>
                      <div className="pt-1 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span>Trigger: Anywhere on Web</span>
                        <span className="text-blue-600 font-semibold group-hover:underline">Copy Shortcut →</span>
                      </div>
                    </div>

                    {/* Selection Area */}
                    <div
                      onClick={() => handleCopyShortcut('Alt+Shift+4', 'Selection Region')}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition cursor-pointer space-y-3 relative"
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                          <Crop size={20} />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyShortcut('Alt+Shift+4', 'Selection Region');
                          }}
                          className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 text-zinc-700 hover:text-blue-700 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition"
                          title="Click to copy shortcut"
                        >
                          {copiedShortcut === 'Alt+Shift+4' ? (
                            <>
                              <Check size={11} className="text-emerald-600" />
                              <span className="text-emerald-700">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} className="text-zinc-500" />
                              <span>Alt+Shift+4</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-blue-600 transition">
                          Selection Region
                        </h4>
                        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                          Launches an interactive semi-transparent crop overlay on your target page with 8-point resize handles and real-time pixel dimensions.
                        </p>
                      </div>
                      <div className="pt-1 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span>Trigger: Anywhere on Web</span>
                        <span className="text-blue-600 font-semibold group-hover:underline">Copy Shortcut →</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* In-Studio Automation Tools */}
                <div className="space-y-3 pt-1">
                  <div>
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-700">
                      In-Studio Automation Tools
                    </h3>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Batch workflows you can configure and execute directly from this dashboard.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div
                      onClick={() => setView('urllist')}
                      className="p-4 bg-white hover:bg-emerald-50/50 rounded-xl border border-zinc-200 hover:border-emerald-300 transition cursor-pointer flex items-center justify-between group shadow-2xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition">
                          <Globe size={16} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-zinc-900 group-hover:text-emerald-900 transition">Batch URL Capture</h4>
                          <p className="text-[11px] text-zinc-600">Queue & capture a list of websites</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 group-hover:text-emerald-700 transition" />
                    </div>

                    <div
                      onClick={() => setView('multisize')}
                      className="p-4 bg-white hover:bg-sky-50/50 rounded-xl border border-zinc-200 hover:border-sky-300 transition cursor-pointer flex items-center justify-between group shadow-2xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:bg-sky-600 group-hover:text-white transition">
                          <Smartphone size={16} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-zinc-900 group-hover:text-sky-900 transition">Multi-Device Breakpoints</h4>
                          <p className="text-[11px] text-zinc-600">Mobile, Tablet, and Desktop viewports</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 group-hover:text-sky-700 transition" />
                    </div>

                    <div
                      onClick={handleCaptureAllTabs}
                      className="p-4 bg-white hover:bg-indigo-50/50 rounded-xl border border-zinc-200 hover:border-indigo-300 transition cursor-pointer flex items-center justify-between group shadow-2xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition">
                          <Layers size={16} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-zinc-900 group-hover:text-indigo-900 transition">Capture All Window Tabs</h4>
                          <p className="text-[11px] text-zinc-600">Snapshot every tab currently open</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 group-hover:text-indigo-700 transition" />
                    </div>
                  </div>
                </div>

                {/* Future Expansion Callout */}
                <div className="p-4 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white rounded-2xl border border-blue-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Sparkles size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-zinc-900">
                        Studio Hub Workspace Roadmap
                      </h4>
                      <p className="text-[11.5px] text-zinc-600 leading-snug">
                        Upcoming updates will expand this studio area with live in-tab URL rendering, canvas annotations, and multi-capture collage builders.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-100/80 px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0 self-start sm:self-auto border border-blue-200">
                    Active Development
                  </span>
                </div>

                {/* Storage & Engine Info Footer */}
                <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between text-xs font-mono text-zinc-600">
                  <div className="flex items-center gap-4">
                    <span>Format: <b className="text-zinc-900 uppercase">{settings.format}</b></span>
                    <span>Quality: <b className="text-zinc-900">{Math.round(settings.quality * 100)}%</b></span>
                    <span>Auto-Download: <b className="text-zinc-900">{settings.autoDownload ? 'ON' : 'OFF'}</b></span>
                  </div>
                  <button
                    onClick={() => setView('options')}
                    className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                  >
                    Adjust Settings &rarr;
                  </button>
                </div>
              </div>
            )}

            {view === 'urllist' && (
              <UrlBatchModal
                settings={settings}
                onBack={() => setView('menu')}
                onFinished={handleBatchResults}
                onPreview={(item) => setPreviewItem(item)}
              />
            )}

            {view === 'multisize' && (
              <MultiSizeModal
                settings={settings}
                onBack={() => setView('menu')}
                onFinished={handleBatchResults}
                onPreview={(item) => setPreviewItem(item)}
              />
            )}

            {view === 'options' && (
              <OptionsDrawer
                settings={settings}
                onBack={() => setView('menu')}
                onSave={handleSaveSettings}
              />
            )}
          </main>

          {/* Image Preview / Zoom Modal */}
          {previewItem && (
            <ImagePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
          )}
        </div>
      </div>
    );
  }

  // Standard Popup View (370px × 550px)
  return (
    <div className="w-[370px] h-[550px] flex flex-col bg-[#fbfbfd] text-zinc-900 overflow-hidden font-sans border border-zinc-200/80 rounded-2xl shadow-xl">
      {/* Primary View Router */}
      <div className="flex-1 overflow-hidden relative">
        {view === 'menu' && (
          <QuickMenu
            onCaptureFullPage={handleCaptureFullPage}
            onCaptureVisible={handleCaptureVisible}
            onCaptureSelection={handleCaptureSelection}
            onCaptureAllTabs={handleCaptureAllTabs}
            onOpenUrlBatch={() => setView('urllist')}
            onOpenMultiSize={() => setView('multisize')}
            onOpenHistory={() => setView('history')}
            onOpenOptions={() => setView('options')}
            onOpenStudio={handleOpenStudio}
            historyCount={history.length}
            isCapturing={isCapturing}
            activeAction={statusMessage}
          />
        )}

        {view === 'urllist' && (
          <UrlBatchModal
            settings={settings}
            onBack={() => setView('menu')}
            onFinished={handleBatchResults}
            onPreview={(item) => setPreviewItem(item)}
          />
        )}

        {view === 'multisize' && (
          <MultiSizeModal
            settings={settings}
            onBack={() => setView('menu')}
            onFinished={handleBatchResults}
            onPreview={(item) => setPreviewItem(item)}
          />
        )}

        {view === 'history' && (
          <HistoryDrawer
            history={history}
            onBack={() => {
              setRecentBatchCount(null);
              setView('menu');
            }}
            recentBatchBanner={recentBatchCount}
            onDismissBatchBanner={() => setRecentBatchCount(null)}
            onSelectPreview={(item) => setPreviewItem(item)}
            onDeleteItem={handleDeleteHistoryItem}
            onClearAll={handleClearHistory}
            onOpenStudio={handleOpenStudio}
            isFullTab={false}
          />
        )}

        {view === 'options' && (
          <OptionsDrawer
            settings={settings}
            onBack={() => setView('menu')}
            onSave={handleSaveSettings}
          />
        )}
      </div>

      {/* Image Preview / Zoom Modal */}
      {previewItem && (
        <ImagePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
}
