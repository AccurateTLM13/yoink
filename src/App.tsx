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
                      <Sparkles size={11} /> High Precision Offline Capture
                    </span>
                    <h2 className="text-xl md:text-2xl font-bold text-zinc-900 font-display tracking-tight">
                      Capture, Stitch & Organize with Yoink
                    </h2>
                    <p className="text-xs md:text-sm text-zinc-600 max-w-xl">
                      Ultra-fast screenshot pipeline operating entirely in your browser using Chrome Offscreen Canvas.
                    </p>
                  </div>

                  <button
                    onClick={() => setView('history')}
                    className="self-start md:self-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>View Gallery ({history.length})</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* Direct Capture Options Grid */}
                <div className="space-y-3">
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-600">
                    Instant Capture Triggers
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Full Page */}
                    <div
                      onClick={handleCaptureFullPage}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition cursor-pointer space-y-3"
                    >
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                        <FileText size={20} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-blue-600 transition">
                            Full Page Capture
                          </h4>
                          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-100 rounded border border-zinc-200 text-zinc-600">
                            Alt+Shift+1
                          </kbd>
                        </div>
                        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                          Scrolls the entire webpage seamlessly, hiding sticky navbars, and stitches into one crisp high-res image.
                        </p>
                      </div>
                    </div>

                    {/* Visible Viewport */}
                    <div
                      onClick={handleCaptureVisible}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition cursor-pointer space-y-3"
                    >
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                        <Monitor size={20} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-blue-600 transition">
                            Visible Viewport
                          </h4>
                          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-100 rounded border border-zinc-200 text-zinc-600">
                            Alt+Shift+3
                          </kbd>
                        </div>
                        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                          Instantly takes a snapshot of whatever is currently displayed on screen at 1:1 hardware device pixel ratio.
                        </p>
                      </div>
                    </div>

                    {/* Selection Area */}
                    <div
                      onClick={handleCaptureSelection}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition cursor-pointer space-y-3"
                    >
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                        <Crop size={20} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-blue-600 transition">
                            Selection Region
                          </h4>
                          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-100 rounded border border-zinc-200 text-zinc-600">
                            Alt+Shift+4
                          </kbd>
                        </div>
                        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                          Launches interactive crop overlay with 8-point resize handles and real-time pixel dimension counters.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Workflow Cards Grid */}
                <div className="space-y-3 pt-2">
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-600">
                    Advanced Workflows
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div
                      onClick={handleCaptureAllTabs}
                      className="p-4 bg-zinc-50/70 hover:bg-zinc-100/80 rounded-xl border border-zinc-200/80 transition cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                          <Layers size={16} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-zinc-900">All Window Tabs</h4>
                          <p className="text-[11px] text-zinc-600">Batch capture all open tabs</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 transition" />
                    </div>

                    <div
                      onClick={() => setView('urllist')}
                      className="p-4 bg-zinc-50/70 hover:bg-zinc-100/80 rounded-xl border border-zinc-200/80 transition cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <Globe size={16} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-zinc-900">Batch URL Capture</h4>
                          <p className="text-[11px] text-zinc-600">Queue list of target websites</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 transition" />
                    </div>

                    <div
                      onClick={() => setView('multisize')}
                      className="p-4 bg-zinc-50/70 hover:bg-zinc-100/80 rounded-xl border border-zinc-200/80 transition cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                          <Smartphone size={16} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-zinc-900">Multi-Device Breakpoints</h4>
                          <p className="text-[11px] text-zinc-600">Mobile, Tablet, Desktop 4K</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 transition" />
                    </div>
                  </div>
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
