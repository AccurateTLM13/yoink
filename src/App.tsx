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
  ShieldCheck,
  LayoutGrid,
  Upload,
  Pencil,
  ScanText,
  KeyRound,
  Stamp,
  Zap,
  Image as ImageIcon,
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
  applyOptimalQualityPreset,
  getFullResolutionImage,
  saveFullResolutionImage,
  copyImageToClipboard,
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
  const [proofKeyId, setProofKeyId] = useState<string>('Generating...');
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [copiedShortcut, setCopiedShortcut] = useState<string | null>(null);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const studioUploadRef = useRef<HTMLInputElement>(null);

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
      document.body.className = 'bg-[#f4f6fa] w-full min-h-screen m-0 p-0 select-none antialiased overflow-y-auto text-zinc-900 font-sans';
    } else {
      document.body.className = 'bg-[#fbfbfd] w-[380px] h-[585px] m-0 p-0 overflow-hidden select-none antialiased text-zinc-900 font-sans';
    }
  }, [isFullTab]);

  // Load initial settings, history, and Proof Identity, plus check for pending_view from background captures
  useEffect(() => {
    async function loadInitialData() {
      const s = await getStoredSettings();
      setSettings(s);
      const h = await getStoredHistory();
      setHistory(h);
      try {
        const identity = await getOrCreateProofIdentity();
        setProofKeyId(`#${identity.keyFingerprint}`);
      } catch {
        setProofKeyId('Local ECDSA P-256');
      }
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

    // Listen for storage changes from background worker or popup
    let storageCleanup: (() => void) | undefined;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      const listener = (changes: any, area: string) => {
        if (changes.omnicapture_settings?.newValue) {
          setSettings((prev) => ({ ...prev, ...changes.omnicapture_settings.newValue }));
        }
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
          const item = msg.payload.item as HistoryItem;
          if (item.dataUrl) {
            saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
          }
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
  }, []);

  const handleCaptureFullPage = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage(settings.captureDelaySec ? `Capturing in ${settings.captureDelaySec}s…` : 'Scanning page...');
    try {
      // P1-6: close the popup during a countdown so the user can interact with the page.
      if (!isFullTab && settings.captureDelaySec > 0 && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureFullPage(settings, (msg) => {
        setStatusMessage(msg);
      });
      setStatusMessage('Full page capture complete!');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Full page capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab]);

  const handleCaptureVisible = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage(settings.captureDelaySec ? `Capturing in ${settings.captureDelaySec}s…` : 'Capturing visible viewport...');
    try {
      if (!isFullTab && settings.captureDelaySec > 0 && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureVisible(settings);
      setStatusMessage('Visible viewport captured!');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Visible capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab]);

  const handleCaptureSelection = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Select region on page...');
    try {
      // In popup mode, close popup after brief delay so user can draw rectangle on webpage
      if (!isFullTab && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureSelection(settings);
      setStatusMessage('Selection captured!');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Selection failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab]);

  const handleCaptureElement = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Select scrollable element on page...');
    try {
      if (!isFullTab && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureScrollingElement(settings);
      setStatusMessage('Scrollable element captured!');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        setHistory((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        setPreviewItem(item);
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Element capture failed'}`);
    } finally {
      setIsCapturing(false);
    }
  }, [settings, isFullTab]);

  const handleCaptureDesktop = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage('Select desktop screen or window to capture...');
    try {
      const item = await captureDesktop(settings);
      setStatusMessage('Desktop screen captured!');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
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

  const handleSaveSettings = useCallback(async (newSettings: CaptureSettings) => {
    setSettings(newSettings);
    await saveStoredSettings(newSettings);
    setStatusMessage('Options saved successfully');
  }, []);

  const handleToggleOptimalHD = useCallback(() => {
    if (settings.optimalQualityMode) {
      handleSaveSettings({
        ...settings,
        optimalQualityMode: false,
        scaleFactor: 1,
        autoSliceLongPages: false,
      });
    } else {
      handleSaveSettings(applyOptimalQualityPreset(settings));
    }
  }, [settings, handleSaveSettings]);

  const handleToggleProof = useCallback(() => {
    handleSaveSettings({ ...settings, enableProof: !(settings.enableProof ?? true) });
  }, [settings, handleSaveSettings]);

  const handleToggleReceiptStamp = useCallback(() => {
    handleSaveSettings({ ...settings, proofVisualStamp: !settings.proofVisualStamp });
  }, [settings, handleSaveSettings]);

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

  // Open Yoink Proof™ Inspector for a specific HistoryItem
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

  // Quick copy from Command Center Recent Strip
  const handleQuickCopyItem = useCallback(async (item: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const fullUrl = await getFullResolutionImage(item.id);
    const dataUrl = fullUrl || (item.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null) || item.thumbnailUrl;
    if (!dataUrl) return;
    const ok = await copyImageToClipboard(dataUrl);
    if (ok) {
      setCopiedItemId(item.id);
      setStatusMessage(`Copied "${item.title}" to clipboard`);
      setTimeout(() => setCopiedItemId(null), 2000);
    }
  }, []);

  // P1-7 Upload and Edit: import local images, then open the editor for a single file.
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

  // Paste an image anywhere in the Studio Hub to import it.
  useEffect(() => {
    if (!isFullTab) return;
    const onPaste = (e: ClipboardEvent) => {
      // Do not intercept paste when user is inside Verify view (VerifyModal handles its own paste)
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
      navigator.clipboard.writeText(shortcut);
    }
    setCopiedShortcut(shortcut);
    setStatusMessage(`Shortcut ${shortcut} copied! Navigate to any tab and press it to ${label.toLowerCase()}.`);
    setTimeout(() => setCopiedShortcut(null), 2500);
  }, []);

  // Full Tab Studio Hub View — Reworked Sidebar + Command Center Architecture
  if (isFullTab) {
    const viewMeta: Record<CurrentView, { title: string; subtitle: string }> = {
      menu: {
        title: 'Studio Command Center',
        subtitle: 'Launch captures, annotate, extract OCR text, automate batches, or verify cryptographic provenance',
      },
      history: {
        title: 'Capture Gallery & Vault',
        subtitle: `${history.length} saved screenshot${history.length === 1 ? '' : 's'} — search, filter, slice, export PDF, annotate, or inspect proof`,
      },
      urllist: {
        title: 'Batch URL Automation',
        subtitle: 'Queue multiple URLs for sequential headless tab capture & automatic gallery indexing',
      },
      multisize: {
        title: 'Responsive Device Breakpoints',
        subtitle: 'Capture any target URL simultaneously across Mobile, Tablet, Laptop, and Desktop viewports',
      },
      verify: {
        title: 'Yoink Proof™ Verification Vault',
        subtitle: 'Inspect cryptographic ECDSA P-256 signatures, IPTC screenCapture claims, and pixel tamper resistance',
      },
      options: {
        title: 'Engine & Provenance Settings',
        subtitle: 'Configure Retina 2x scaling, anti-squish page slicing, sticky header suppression, and Yoink Proof™',
      },
    };

    const recentItems = history.slice(0, 4);

    return (
      <div className="min-h-screen w-full bg-[#f4f6fa] flex flex-col p-2 sm:p-4 lg:p-5">
        <input
          ref={studioUploadRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            if (files.length > 0) handleImportFiles(files);
          }}
        />

        <div className="w-full max-w-[1440px] mx-auto bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.03)] border border-zinc-200/90 overflow-hidden flex flex-col md:flex-row min-h-[calc(100vh-2.5rem)]">
          {/* LEFT SIDEBAR RAIL */}
          <aside className="w-full md:w-64 lg:w-68 bg-[#fbfcfd] border-b md:border-b-0 md:border-r border-zinc-200/80 flex flex-col justify-between shrink-0">
            <div>
              {/* Brand Header */}
              <div className="px-5 py-4 border-b border-zinc-200/70 flex items-center justify-between">
                <div
                  onClick={() => setView('menu')}
                  className="flex items-center gap-2.5 cursor-pointer group"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 border border-blue-200/80 shadow-2xs group-hover:bg-blue-100 transition">
                    <img src="/yoink-symbol.png" alt="Yoink" className="h-5 w-5 object-contain" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <img src="/yoink-text.png" alt="Yoink" className="h-5 w-auto object-contain" />
                      <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-blue-100 text-blue-700 rounded-md border border-blue-200/70">
                        Studio
                      </span>
                    </div>
                    <p className="text-[10.5px] text-zinc-500 font-mono mt-0.5">
                      Capture & Provenance Suite
                    </p>
                  </div>
                </div>
              </div>

              {/* Navigation Sections */}
              <div className="p-3 space-y-4">
                {/* Group 1: Workspace */}
                <div>
                  <div className="px-2.5 pb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                    Workspace
                  </div>
                  <div className="space-y-1">
                    <button
                      onClick={() => setView('menu')}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                        view === 'menu'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-zinc-100/90 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <LayoutGrid size={15} className={view === 'menu' ? 'text-white' : 'text-blue-600'} />
                        <span>Command Center</span>
                      </span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                          view === 'menu'
                            ? 'bg-blue-700 text-blue-100'
                            : 'bg-zinc-100 text-zinc-500'
                        }`}
                      >
                        Hub
                      </span>
                    </button>

                    <button
                      onClick={() => setView('history')}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                        view === 'history'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-zinc-100/90 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <History size={15} className={view === 'history' ? 'text-white' : 'text-indigo-600'} />
                        <span>Capture Gallery</span>
                      </span>
                      <span
                        className={`text-[10.5px] font-mono tabular-nums px-2 py-0.5 rounded-full font-semibold ${
                          view === 'history'
                            ? 'bg-white text-blue-700'
                            : 'bg-zinc-200/75 text-zinc-700'
                        }`}
                      >
                        {history.length}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Group 2: Automation & Multi-Capture */}
                <div>
                  <div className="px-2.5 pb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                    Batch & Automation
                  </div>
                  <div className="space-y-1">
                    <button
                      onClick={() => setView('urllist')}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                        view === 'urllist'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-zinc-100/90 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Globe size={15} className={view === 'urllist' ? 'text-white' : 'text-emerald-600'} />
                        <span>Batch URL Queue</span>
                      </span>
                      <ChevronRight size={13} className={view === 'urllist' ? 'text-blue-200' : 'text-zinc-400'} />
                    </button>

                    <button
                      onClick={() => setView('multisize')}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                        view === 'multisize'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-zinc-100/90 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Smartphone size={15} className={view === 'multisize' ? 'text-white' : 'text-sky-600'} />
                        <span>Responsive Viewports</span>
                      </span>
                      <ChevronRight size={13} className={view === 'multisize' ? 'text-blue-200' : 'text-zinc-400'} />
                    </button>

                    <button
                      onClick={handleCaptureAllTabs}
                      disabled={isCapturing}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between text-zinc-700 hover:bg-indigo-50/80 hover:text-indigo-900 disabled:opacity-50"
                      title="Capture every open tab in this browser window"
                    >
                      <span className="flex items-center gap-2.5">
                        <Layers size={15} className="text-indigo-600" />
                        <span>Capture All Open Tabs</span>
                      </span>
                      <span className="text-[9.5px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                        1-Click
                      </span>
                    </button>
                  </div>
                </div>

                {/* Group 3: Trust & Engine */}
                <div>
                  <div className="px-2.5 pb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                    Provenance & Engine
                  </div>
                  <div className="space-y-1">
                    <button
                      onClick={() => {
                        setVerifyTarget(null);
                        setView('verify');
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                        view === 'verify'
                          ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-emerald-50/70 hover:text-emerald-950'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <ShieldCheck size={15} className={view === 'verify' ? 'text-white' : 'text-emerald-600'} />
                        <span>Yoink Proof™ Vault</span>
                      </span>
                      <span
                        className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          view === 'verify'
                            ? 'bg-emerald-700 text-emerald-100'
                            : 'bg-emerald-100/80 text-emerald-800'
                        }`}
                      >
                        Verify
                      </span>
                    </button>

                    <button
                      onClick={() => setView('options')}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                        view === 'options'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-zinc-700 hover:bg-zinc-100/90 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Settings size={15} className={view === 'options' ? 'text-white' : 'text-zinc-600'} />
                        <span>Engine Settings</span>
                      </span>
                      <ChevronRight size={13} className={view === 'options' ? 'text-blue-200' : 'text-zinc-400'} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Engine & Cryptographic Identity Dock (Bottom of Sidebar) */}
            <div className="p-3 border-t border-zinc-200/80 bg-zinc-50/70 space-y-2.5">
              {/* Cryptographic Identity Badge & Live Creator Handle Input */}
              <div className="p-2.5 rounded-xl bg-white border border-zinc-200/80 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
                    <KeyRound size={11} className="text-emerald-600" /> Device Key ID
                  </span>
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> ECDSA P-256
                  </span>
                </div>
                <div className="font-mono text-[11px] font-bold text-zinc-800 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-200/60 truncate text-center">
                  {proofKeyId}
                </div>
                <div className="pt-1">
                  <div className="flex items-center justify-between text-[9.5px] font-mono text-zinc-500 mb-1">
                    <span>Creator Handle</span>
                    {settings.proofAuthor && (
                      <span className="text-emerald-700 font-semibold">✓ Auto-saved</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={settings.proofAuthor || ''}
                    onChange={(e) => handleSaveSettings({ ...settings, proofAuthor: e.target.value })}
                    placeholder="@yourhandle (sealed in proof)"
                    maxLength={60}
                    className="w-full px-2 py-1 text-[11px] font-mono bg-zinc-50 focus:bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-emerald-500 text-zinc-800 select-text"
                  />
                </div>
              </div>

              {/* Live Engine Quick Toggles */}
              <div className="p-2.5 rounded-xl bg-white border border-zinc-200/80 shadow-2xs space-y-1.5">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 px-0.5">
                  Live Capture Toggles
                </div>

                {/* Toggle 1: Optimal HD */}
                <button
                  onClick={handleToggleOptimalHD}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-50 transition cursor-pointer text-left"
                  title="Toggle 2x Retina DPI & Lossless WebP/PNG preset"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-700">
                    <Sparkles size={12} className={settings.optimalQualityMode ? 'text-blue-600' : 'text-zinc-400'} />
                    <span>Optimal HD (2x)</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                      settings.optimalQualityMode
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {settings.optimalQualityMode ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* Toggle 2: Yoink Proof Signing */}
                <button
                  onClick={handleToggleProof}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-50 transition cursor-pointer text-left"
                  title="Sign captures with ECDSA P-256 & embed IPTC screenCapture + LSB watermark"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-700">
                    <ShieldCheck size={12} className={(settings.enableProof ?? true) ? 'text-emerald-600' : 'text-zinc-400'} />
                    <span>Yoink Proof™ Sign</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                      (settings.enableProof ?? true)
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {(settings.enableProof ?? true) ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* Toggle 3: Receipt Mode Visual Stamp */}
                <button
                  onClick={handleToggleReceiptStamp}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-50 transition cursor-pointer text-left"
                  title="Append a sleek visual provenance receipt bar (URL, UTC time, SHA-256 & Key ID) to the bottom of captures"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-700">
                    <Stamp size={12} className={settings.proofVisualStamp ? 'text-indigo-600' : 'text-zinc-400'} />
                    <span>Receipt Footer</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                      settings.proofVisualStamp
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {settings.proofVisualStamp ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>
          </aside>

          {/* MAIN WORKSPACE COLUMN */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* Top Workspace Header */}
            <header className="px-6 py-3.5 border-b border-zinc-200/80 flex flex-wrap items-center justify-between gap-3 bg-white/95 backdrop-blur-xs sticky top-0 z-20">
              <div>
                <h1 className="text-base sm:text-lg font-bold text-zinc-900 tracking-tight font-display">
                  {viewMeta[view].title}
                </h1>
                <p className="text-xs text-zinc-500 hidden sm:block">
                  {viewMeta[view].subtitle}
                </p>
              </div>

              {/* Right Quick Actions & Status Pill */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Live Status Pill */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-50 border border-zinc-200/80 text-xs font-mono text-zinc-700 max-w-xs truncate">
                  {isCapturing ? (
                    <Loader2 size={13} className="animate-spin text-blue-600 shrink-0" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  )}
                  <span className="truncate">{statusMessage}</span>
                </div>

                {/* Quick Action: Import Image */}
                <button
                  onClick={() => studioUploadRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200/80 text-zinc-800 transition cursor-pointer flex items-center gap-1.5"
                  title="Import local image to Annotate, Redact, or run Offline OCR"
                >
                  <Upload size={13.5} className="text-blue-600" />
                  <span className="hidden lg:inline">Import Image</span>
                </button>

                {/* Quick Action: Desktop Screen Capture */}
                <button
                  onClick={handleCaptureDesktop}
                  disabled={isCapturing}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  title="Capture any monitor display, application window, or browser tab"
                >
                  <ScreenShare size={13.5} />
                  <span>Capture Screen</span>
                </button>
              </div>
            </header>

            {/* Main View Content Area (Supports Global File Drop) */}
            <main
              className={`flex-1 overflow-hidden relative flex flex-col ${
                isDraggingFiles ? 'ring-2 ring-inset ring-blue-500 bg-blue-50/20' : ''
              }`}
              onDragOver={(e) => {
                if (view === 'verify') return;
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  setIsDraggingFiles(true);
                }
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={(e) => {
                setIsDraggingFiles(false);
                if (view === 'verify') return;
                if (e.dataTransfer.files.length > 0) {
                  e.preventDefault();
                  handleImportFiles(Array.from(e.dataTransfer.files));
                }
              }}
            >
              {/* VIEW 1: COMMAND CENTER ('menu') */}
              {view === 'menu' && (
                <div className="flex-1 p-5 sm:p-6 lg:p-7 overflow-y-auto space-y-6">
                  {/* SECTION 1: 4-CARD INSTANT LAUNCHPAD */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-blue-600" />
                        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-700">
                          Instant Studio Actions
                        </h2>
                      </div>
                      <span className="text-[11px] text-zinc-500 font-mono hidden sm:inline">
                        Tip: Press <kbd className="px-1.5 py-0.5 bg-zinc-100 rounded border border-zinc-200 text-zinc-700">Ctrl+V</kbd> or drag &amp; drop any image anywhere to Annotate or OCR
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
                      {/* Card 1: Capture Screen / Window */}
                      <button
                        onClick={handleCaptureDesktop}
                        disabled={isCapturing}
                        className="group text-left p-4 rounded-2xl bg-gradient-to-br from-blue-50/80 via-white to-white border border-blue-200/80 hover:border-blue-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition">
                            <ScreenShare size={19} />
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            Display Media
                          </span>
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 group-hover:text-blue-600 transition">
                            Capture Screen or Window
                          </h3>
                          <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                            Snap any monitor display, OS app window, or browser tab with automatic Yoink Proof™ signing.
                          </p>
                        </div>
                        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono font-semibold text-blue-600">
                          <span>Launch System Picker</span>
                          <ArrowRight size={13} className="group-hover:translate-x-0.5 transition" />
                        </div>
                      </button>

                      {/* Card 2: Capture All Open Tabs */}
                      <button
                        onClick={handleCaptureAllTabs}
                        disabled={isCapturing}
                        className="group text-left p-4 rounded-2xl bg-gradient-to-br from-indigo-50/70 via-white to-white border border-indigo-200/80 hover:border-indigo-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition">
                            <Layers size={19} />
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                            Multi-Tab Sweep
                          </span>
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 group-hover:text-indigo-600 transition">
                            Capture All Window Tabs
                          </h3>
                          <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                            Automatically cycle through every open tab in your current Chrome window and save to Gallery.
                          </p>
                        </div>
                        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono font-semibold text-indigo-600">
                          <span>Sweep Open Tabs</span>
                          <ArrowRight size={13} className="group-hover:translate-x-0.5 transition" />
                        </div>
                      </button>

                      {/* Card 3: Import & Annotate / OCR */}
                      <button
                        onClick={() => studioUploadRef.current?.click()}
                        className="group text-left p-4 rounded-2xl bg-gradient-to-br from-amber-50/70 via-white to-white border border-amber-200/80 hover:border-amber-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition">
                            <Upload size={19} />
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-200">
                            Drop or Ctrl+V
                          </span>
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 group-hover:text-amber-700 transition">
                            Import to Annotate &amp; OCR
                          </h3>
                          <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                            Drop any local image to draw arrows, blur sensitive PII, slice pages, or extract offline OCR text.
                          </p>
                        </div>
                        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono font-semibold text-amber-700">
                          <span>Browse Local Files</span>
                          <ArrowRight size={13} className="group-hover:translate-x-0.5 transition" />
                        </div>
                      </button>

                      {/* Card 4: Yoink Proof Inspector */}
                      <button
                        onClick={() => {
                          setVerifyTarget(null);
                          setView('verify');
                        }}
                        className="group text-left p-4 rounded-2xl bg-gradient-to-br from-emerald-50/80 via-white to-white border border-emerald-200/80 hover:border-emerald-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition">
                            <ShieldCheck size={19} />
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ECDSA P-256
                          </span>
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 group-hover:text-emerald-700 transition">
                            Verify Screenshot Proof™
                          </h3>
                          <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                            Audit any PNG, JPEG, or WebP for authentic Yoink capture provenance and pixel-level integrity.
                          </p>
                        </div>
                        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono font-semibold text-emerald-700">
                          <span>Open Verification Vault</span>
                          <ArrowRight size={13} className="group-hover:translate-x-0.5 transition" />
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* SECTION 2: RECENT CAPTURES WORKBENCH STRIP */}
                  <div className="bg-zinc-50/80 rounded-2xl border border-zinc-200/80 p-4 sm:p-5 space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <History size={15} className="text-indigo-600" />
                        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-800">
                          Recent Captures Workbench
                        </h2>
                        <span className="text-[11px] font-mono bg-zinc-200/80 text-zinc-700 px-2 py-0.5 rounded-full font-semibold">
                          {history.length} total
                        </span>
                      </div>

                      <button
                        onClick={() => setView('history')}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                      >
                        <span>Open Full Gallery</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>

                    {recentItems.length === 0 ? (
                      <div className="bg-white rounded-xl border border-dashed border-zinc-300 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/60 shrink-0">
                            <ImageIcon size={20} />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-zinc-900">
                              Your Capture Workbench is Empty
                            </h3>
                            <p className="text-xs text-zinc-600 mt-0.5">
                              Press <kbd className="px-1.5 py-0.5 bg-zinc-100 rounded border border-zinc-200 font-mono text-[10.5px]">Alt+Shift+1</kbd> on any webpage, click <b>Capture Screen</b> above, or drop an image file here to start editing.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => studioUploadRef.current?.click()}
                          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition cursor-pointer shrink-0 flex items-center gap-1.5"
                        >
                          <Upload size={13} />
                          <span>Import First Image</span>
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                        {recentItems.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => {
                              setIsAnnotatingDirectly(false);
                              setIsOcrDirectly(false);
                              setPreviewItem(item);
                            }}
                            className="group bg-white rounded-xl border border-zinc-200/90 hover:border-blue-300 hover:shadow-md transition overflow-hidden flex flex-col cursor-pointer"
                          >
                            {/* Thumbnail Preview */}
                            <div className="relative h-32 bg-zinc-100 overflow-hidden border-b border-zinc-100">
                              <img
                                src={item.thumbnailUrl || item.dataUrl}
                                alt={item.title}
                                className="w-full h-full object-cover object-top group-hover:scale-[1.03] transition duration-300"
                              />
                              <div className="absolute top-2 left-2 flex items-center gap-1">
                                <span className="px-1.5 py-0.5 rounded bg-zinc-900/75 backdrop-blur-xs text-white font-mono text-[9.5px] font-bold uppercase">
                                  {item.format}
                                </span>
                                {item.proofSigned && (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-emerald-600/90 backdrop-blur-xs text-white font-mono text-[9.5px] font-bold flex items-center gap-0.5 shadow-2xs"
                                    title={`Signed with Yoink Proof™ (${item.proofKeyId || 'ECDSA P-256'})`}
                                  >
                                    <ShieldCheck size={10} /> SIGNED
                                  </span>
                                )}
                              </div>
                              <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/75 backdrop-blur-xs text-white font-mono text-[9.5px]">
                                {item.width}×{item.height}
                              </div>
                            </div>

                            {/* Metadata & Direct Tool Strip */}
                            <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                              <div>
                                <h4 className="text-xs font-bold text-zinc-900 truncate group-hover:text-blue-600 transition">
                                  {item.title || 'Untitled Capture'}
                                </h4>
                                <p className="text-[10.5px] text-zinc-500 font-mono truncate mt-0.5">
                                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {item.mode}
                                </p>
                              </div>

                              {/* 1-Click Tool Buttons */}
                              <div className="grid grid-cols-4 gap-1 pt-2 border-t border-zinc-100">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsAnnotatingDirectly(true);
                                    setIsOcrDirectly(false);
                                    setPreviewItem(item);
                                  }}
                                  className="py-1 px-1.5 rounded-lg bg-zinc-50 hover:bg-blue-50 text-zinc-700 hover:text-blue-700 font-medium text-[10px] flex items-center justify-center gap-1 transition cursor-pointer"
                                  title="Annotate, Blur PII, or Add Callouts"
                                >
                                  <Pencil size={11} />
                                  <span>Edit</span>
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsAnnotatingDirectly(false);
                                    setIsOcrDirectly(true);
                                    setPreviewItem(item);
                                  }}
                                  className="py-1 px-1.5 rounded-lg bg-zinc-50 hover:bg-amber-50 text-zinc-700 hover:text-amber-800 font-medium text-[10px] flex items-center justify-center gap-1 transition cursor-pointer"
                                  title="Extract Text with Offline OCR"
                                >
                                  <ScanText size={11} />
                                  <span>OCR</span>
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectVerifyItem(item);
                                  }}
                                  className="py-1 px-1.5 rounded-lg bg-zinc-50 hover:bg-emerald-50 text-zinc-700 hover:text-emerald-800 font-medium text-[10px] flex items-center justify-center gap-1 transition cursor-pointer"
                                  title="Inspect Yoink Proof™ Signature"
                                >
                                  <ShieldCheck size={11} />
                                  <span>Proof</span>
                                </button>

                                <button
                                  onClick={(e) => handleQuickCopyItem(item, e)}
                                  className="py-1 px-1.5 rounded-lg bg-zinc-50 hover:bg-indigo-50 text-zinc-700 hover:text-indigo-700 font-medium text-[10px] flex items-center justify-center gap-1 transition cursor-pointer"
                                  title="Copy Image to Clipboard"
                                >
                                  {copiedItemId === item.id ? (
                                    <Check size={11} className="text-emerald-600" />
                                  ) : (
                                    <Copy size={11} />
                                  )}
                                  <span>{copiedItemId === item.id ? 'OK' : 'Copy'}</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* SECTION 3: TWO-COLUMN SPLIT — WEBPAGE HOTKEYS & AUTOMATION PIPELINES */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Left Column (7 cols): Webpage Capture Shortcuts */}
                    <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200/90 p-5 space-y-3.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-800">
                            Active Webpage Capture Hotkeys
                          </h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Use these global shortcuts on any website tab, or trigger from the toolbar popup.
                          </p>
                        </div>
                        <span className="text-[10.5px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/70">
                          Click to copy hotkey
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {/* Row 1: Full Page Stitch */}
                        <div
                          onClick={() => handleCopyShortcut('Alt+Shift+1', 'Full Page Capture')}
                          className="p-3 rounded-xl border border-zinc-200/80 hover:border-blue-300 hover:bg-blue-50/30 transition cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                              <FileText size={18} />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-zinc-900">Full Page Scroll &amp; Stitch</h4>
                              <p className="text-[11px] text-zinc-600 truncate">
                                Auto-scrolls lazy content, hides sticky headers, and stitches seamless tall pages.
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyShortcut('Alt+Shift+1', 'Full Page Capture');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-blue-100 text-zinc-800 font-mono text-[11px] font-semibold flex items-center gap-1.5 shrink-0 border border-zinc-200"
                          >
                            {copiedShortcut === 'Alt+Shift+1' ? (
                              <>
                                <Check size={12} className="text-emerald-600" />
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

                        {/* Row 2: Visible Viewport */}
                        <div
                          onClick={() => handleCopyShortcut('Alt+Shift+3', 'Visible Viewport')}
                          className="p-3 rounded-xl border border-zinc-200/80 hover:border-blue-300 hover:bg-blue-50/30 transition cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                              <Monitor size={18} />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-zinc-900">Visible Viewport Snapshot</h4>
                              <p className="text-[11px] text-zinc-600 truncate">
                                Instant hardware-DPR capture of the currently visible browser viewport.
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyShortcut('Alt+Shift+3', 'Visible Viewport');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-blue-100 text-zinc-800 font-mono text-[11px] font-semibold flex items-center gap-1.5 shrink-0 border border-zinc-200"
                          >
                            {copiedShortcut === 'Alt+Shift+3' ? (
                              <>
                                <Check size={12} className="text-emerald-600" />
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

                        {/* Row 3: Selection Region */}
                        <div
                          onClick={() => handleCopyShortcut('Alt+Shift+4', 'Selection Region')}
                          className="p-3 rounded-xl border border-zinc-200/80 hover:border-blue-300 hover:bg-blue-50/30 transition cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                              <Crop size={18} />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-zinc-900">Precision Area Selection</h4>
                              <p className="text-[11px] text-zinc-600 truncate">
                                Interactive crosshair crop overlay with live pixel dimensions on any webpage.
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyShortcut('Alt+Shift+4', 'Selection Region');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-blue-100 text-zinc-800 font-mono text-[11px] font-semibold flex items-center gap-1.5 shrink-0 border border-zinc-200"
                          >
                            {copiedShortcut === 'Alt+Shift+4' ? (
                              <>
                                <Check size={12} className="text-emerald-600" />
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

                        {/* Row 4: Scrollable DOM Container */}
                        <div className="p-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0">
                              <ScrollText size={18} />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-zinc-900">Scrollable Element Inspector</h4>
                              <p className="text-[11px] text-zinc-600 truncate">
                                Hover &amp; click nested overflow containers (chat panels, code blocks, tables) via the toolbar popup.
                              </p>
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg bg-cyan-50 text-cyan-800 border border-cyan-200 font-mono text-[10.5px] font-semibold shrink-0">
                            Via Popup
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Column (5 cols): Automation & Post-Processing Capabilities */}
                    <div className="lg:col-span-5 flex flex-col justify-between gap-4">
                      <div className="bg-white rounded-2xl border border-zinc-200/90 p-5 space-y-3.5 shadow-2xs flex-1">
                        <div>
                          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-800">
                            Automated Pipelines
                          </h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Multi-URL and multi-viewport capture engines built into Studio.
                          </p>
                        </div>

                        <div className="space-y-2.5">
                          <button
                            onClick={() => setView('urllist')}
                            className="w-full p-3.5 rounded-xl border border-zinc-200/90 hover:border-emerald-400 hover:bg-emerald-50/30 transition cursor-pointer flex items-center justify-between text-left group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition shrink-0">
                                <Globe size={18} />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-zinc-900 group-hover:text-emerald-900">
                                  Batch URL Queue
                                </h4>
                                <p className="text-[11px] text-zinc-600">
                                  Paste a list of URLs to open, stitch, and archive hands-free.
                                </p>
                              </div>
                            </div>
                            <ChevronRight size={16} className="text-zinc-400 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition shrink-0" />
                          </button>

                          <button
                            onClick={() => setView('multisize')}
                            className="w-full p-3.5 rounded-xl border border-zinc-200/90 hover:border-sky-400 hover:bg-sky-50/30 transition cursor-pointer flex items-center justify-between text-left group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center group-hover:bg-sky-600 group-hover:text-white transition shrink-0">
                                <Smartphone size={18} />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-zinc-900 group-hover:text-sky-900">
                                  Responsive Device Matrix
                                </h4>
                                <p className="text-[11px] text-zinc-600">
                                  Test Mobile (375px), Tablet (768px), Laptop, and Desktop in one run.
                                </p>
                              </div>
                            </div>
                            <ChevronRight size={16} className="text-zinc-400 group-hover:text-sky-700 group-hover:translate-x-0.5 transition shrink-0" />
                          </button>
                        </div>

                        {/* Built-in Studio Power Features Summary */}
                        <div className="pt-2 border-t border-zinc-100">
                          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">
                            Included Post-Capture Tools
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 font-mono text-[10.5px]">
                              ✏️ Arrows &amp; Redaction Blur
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 font-mono text-[10.5px]">
                              🔍 Offline OCR Text
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 font-mono text-[10.5px]">
                              ✂️ Anti-Squish Page Slicing
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 font-mono text-[10.5px]">
                              📄 Multi-Page PDF Export
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Active Engine Status Footer Card */}
                      <div className="p-4 bg-zinc-900 text-white rounded-2xl flex items-center justify-between gap-3 shadow-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                            <span>FORMAT: <b className="text-white uppercase">{settings.format}</b></span>
                            <span>•</span>
                            <span>DPI: <b className="text-white">{settings.scaleFactor || 1}x</b></span>
                            <span>•</span>
                            <span>SLICE: <b className="text-white">{settings.autoSliceLongPages ? 'AUTO' : 'OFF'}</b></span>
                          </div>
                          <p className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                            <ShieldCheck size={12} />
                            {(settings.enableProof ?? true)
                              ? `Yoink Proof™ Active (${settings.proofAuthor ? `Owner: ${settings.proofAuthor}` : 'IPTC + ECDSA + LSB'})`
                              : 'Yoink Proof™ Signing Disabled'}
                          </p>
                        </div>
                        <button
                          onClick={() => setView('options')}
                          className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition cursor-pointer shrink-0"
                        >
                          Configure
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* VIEW 2: CAPTURE GALLERY ('history') */}
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

              {/* VIEW 3: BATCH URL QUEUE ('urllist') */}
              {view === 'urllist' && (
                <UrlBatchModal
                  settings={settings}
                  onBack={() => setView('menu')}
                  onFinished={handleBatchResults}
                  onPreview={(item) => setPreviewItem(item)}
                />
              )}

              {/* VIEW 4: RESPONSIVE BREAKPOINTS ('multisize') */}
              {view === 'multisize' && (
                <MultiSizeModal
                  settings={settings}
                  onBack={() => setView('menu')}
                  onFinished={handleBatchResults}
                  onPreview={(item) => setPreviewItem(item)}
                />
              )}

              {/* VIEW 5: INLINE YOINK PROOF VAULT ('verify') */}
              {view === 'verify' && (
                <VerifyModal
                  inline={true}
                  initialDataUrl={verifyTarget?.dataUrl}
                  initialTitle={verifyTarget?.title}
                />
              )}

              {/* VIEW 6: ENGINE SETTINGS ('options') */}
              {view === 'options' && (
                <OptionsDrawer
                  settings={settings}
                  onBack={() => setView('menu')}
                  onSave={handleSaveSettings}
                  onOpenVerify={() => {
                    setVerifyTarget(null);
                    setView('verify');
                  }}
                />
              )}
            </main>
          </div>
        </div>

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
            onCaptureAllTabs={handleCaptureAllTabs}
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
