import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  ChevronRight,
  Loader2,
  Check,
  Copy,
  ScrollText,
  ScreenShare,
  Upload,
  RefreshCw,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { CaptureSettings, HistoryItem } from './types';
import {
  DEFAULT_SETTINGS,
  getStoredSettings,
  saveStoredSettings,
  getStoredHistory,
  deleteStoredHistoryItem,
  clearStoredHistory,
  addHistoryItem,
  getFullResolutionImage,
} from './utils/storage';
import { fileToHistoryItem } from './utils/upload';
import {
  captureFullPage,
  captureVisible,
  captureSelection,
  captureScrollingElement,
  captureDesktop,
  captureAllTabs,
  ensureAllSitesAccess,
  getInjectableOpenTabs,
  OpenTabInfo,
} from './utils/capture';
import { getOrCreateProofIdentity } from './utils/proof';
import { QuickMenu } from './components/QuickMenu';
import { UrlBatchModal } from './components/UrlBatchModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { OptionsDrawer } from './components/OptionsDrawer';
import { MultiSizeModal } from './components/MultiSizeModal';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { VerifyModal } from './components/VerifyModal';

type CurrentView = 'menu' | 'urllist' | 'history' | 'options' | 'multisize' | 'verify';

const hasExplicitViewParam = (): boolean => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    return Boolean(v && ['menu', 'urllist', 'history', 'options', 'multisize', 'verify'].includes(v));
  }
  return false;
};

const getInitialView = (): CurrentView => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    if (v && ['menu', 'urllist', 'history', 'options', 'multisize', 'verify'].includes(v)) {
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
  const [isAnnotatingDirectly, setIsAnnotatingDirectly] = useState(false);
  const [isOcrDirectly, setIsOcrDirectly] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<{ dataUrl: string; title: string } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [copiedShortcut, setCopiedShortcut] = useState<string | null>(null);

  const [openTabs, setOpenTabs] = useState<OpenTabInfo[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | undefined>(undefined);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      document.body.className = 'bg-[#fbfbfd] w-[380px] h-[585px] m-0 p-0 overflow-hidden select-none antialiased text-zinc-900 font-sans';
    }
  }, [isFullTab]);

  const refreshOpenTabs = useCallback(async () => {
    setIsLoadingTabs(true);
    try {
      const tabs = await getInjectableOpenTabs();
      setOpenTabs(tabs);
      setSelectedTabId((prev) => {
        if (prev && tabs.some((t) => t.id === prev)) return prev;
        return tabs[0]?.id;
      });
    } finally {
      setIsLoadingTabs(false);
    }
  }, []);

  useEffect(() => {
    if (isFullTab && view === 'menu') {
      void refreshOpenTabs();
    }
  }, [isFullTab, view, refreshOpenTabs]);

  // Load initial settings, history, and proof identity, plus check for pending_view from background captures
  useEffect(() => {
    let pendingViewResolved = false;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pending_view', 'last_batch_count'], (res) => {
        if (res.pending_view) {
          pendingViewResolved = true;
          setView(res.pending_view as CurrentView);
          if (res.last_batch_count) {
            setRecentBatchCount(res.last_batch_count);
          }
          chrome.storage.local.remove(['pending_view', 'last_batch_count']);
        }
      });
    }

    async function loadInitialData() {
      const s = await getStoredSettings();
      setSettings(s);
      const h = await getStoredHistory();
      setHistory(h);
      try {
        await getOrCreateProofIdentity();
      } catch {
        // Proof identity fallback handled internally
      }

      // In Full Tab Studio Hub, default to Gallery when captures exist unless an explicit ?view= or pending_view was requested
      if (!forcePopup && (forceTab || window.innerWidth > 480) && !hasExplicitViewParam() && !pendingViewResolved) {
        if (h.length > 0) {
          setView('history');
        }
      }
    }
    void loadInitialData();

    // Listen for storage changes from background worker
    let storageCleanup: (() => void) | undefined;
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
      storageCleanup = () => chrome.storage.onChanged.removeListener(listener);
    }

    // Listen for runtime capture finished broadcasts
    let runtimeCleanup: (() => void) | undefined;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      const msgListener = (msg: any) => {
        if (msg.action === 'CAPTURE_FINISHED' && msg.payload?.item) {
          const item = msg.payload.item;
          setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
          setPreviewItem(item);
          setIsCapturing(false);
          setStatusMessage('Capture complete!');
        }
      };
      chrome.runtime.onMessage.addListener(msgListener);
      runtimeCleanup = () => chrome.runtime.onMessage.removeListener(msgListener);
    }

    return () => {
      if (storageCleanup) storageCleanup();
      if (runtimeCleanup) runtimeCleanup();
    };
  }, [forcePopup, forceTab]);

  const targetTabForCapture = isFullTab ? selectedTabId : undefined;

  const handleCaptureFullPage = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage(settings.captureDelaySec ? `Capturing in ${settings.captureDelaySec}s…` : 'Scanning page...');
    try {
      if (!isFullTab && settings.captureDelaySec > 0 && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureFullPage(
        settings,
        (msg) => {
          setStatusMessage(msg);
        },
        targetTabForCapture
      );
      setStatusMessage('Full page capture complete!');
      if (item && item.dataUrl) {
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Full page capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab, targetTabForCapture]);

  const handleCaptureVisible = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage(settings.captureDelaySec ? `Capturing in ${settings.captureDelaySec}s…` : 'Capturing visible viewport...');
    try {
      if (!isFullTab && settings.captureDelaySec > 0 && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureVisible(settings, targetTabForCapture);
      setStatusMessage('Visible viewport captured!');
      if (item && item.dataUrl) {
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Visible capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab, targetTabForCapture]);

  const handleCaptureSelection = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Select region on target page...');
    try {
      if (!isFullTab && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureSelection(settings, targetTabForCapture);
      setStatusMessage('Selection captured!');
      if (item && item.dataUrl) {
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Selection failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab, targetTabForCapture]);

  const handleCaptureElement = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Select scrollable element on target page...');
    try {
      if (!isFullTab && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureScrollingElement(settings, targetTabForCapture);
      setStatusMessage('Scrollable element captured!');
      if (item && item.dataUrl) {
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Element capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab, targetTabForCapture]);

  const handleCaptureDesktop = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Select desktop screen or window to capture...');
    try {
      const item = await captureDesktop(settings);
      setStatusMessage('Desktop screen captured!');
      if (item && item.dataUrl) {
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Desktop capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings]);

  const handleCaptureAllTabs = useCallback(async () => {
    try {
      if (!(await ensureAllSitesAccess())) {
        setStatusMessage('Yoink needs access to all sites to capture multiple tabs.');
        return;
      }
      setIsCapturing(true);
      setStatusMessage('Capturing all tabs in window...');
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

  const handleSelectVerifyItem = useCallback(async (item: HistoryItem) => {
    const fullUrl = await getFullResolutionImage(item.id);
    const dataUrl = fullUrl || (item.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null) || item.thumbnailUrl;
    if (!dataUrl) return;
    setVerifyTarget({ dataUrl, title: item.title });
    if (isFullTab) {
      setView('verify');
    } else {
      setShowVerifyModal(true);
    }
  }, [isFullTab]);

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

  // Upload and Edit: import local images, then open the editor for a single file.
  const handleImportFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      setStatusMessage('Error: No image files found.');
      return;
    }
    const imported: HistoryItem[] = [];
    for (const file of images) {
      try {
        const item = await fileToHistoryItem(file);
        await addHistoryItem(item);
        imported.push(item);
      } catch (err: any) {
        setStatusMessage(`Error: ${err.message || 'Import failed'}`);
      }
    }
    if (imported.length === 0) return;
    setHistory((prev) => [...imported, ...prev.filter((p) => !imported.some((i) => i.id === p.id))]);
    setStatusMessage(`Imported ${imported.length} image${imported.length === 1 ? '' : 's'}`);
    if (imported.length === 1) {
      setIsAnnotatingDirectly(true);
      setPreviewItem(imported[0]);
    } else {
      setView('history');
    }
  }, []);

  // Paste an image anywhere in the Studio Hub to import it (unless inside Verify view)
  useEffect(() => {
    if (!isFullTab) return;
    const onPaste = (e: ClipboardEvent) => {
      if (view === 'verify' || showVerifyModal) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        handleImportFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [isFullTab, view, showVerifyModal, handleImportFiles]);

  const handleOpenStudio = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html?tab=true') });
    } else {
      window.open('/?tab=true', '_blank');
    }
  }, []);

  const handleCopyShortcut = useCallback((shortcut: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(shortcut);
    }
    setCopiedShortcut(shortcut);
    setStatusMessage(`Shortcut ${shortcut} copied! Press it on any webpage to trigger ${label}.`);
    setTimeout(() => setCopiedShortcut(null), 2500);
  }, []);

  const selectedTabObj = openTabs.find((t) => t.id === selectedTabId) || openTabs[0];

  // Full Tab Studio Hub View
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
                onClick={() => setView('verify')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  view === 'verify'
                    ? 'bg-white text-emerald-700 font-semibold shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <ShieldCheck size={14} className="text-emerald-600" />
                <span>Proof Vault</span>
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
              {isCapturing ? (
                <>
                  <Loader2 size={14} className="animate-spin text-blue-600" />
                  <span className="text-xs font-mono text-blue-700 font-semibold max-w-[180px] truncate">
                    {statusMessage}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-50" />
                  <span className="text-xs font-mono text-zinc-600">Local Engine Ready</span>
                </>
              )}
            </div>
          </header>

          {/* Content Area */}
          <main
            className="flex-1 overflow-hidden relative flex flex-col"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault();
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length > 0) {
                e.preventDefault();
                handleImportFiles(Array.from(e.dataTransfer.files));
              }
            }}
          >
            {view === 'history' && (
              <HistoryDrawer
                history={history}
                onImportFiles={handleImportFiles}
                onBack={() => {
                  setRecentBatchCount(null);
                  setView('menu');
                }}
                recentBatchBanner={recentBatchCount}
                onDismissBatchBanner={() => setRecentBatchCount(null)}
                onSelectPreview={(item) => {
                  setIsAnnotatingDirectly(false);
                  setIsOcrDirectly(false);
                  setPreviewItem(item);
                }}
                onSelectAnnotate={(item) => {
                  setIsAnnotatingDirectly(true);
                  setIsOcrDirectly(false);
                  setPreviewItem(item);
                }}
                onSelectOcr={(item) => {
                  setIsAnnotatingDirectly(false);
                  setIsOcrDirectly(true);
                  setPreviewItem(item);
                }}
                onSelectVerify={handleSelectVerifyItem}
                onDeleteItem={handleDeleteHistoryItem}
                onClearAll={handleClearHistory}
                isFullTab={true}
              />
            )}

            {view === 'menu' && (
              <div className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6">
                {/* Hidden File Input for Local Import Card */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) handleImportFiles(files);
                    e.target.value = '';
                  }}
                />

                {/* Hero Command Header + Target Browser Tab Selector */}
                <div className="bg-gradient-to-br from-blue-50/70 via-white to-indigo-50/40 p-6 rounded-2xl border border-blue-100 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold tracking-wider uppercase text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded-md">
                        <Sparkles size={11} /> Studio Capture Launcher
                      </span>
                      <h2 className="text-xl md:text-2xl font-bold text-zinc-900 font-display tracking-tight">
                        Launch Any Capture Directly from Studio
                      </h2>
                      <p className="text-xs md:text-sm text-zinc-600 max-w-xl leading-relaxed">
                        Choose an open browser tab below and click any capture tool. Yoink will automatically switch to your target tab, capture it with cryptographically verifiable proof, and return the result right here.
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        onClick={() => setView('history')}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Open Gallery ({history.length})</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Live Target Browser Tab Bar */}
                  <div className="bg-white/95 p-3.5 rounded-xl border border-blue-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200/60 flex items-center justify-center shrink-0">
                        {selectedTabObj?.favIconUrl ? (
                          <img src={selectedTabObj.favIconUrl} alt="" className="w-4 h-4 rounded-xs object-contain" />
                        ) : (
                          <Globe size={15} className="text-blue-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-blue-700">
                            Target Browser Tab
                          </label>
                          <span className="text-[10px] font-mono text-zinc-500">
                            ({openTabs.length} capturable {openTabs.length === 1 ? 'tab' : 'tabs'} open)
                          </span>
                        </div>
                        {openTabs.length > 0 ? (
                          <select
                            value={selectedTabId ?? openTabs[0]?.id ?? ''}
                            onChange={(e) => setSelectedTabId(Number(e.target.value))}
                            className="mt-1 w-full text-xs font-semibold text-zinc-900 bg-zinc-50 hover:bg-zinc-100/80 border border-zinc-200/90 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer truncate"
                          >
                            {openTabs.map((tab) => (
                              <option key={tab.id} value={tab.id}>
                                {tab.title} — {tab.url}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-xs text-amber-700 font-medium mt-0.5">
                            No capturable web tabs detected. Open any http:// or https:// website in another tab and click Refresh.
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={refreshOpenTabs}
                      disabled={isLoadingTabs}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 text-zinc-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 self-start sm:self-center"
                      title="Refresh open browser tabs"
                    >
                      <RefreshCw size={13} className={isLoadingTabs ? 'animate-spin text-blue-600' : ''} />
                      <span>Refresh Tabs</span>
                    </button>
                  </div>

                  {/* Status Feedback Banner */}
                  {(isCapturing || (statusMessage && statusMessage !== 'Ready')) && (
                    <div className="px-3.5 py-2 rounded-xl bg-blue-950 text-white text-xs font-mono flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        {isCapturing ? (
                          <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
                        ) : (
                          <Check size={13} className="text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate">{statusMessage}</span>
                      </div>
                      {!isCapturing && (
                        <button
                          onClick={() => setStatusMessage('Ready')}
                          className="text-[10px] text-zinc-400 hover:text-white cursor-pointer shrink-0"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Primary One-Click Capture Tools */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-700">
                        One-Click Page & Screen Captures
                      </h3>
                      <p className="text-xs text-zinc-600 mt-0.5">
                        Click any card to immediately capture <b className="text-zinc-800">{selectedTabObj ? selectedTabObj.title : 'your target tab'}</b>, or copy its global keyboard shortcut.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Full Page */}
                    <div
                      onClick={handleCaptureFullPage}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-400 hover:shadow-md transition cursor-pointer space-y-3 relative flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                            <FileText size={20} />
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyShortcut('Alt+Shift+1', 'Full Page Capture');
                            }}
                            className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 text-zinc-700 hover:text-blue-700 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer"
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
                            Scrolls the entire webpage automatically, preserves top navbars once, and streams DOM chunks into one seamless image with cryptographic verification.
                          </p>
                        </div>
                      </div>
                      <div className="pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span className="truncate max-w-[140px]">
                          {selectedTabObj ? selectedTabObj.title : 'Active Webpage'}
                        </span>
                        <span className="text-blue-600 font-semibold inline-flex items-center gap-1 group-hover:translate-x-0.5 transition">
                          <Play size={11} className="fill-current" /> Capture Now →
                        </span>
                      </div>
                    </div>

                    {/* Visible Viewport */}
                    <div
                      onClick={handleCaptureVisible}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-400 hover:shadow-md transition cursor-pointer space-y-3 relative flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                            <Monitor size={20} />
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyShortcut('Alt+Shift+3', 'Visible Viewport');
                            }}
                            className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 text-zinc-700 hover:text-blue-700 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer"
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
                            Instant 1:1 hardware pixel ratio snapshot of the target tab's visible viewport with zero compression delay.
                          </p>
                        </div>
                      </div>
                      <div className="pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span className="truncate max-w-[140px]">
                          {selectedTabObj ? selectedTabObj.title : 'Active Webpage'}
                        </span>
                        <span className="text-blue-600 font-semibold inline-flex items-center gap-1 group-hover:translate-x-0.5 transition">
                          <Play size={11} className="fill-current" /> Capture Now →
                        </span>
                      </div>
                    </div>

                    {/* Selection Area */}
                    <div
                      onClick={handleCaptureSelection}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-blue-400 hover:shadow-md transition cursor-pointer space-y-3 relative flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition">
                            <Crop size={20} />
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyShortcut('Alt+Shift+4', 'Selection Region');
                            }}
                            className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 text-zinc-700 hover:text-blue-700 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer"
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
                            Switches to your target tab and opens an isolated Shadow DOM crop overlay with real-time pixel dimensions.
                          </p>
                        </div>
                      </div>
                      <div className="pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span className="truncate max-w-[140px]">
                          {selectedTabObj ? selectedTabObj.title : 'Active Webpage'}
                        </span>
                        <span className="text-blue-600 font-semibold inline-flex items-center gap-1 group-hover:translate-x-0.5 transition">
                          <Play size={11} className="fill-current" /> Select Region →
                        </span>
                      </div>
                    </div>

                    {/* Scrollable Element */}
                    <div
                      onClick={handleCaptureElement}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-cyan-400 hover:shadow-md transition cursor-pointer space-y-3 relative flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center group-hover:bg-cyan-600 group-hover:text-white transition">
                            <ScrollText size={20} />
                          </div>
                          <span className="px-2 py-0.5 rounded-lg bg-cyan-50 text-cyan-700 border border-cyan-200 font-mono text-[10.5px] font-semibold">
                            DOM Inspector
                          </span>
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-cyan-700 transition">
                            Scrollable Element
                          </h4>
                          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                            Hover and click any scrollable container (chat log, side drawer, code block, data table) to scroll and stitch its overflow.
                          </p>
                        </div>
                      </div>
                      <div className="pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span className="truncate max-w-[140px]">
                          {selectedTabObj ? selectedTabObj.title : 'Active Webpage'}
                        </span>
                        <span className="text-cyan-700 font-semibold group-hover:translate-x-0.5 transition">
                          Launch Inspector →
                        </span>
                      </div>
                    </div>

                    {/* Desktop Screen */}
                    <div
                      onClick={handleCaptureDesktop}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-emerald-400 hover:shadow-md transition cursor-pointer space-y-3 relative flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition">
                            <ScreenShare size={20} />
                          </div>
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10.5px] font-semibold">
                            Display Media
                          </span>
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-emerald-700 transition">
                            Desktop / App Window
                          </h4>
                          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                            Capture your entire monitor display, individual desktop application window, or Chrome tab at full display resolution.
                          </p>
                        </div>
                      </div>
                      <div className="pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span>System Picker</span>
                        <span className="text-emerald-700 font-semibold group-hover:translate-x-0.5 transition">
                          Share Screen →
                        </span>
                      </div>
                    </div>

                    {/* Import / Annotate Local Image */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="group bg-white p-5 rounded-2xl border border-zinc-200/90 hover:border-purple-400 hover:shadow-md transition cursor-pointer space-y-3 relative flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition">
                            <Upload size={20} />
                          </div>
                          <span className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[10.5px] font-semibold">
                            Ctrl+V or Drop
                          </span>
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-zinc-900 group-hover:text-purple-700 transition">
                            Import & Annotate Image
                          </h4>
                          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                            Upload any local screenshot or paste from your clipboard to annotate, redact sensitive data, or run offline OCR.
                          </p>
                        </div>
                      </div>
                      <div className="pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-600">
                        <span>Local File / Clipboard</span>
                        <span className="text-purple-700 font-semibold group-hover:translate-x-0.5 transition">
                          Browse Files →
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Multi-Tab & Responsive Automation Workflows */}
                <div className="space-y-3 pt-1">
                  <div>
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-700">
                      Batch & Multi-Viewport Automation
                    </h3>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Automated multi-tab and responsive breakpoint pipelines.
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
                          <h4 className="font-semibold text-xs text-zinc-900 group-hover:text-sky-900 transition">Responsive Breakpoints</h4>
                          <p className="text-[11px] text-zinc-600">Mobile, Tablet, and Desktop viewports</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-zinc-600 group-hover:translate-x-0.5 group-hover:text-sky-700 transition" />
                    </div>

                    <div
                      onClick={() => handleCaptureAllTabs()}
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

                {/* Storage & Engine Info Footer */}
                <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between text-xs font-mono text-zinc-600">
                  <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                    {settings.optimalQualityMode && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold font-mono text-[10px] uppercase border border-blue-200">
                        ✨ Optimal HD (2x)
                      </span>
                    )}
                    <span>Format: <b className="text-zinc-900 uppercase">{settings.format}</b></span>
                    <span>Scale: <b className="text-zinc-900">{settings.scaleFactor || 1}x</b></span>
                    <span>Quality: <b className="text-zinc-900">{settings.losslessWebp && settings.format === 'webp' ? 'Lossless' : `${Math.round(settings.quality * 100)}%`}</b></span>
                    <span>Auto-Download: <b className="text-zinc-900">{settings.autoDownload ? 'ON' : 'OFF'}</b></span>
                  </div>
                  <button
                    onClick={() => setView('options')}
                    className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer shrink-0"
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
                isFullTab={true}
              />
            )}

            {view === 'multisize' && (
              <MultiSizeModal
                settings={settings}
                onBack={() => setView('menu')}
                onFinished={handleBatchResults}
                onPreview={(item) => setPreviewItem(item)}
                isFullTab={true}
              />
            )}

            {view === 'verify' && (
              <VerifyModal
                inline={true}
                initialDataUrl={verifyTarget?.dataUrl}
                initialTitle={verifyTarget?.title}
              />
            )}

            {view === 'options' && (
              <OptionsDrawer
                settings={settings}
                onBack={() => setView('menu')}
                onSave={handleSaveSettings}
                onOpenVerify={() => {
                  setVerifyTarget(null);
                  setView('verify');
                }}
                isFullTab={true}
              />
            )}
          </main>

          {/* Modal Overlays (VerifyModal when triggered from ImagePreviewModal, or ImagePreviewModal itself) */}
          {showVerifyModal && (
            <VerifyModal
              initialDataUrl={verifyTarget?.dataUrl}
              initialTitle={verifyTarget?.title}
              onClose={() => setShowVerifyModal(false)}
            />
          )}

          {previewItem && (
            <ImagePreviewModal
              item={previewItem}
              initialAnnotating={isAnnotatingDirectly}
              initialOcr={isOcrDirectly}
              maxSliceHeight={settings.maxSliceHeight}
              onClose={() => {
                setPreviewItem(null);
                setIsAnnotatingDirectly(false);
                setIsOcrDirectly(false);
              }}
              onSaved={(newItem) => {
                setHistory((prev) => [newItem, ...prev.filter((i) => i.id !== newItem.id)]);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // Standard Popup View (380px × 585px, safe under Chrome 600px limit)
  return (
    <div className="w-[380px] h-[585px] max-h-[600px] flex flex-col bg-[#fbfbfd] text-zinc-900 overflow-hidden font-sans border border-zinc-200/80 rounded-2xl shadow-xl">
      {/* Primary View Router */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {view === 'menu' && (
          <QuickMenu
            onCaptureFullPage={handleCaptureFullPage}
            onCaptureVisible={handleCaptureVisible}
            onCaptureSelection={handleCaptureSelection}
            onCaptureElement={handleCaptureElement}
            onCaptureDesktop={handleCaptureDesktop}
            onCaptureAllTabs={() => handleCaptureAllTabs()}
            onOpenUrlBatch={() => setView('urllist')}
            onOpenMultiSize={() => setView('multisize')}
            onOpenHistory={() => setView('history')}
            onOpenOptions={() => setView('options')}
            onOpenStudio={handleOpenStudio}
            onOpenVerify={() => {
              setVerifyTarget(null);
              setShowVerifyModal(true);
            }}
            onUploadFiles={handleImportFiles}
            delaySec={settings.captureDelaySec}
            onSetDelaySec={(sec) => handleSaveSettings({ ...settings, captureDelaySec: sec })}
            optimalQualityMode={settings.optimalQualityMode}
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
            onSelectPreview={(item) => {
              setIsAnnotatingDirectly(false);
              setIsOcrDirectly(false);
              setPreviewItem(item);
            }}
            onSelectAnnotate={(item) => {
              setIsAnnotatingDirectly(true);
              setIsOcrDirectly(false);
              setPreviewItem(item);
            }}
            onSelectOcr={(item) => {
              setIsAnnotatingDirectly(false);
              setIsOcrDirectly(true);
              setPreviewItem(item);
            }}
            onSelectVerify={handleSelectVerifyItem}
            onDeleteItem={handleDeleteHistoryItem}
            onClearAll={handleClearHistory}
            onOpenStudio={handleOpenStudio}
            onImportFiles={handleImportFiles}
            isFullTab={false}
          />
        )}

        {view === 'options' && (
          <OptionsDrawer
            settings={settings}
            onBack={() => setView('menu')}
            onSave={handleSaveSettings}
            onOpenVerify={() => {
              setVerifyTarget(null);
              setShowVerifyModal(true);
            }}
          />
        )}
      </div>

      {/* Image Preview / Zoom Modal */}
      {showVerifyModal && (
        <VerifyModal
          initialDataUrl={verifyTarget?.dataUrl}
          initialTitle={verifyTarget?.title}
          onClose={() => setShowVerifyModal(false)}
        />
      )}
      {previewItem && (
        <ImagePreviewModal
          item={previewItem}
          initialAnnotating={isAnnotatingDirectly}
          initialOcr={isOcrDirectly}
          maxSliceHeight={settings.maxSliceHeight}
          onClose={() => {
            setPreviewItem(null);
            setIsAnnotatingDirectly(false);
            setIsOcrDirectly(false);
          }}
          onSaved={(newItem) => {
            setHistory((prev) => [newItem, ...prev.filter((i) => i.id !== newItem.id)]);
          }}
        />
      )}
    </div>
  );
}
