import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BatchFailure, BatchIssue, BatchReport, CaptureSettings, FolderAccessState, HistoryItem } from './types';
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
} from './utils/storage';
import { checkSavedDirectoryStatus, FOLDER_STATUS_KEY } from './utils/saveDestination';
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
  isChromeExtension,
  OpenTabInfo,
} from './utils/capture';
import { getOrCreateProofIdentity } from './utils/proof';
import { estimateBase64Bytes } from './utils/studioFormat';
import {
  applyThemeToDocument,
  persistTheme,
  resolveInitialTheme,
  ThemeMode,
  toggleTheme,
} from './utils/theme';
import { QuickMenu } from './components/QuickMenu';
import { UrlBatchModal } from './components/UrlBatchModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { OptionsDrawer } from './components/OptionsDrawer';
import { MultiSizeModal } from './components/MultiSizeModal';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { VerifyModal } from './components/VerifyModal';
import { MediaYoinkerModal } from './components/MediaYoinkerModal';
import { StudioShell, StudioView } from './components/studio/StudioShell';
import { StudioHubView } from './components/studio/StudioHubView';
import { StudioGalleryView } from './components/studio/StudioGalleryView';
import { CaptureInspector } from './components/studio/CaptureInspector';

const indexItem = (item: HistoryItem): HistoryItem => ({
  ...item,
  fileSizeBytes: item.fileSizeBytes ?? estimateBase64Bytes(item.dataUrl),
  dataUrl: '',
});

const getInitialView = (): StudioView => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    if (v && ['menu', 'urllist', 'history', 'options', 'multisize', 'verify', 'media'].includes(v)) {
      return v as StudioView;
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
  const [view, setView] = useState<StudioView>(getInitialView);
  const [recentBatchReport, setRecentBatchReport] = useState<BatchReport | null>(() => {
    const initialCount = getInitialBatchCount();
    return initialCount != null ? { count: initialCount, captured: [], skipped: [], failures: [] } : null;
  });
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<HistoryItem | null>(null);
  const [isAnnotatingDirectly, setIsAnnotatingDirectly] = useState(false);
  const [isOcrDirectly, setIsOcrDirectly] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<{ dataUrl: string; title: string } | null>(null);
  const [proofKeyId, setProofKeyId] = useState<string>('Generating…');
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [lastCaptureError, setLastCaptureError] = useState<string | null>(null);
  const [copiedShortcut, setCopiedShortcut] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const [openTabs, setOpenTabs] = useState<OpenTabInfo[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | undefined>(undefined);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const [folderStatusState, setFolderStatusState] = useState<FolderAccessState>('unset');

  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsCompactViewport(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const studioUploadRef = useRef<HTMLInputElement>(null);

  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forcePopup = searchParams?.get('popup') === 'true';
  const forceTab = searchParams?.get('tab') === 'true';
  const highlightFolderPicker =
    searchParams?.get('pickFolder') === '1' || searchParams?.get('reauthFolder') === '1';

  const [initialExtensionPopup] = useState(
    () => typeof window !== 'undefined' && isChromeExtension() && !forceTab && window.innerWidth <= 420
  );

  // Full Tab Studio Hub vs Chrome Extension Popup window
  const isFullTab = !forcePopup && (forceTab || !initialExtensionPopup);

  // Sync light/dark DESIGN.md tokens on document root
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = toggleTheme(prev);
      persistTheme(next);
      return next;
    });
  }, []);

  // Sync body styling based on popup vs full tab mode
  useEffect(() => {
    if (isFullTab) {
      document.body.className =
        'bg-[var(--canvas)] text-[var(--ink)] w-full min-h-screen m-0 p-0 select-none antialiased overflow-y-auto font-sans';
    } else {
      document.body.className =
        'bg-[var(--canvas)] text-[var(--ink)] w-[380px] max-w-full h-[585px] m-0 p-0 overflow-hidden select-none antialiased font-sans';
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

  // Load initial settings, history, and Proof Identity, plus check for pending_view from background captures
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        ['pending_view', 'last_batch_count', 'yoink_last_batch_report', 'yoink_last_capture_error'],
        (res) => {
          const captureError = res.yoink_last_capture_error as { error?: string } | undefined;
          if (captureError?.error) setLastCaptureError(captureError.error);
          const report = res.yoink_last_batch_report as Partial<BatchReport> | undefined;
          if (report) {
            setRecentBatchReport({
              count: report.count ?? 0,
              captured: report.captured || [],
              skipped: report.skipped || [],
              failures: report.failures || [],
            });
          }
          if (res.pending_view) {
            setView(res.pending_view as StudioView);
            if (res.last_batch_count) {
              setRecentBatchReport({
                count: res.last_batch_count,
                captured: [],
                skipped: [],
                failures: [],
              });
            }
            chrome.storage.local.remove(['pending_view', 'last_batch_count']);
          }
        }
      );
    }

    async function loadInitialData() {
      const s = await getStoredSettings();
      setSettings(s);
      const fsStatus = await checkSavedDirectoryStatus();
      setFolderStatusState(fsStatus.state);
      const h = await getStoredHistory();
      setHistory(h);

      const editId = new URLSearchParams(window.location.search).get('edit');
      if (editId) {
        const target = h.find((item) => item.id === editId);
        if (target) {
          setView('history');
          setSelectedItemId(target.id);
          setIsAnnotatingDirectly(true);
          setPreviewItem(target);
        } else {
          setStatusMessage('This capture is no longer available in the gallery.');
        }
      }

      try {
        const identity = await getOrCreateProofIdentity();
        setProofKeyId(`#${identity.keyFingerprint}`);
      } catch {
        setProofKeyId('Local ECDSA P-256');
      }
    }
    void loadInitialData();

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
          if (changes.yoink_last_batch_report) {
            const report = changes.yoink_last_batch_report.newValue as Partial<BatchReport> | undefined;
            setRecentBatchReport(
              report
                ? {
                    count: report.count ?? 0,
                    captured: report.captured || [],
                    skipped: report.skipped || [],
                    failures: report.failures || [],
                  }
                : null
            );
          }
          if (changes.yoink_last_capture_error) {
            setLastCaptureError(changes.yoink_last_capture_error.newValue?.error || null);
          }
          if (changes.pending_view && changes.pending_view.newValue) {
            setView(changes.pending_view.newValue as StudioView);
            chrome.storage.local.remove(['pending_view']);
          }
          if (changes.last_batch_count && changes.last_batch_count.newValue) {
            setRecentBatchReport({
              count: changes.last_batch_count.newValue,
              captured: [],
              skipped: [],
              failures: [],
            });
            chrome.storage.local.remove(['last_batch_count']);
          }
          if (changes[FOLDER_STATUS_KEY]?.newValue?.state) {
            setFolderStatusState(changes[FOLDER_STATUS_KEY].newValue.state);
          }
        }
      };
      chrome.storage.onChanged.addListener(listener);
      storageCleanup = () => chrome.storage.onChanged.removeListener(listener);
    }

    let runtimeCleanup: (() => void) | undefined;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      const msgListener = (msg: any) => {
        if (msg.action === 'CAPTURE_FINISHED' && msg.payload?.item) {
          const item = msg.payload.item as HistoryItem;
          if (item.dataUrl) {
            saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
          }
          if (item.historySaved !== false) {
            setHistory((prev) => [indexItem(item), ...prev.filter((i) => i.id !== item.id)]);
          }
          setSelectedItemId(item.id);
          setPreviewItem(item);
          setIsCapturing(false);
          setStatusMessage(item.warning || 'Capture complete');
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

  const targetTabForCapture = isFullTab ? selectedTabId : undefined;

  const handleCaptureFullPage = useCallback(async () => {
    setIsCapturing(true);
    setStatusMessage(settings.captureDelaySec ? `Capturing in ${settings.captureDelaySec}s…` : 'Scanning page…');
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
      setStatusMessage(item.warning || 'Full page capture complete');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        if (item.historySaved !== false) {
          setHistory((prev) => [indexItem(item), ...prev.filter((i) => i.id !== item.id)]);
        }
        setSelectedItemId(item.id);
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
    setStatusMessage(
      settings.captureDelaySec ? `Capturing in ${settings.captureDelaySec}s…` : 'Capturing visible viewport…'
    );
    try {
      if (!isFullTab && settings.captureDelaySec > 0 && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureVisible(settings, targetTabForCapture);
      setStatusMessage(item.warning || 'Visible viewport captured');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        if (item.historySaved !== false) {
          setHistory((prev) => [indexItem(item), ...prev.filter((i) => i.id !== item.id)]);
        }
        setSelectedItemId(item.id);
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
    setStatusMessage('Select region on target page…');
    try {
      if (!isFullTab && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureSelection(settings, targetTabForCapture);
      setStatusMessage(item.warning || 'Selection captured');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        if (item.historySaved !== false) {
          setHistory((prev) => [indexItem(item), ...prev.filter((i) => i.id !== item.id)]);
        }
        setSelectedItemId(item.id);
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
    setStatusMessage('Select scrollable element on target page…');
    try {
      if (!isFullTab && typeof window !== 'undefined') {
        setTimeout(() => window.close(), 300);
      }
      const item = await captureScrollingElement(settings, targetTabForCapture);
      setStatusMessage(item.warning || 'Scrollable element captured');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        if (item.historySaved !== false) {
          setHistory((prev) => [indexItem(item), ...prev.filter((i) => i.id !== item.id)]);
        }
        setSelectedItemId(item.id);
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
    setStatusMessage('Select screen or window to capture…');
    try {
      const item = await captureDesktop(settings);
      setStatusMessage(item.warning || 'Screen captured');
      if (item && item.dataUrl) {
        saveFullResolutionImage(item.id, item.dataUrl).catch(() => {});
        if (item.historySaved !== false) {
          setHistory((prev) => [indexItem(item), ...prev.filter((i) => i.id !== item.id)]);
        }
        setSelectedItemId(item.id);
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
      setStatusMessage(
        settings.captureAllWindows ? 'Capturing tabs across all windows…' : 'Capturing all tabs in window…'
      );
      let outcomeFailures: BatchFailure[] = [];
      let outcomeSkipped: BatchIssue[] = [];
      let outcomeCaptured: BatchIssue[] = [];
      const results = await captureAllTabs(
        settings,
        (curr, total, title) => {
          setStatusMessage(`Capturing tab ${curr}/${total}: ${title}`);
        },
        (outcome) => {
          outcomeFailures = outcome.failures.map((f) => ({ target: f.target, error: f.reason }));
          outcomeSkipped = outcome.skipped || [];
          outcomeCaptured = outcome.captured || [];
        }
      );
      const updated = await getStoredHistory();
      setHistory(updated);
      setStatusMessage(
        outcomeFailures.length || outcomeSkipped.length
          ? `Captured ${results.length}${outcomeSkipped.length ? `, skipped ${outcomeSkipped.length}` : ''}${outcomeFailures.length ? `, failed ${outcomeFailures.length}` : ''}.`
          : `Captured ${results.length} tabs`
      );
      if (results.length > 0 || outcomeFailures.length > 0 || outcomeSkipped.length > 0) {
        setRecentBatchReport({
          count: results.length,
          captured: outcomeCaptured.length
            ? outcomeCaptured
            : results.map((item) => ({ target: item.title || item.url || 'Tab', reason: item.url || 'Captured' })),
          skipped: outcomeSkipped,
          failures: outcomeFailures,
        });
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
    setStatusMessage('Settings saved');
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
    try {
      const updated = await deleteStoredHistoryItem(id);
      setHistory(updated);
      setSelectedItemId((prev) => (prev === id ? null : prev));
    } catch (error) {
      setStatusMessage(`Could not delete capture: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }, []);

  const handleClearHistory = useCallback(async () => {
    try {
      await clearStoredHistory();
      setHistory([]);
      setSelectedItemId(null);
      setMobileInspectorOpen(false);
      setStatusMessage('Gallery cleared');
    } catch (error) {
      setStatusMessage(`Could not clear history: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }, []);

  const dismissBatchReport = useCallback(() => {
    setRecentBatchReport(null);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove('yoink_last_batch_report').catch(() => {});
    }
  }, []);

  const dismissCaptureError = useCallback(() => {
    setLastCaptureError(null);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove('yoink_last_capture_error').catch(() => {});
    }
  }, []);

  const handleBatchResults = useCallback((items: HistoryItem[]) => {
    const saved = items.filter((item) => item.historySaved !== false);
    const ids = new Set(saved.map((item) => item.id));
    setHistory((prev) => [...saved.map(indexItem), ...prev.filter((item) => !ids.has(item.id))]);
  }, []);

  const handleSelectVerifyItem = useCallback(
    async (item: HistoryItem) => {
      const fullUrl = await getFullResolutionImage(item.id);
      const dataUrl = fullUrl || (item.dataUrl && item.dataUrl.length > 0 ? item.dataUrl : null) || item.thumbnailUrl;
      if (!dataUrl) {
        setStatusMessage('The original image is unavailable.');
        return;
      }
      setVerifyTarget({ dataUrl, title: item.title });
      setMobileInspectorOpen(false);
      if (isFullTab) {
        setView('verify');
      } else {
        setShowVerifyModal(true);
      }
    },
    [isFullTab]
  );

  const handleOpenAnnotation = useCallback(
    (item: HistoryItem) => {
      if (!isFullTab && typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.tabs?.create) {
        const url = chrome.runtime.getURL(`index.html?tab=true&edit=${encodeURIComponent(item.id)}`);
        chrome.tabs.create({ url }).catch((error) => {
          setStatusMessage(`Could not open editor: ${error?.message || 'Unknown error'}`);
        });
        return;
      }
      setMobileInspectorOpen(false);
      setIsAnnotatingDirectly(true);
      setIsOcrDirectly(false);
      setPreviewItem(item);
    },
    [isFullTab]
  );

  const handleImportFiles = useCallback(
    async (files: File[]) => {
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
      setHistory((prev) => [...imported.map(indexItem), ...prev.filter((p) => !imported.some((i) => i.id === p.id))]);
      setSelectedItemId(imported[0].id);
      setStatusMessage(`Imported ${imported.length} image${imported.length === 1 ? '' : 's'}`);
      if (imported.length === 1) {
        handleOpenAnnotation(imported[0]);
      } else {
        setView('history');
      }
    },
    [handleOpenAnnotation]
  );

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
    setStatusMessage(`Copied ${shortcut} for ${label.toLowerCase()}.`);
    setTimeout(() => setCopiedShortcut(null), 2500);
  }, []);

  const handleSelectStudioItem = useCallback((item: HistoryItem) => {
    setSelectedItemId(item.id);
    setInspectorOpen(true);
    setMobileInspectorOpen(true);
  }, []);

  const selectedItem = selectedItemId ? history.find((item) => item.id === selectedItemId) ?? null : null;

  // Full Tab Studio Hub & Gallery Shell
  if (isFullTab) {
    const viewMeta: Record<StudioView, { title: string; summary: string }> = {
      menu: {
        title: 'Studio Hub',
        summary: 'Capture, inspect, annotate, and verify local screenshots without cloud uploads.',
      },
      history: {
        title: 'Gallery',
        summary: `${history.length} saved capture${history.length === 1 ? '' : 's'} indexed locally.`,
      },
      urllist: {
        title: 'Batch URL queue',
        summary: 'Run sequential tab captures and index results into Gallery.',
      },
      multisize: {
        title: 'Responsive matrix',
        summary: 'Capture mobile, tablet, laptop, and desktop viewports together.',
      },
      verify: {
        title: 'Proof Vault',
        summary: 'Verify ECDSA P-256 signatures, IPTC screenCapture claims, and pixel integrity.',
      },
      options: {
        title: 'Engine settings',
        summary: 'Configure format, Retina scaling, slicing, save destination, and signing.',
      },
      media: {
        title: 'Page media yoinker',
        summary: 'Extract srcset images, inline SVGs, CSS backgrounds, and video frames.',
      },
    };

    const showInspectorSurface = view === 'menu' || view === 'history';
    const inspectorActive = isCompactViewport ? mobileInspectorOpen : inspectorOpen;
    const galleryUsesInspectorAccentCta = view === 'history' && inspectorActive && Boolean(selectedItem);

    const inspectorRail =
      showInspectorSurface && !isCompactViewport ? (
        <CaptureInspector
          variant="rail"
          item={selectedItem}
          history={history}
          settings={settings}
          folderStatusState={folderStatusState}
          proofKeyId={proofKeyId}
          useAccentPrimaryCta={galleryUsesInspectorAccentCta}
          showReticleInPreview={false}
          onClose={() => setInspectorOpen(false)}
          onSelectPreview={(item) => {
            setIsAnnotatingDirectly(false);
            setIsOcrDirectly(false);
            setPreviewItem(item);
          }}
          onSelectAnnotate={handleOpenAnnotation}
          onSelectOcr={(item) => {
            setIsAnnotatingDirectly(false);
            setIsOcrDirectly(true);
            setPreviewItem(item);
          }}
          onSelectVerify={handleSelectVerifyItem}
          onDeleteItem={handleDeleteHistoryItem}
        />
      ) : null;

    const inspectorSheet =
      showInspectorSurface && isCompactViewport && mobileInspectorOpen && selectedItem ? (
        <CaptureInspector
          variant="sheet"
          item={selectedItem}
          history={history}
          settings={settings}
          folderStatusState={folderStatusState}
          proofKeyId={proofKeyId}
          useAccentPrimaryCta={view === 'history'}
          showReticleInPreview={true}
          onClose={() => setMobileInspectorOpen(false)}
          onSelectPreview={(item) => {
            setMobileInspectorOpen(false);
            setIsAnnotatingDirectly(false);
            setIsOcrDirectly(false);
            setPreviewItem(item);
          }}
          onSelectAnnotate={handleOpenAnnotation}
          onSelectOcr={(item) => {
            setMobileInspectorOpen(false);
            setIsAnnotatingDirectly(false);
            setIsOcrDirectly(true);
            setPreviewItem(item);
          }}
          onSelectVerify={handleSelectVerifyItem}
          onDeleteItem={handleDeleteHistoryItem}
        />
      ) : null;

    return (
      <>
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

        <StudioShell
          view={view}
          viewTitle={viewMeta[view].title}
          viewSummary={viewMeta[view].summary}
          historyCount={history.length}
          settings={settings}
          folderStatusState={folderStatusState}
          proofKeyId={proofKeyId}
          statusMessage={statusMessage}
          isCapturing={isCapturing}
          isDraggingFiles={isDraggingFiles}
          theme={theme}
          sidebarOpen={sidebarOpen}
          inspectorOpen={showInspectorSurface && inspectorOpen}
          showInspectorToggle={showInspectorSurface}
          onToggleTheme={handleToggleTheme}
          onToggleSidebar={setSidebarOpen}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onSelectView={(next) => {
            if (next === 'verify') setVerifyTarget(null);
            setMobileInspectorOpen(false);
            setView(next);
          }}
          onCaptureAllTabs={() => handleCaptureAllTabs()}
          onImportFiles={handleImportFiles}
          onSaveSettings={handleSaveSettings}
          onToggleOptimalHD={handleToggleOptimalHD}
          onToggleProof={handleToggleProof}
          onToggleReceiptStamp={handleToggleReceiptStamp}
          onDragStateChange={setIsDraggingFiles}
          inspectorRail={inspectorRail}
          inspectorSheet={inspectorSheet}
        >
          {view === 'menu' && (
            <StudioHubView
              history={history}
              settings={settings}
              folderStatusState={folderStatusState}
              openTabs={openTabs}
              selectedTabId={selectedTabId}
              isLoadingTabs={isLoadingTabs}
              isCapturing={isCapturing}
              lastCaptureError={lastCaptureError}
              copiedShortcut={copiedShortcut}
              selectedItemId={selectedItem?.id ?? null}
              onSelectTabId={setSelectedTabId}
              onRefreshTabs={() => void refreshOpenTabs()}
              onDismissCaptureError={dismissCaptureError}
              onCaptureFullPage={() => void handleCaptureFullPage()}
              onCaptureVisible={() => void handleCaptureVisible()}
              onCaptureSelection={() => void handleCaptureSelection()}
              onCaptureElement={() => void handleCaptureElement()}
              onCaptureDesktop={() => void handleCaptureDesktop()}
              onCaptureAllTabs={() => void handleCaptureAllTabs()}
              onCopyShortcut={handleCopyShortcut}
              onNavigateView={(next) => {
                if (next === 'verify') setVerifyTarget(null);
                setMobileInspectorOpen(false);
                setView(next);
              }}
              onSelectItem={handleSelectStudioItem}
              onSelectPreview={(item) => {
                setSelectedItemId(item.id);
                setIsAnnotatingDirectly(false);
                setIsOcrDirectly(false);
                setPreviewItem(item);
              }}
              onImportClick={() => studioUploadRef.current?.click()}
            />
          )}

          {view === 'history' && (
            <StudioGalleryView
              history={history}
              settings={settings}
              selectedItemId={selectedItem?.id ?? null}
              hasInspectorPrimaryCta={galleryUsesInspectorAccentCta}
              recentBatchReport={recentBatchReport}
              onDismissBatchBanner={dismissBatchReport}
              onSelectItem={handleSelectStudioItem}
              onSelectPreview={(item) => {
                setSelectedItemId(item.id);
                setIsAnnotatingDirectly(false);
                setIsOcrDirectly(false);
                setPreviewItem(item);
              }}
              onSelectAnnotate={handleOpenAnnotation}
              onClearAll={handleClearHistory}
              onImportFiles={handleImportFiles}
            />
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
              highlightFolderPicker={highlightFolderPicker}
            />
          )}

          {view === 'media' && (
            <MediaYoinkerModal
              settings={settings}
              isFullTab={true}
              highlightFolderPicker={highlightFolderPicker}
              onBack={() => setView('menu')}
              onUpdateSettings={handleSaveSettings}
              onSendToStudio={(newItem) => {
                if (newItem.dataUrl) {
                  saveFullResolutionImage(newItem.id, newItem.dataUrl).catch(() => {});
                }
                setHistory((prev) => [indexItem(newItem), ...prev.filter((i) => i.id !== newItem.id)]);
                setSelectedItemId(newItem.id);
                setIsAnnotatingDirectly(false);
                setIsOcrDirectly(false);
                setPreviewItem(newItem);
              }}
            />
          )}
        </StudioShell>

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
              setHistory((prev) => [indexItem(newItem), ...prev.filter((i) => i.id !== newItem.id)]);
              setSelectedItemId(newItem.id);
              setPreviewItem(newItem);
            }}
          />
        )}
      </>
    );
  }

  // Standard Popup View (380px × 585px, safe under Chrome 600px limit)
  return (
    <div className="w-[380px] max-w-full h-[585px] max-h-[600px] mx-auto flex flex-col bg-[var(--canvas)] text-[var(--ink)] overflow-hidden font-sans border border-[var(--border)]">
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {view === 'menu' && (
          <QuickMenu
            lastCaptureError={lastCaptureError}
            onDismissCaptureError={dismissCaptureError}
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
            onOpenMediaYoinker={() => setView('media')}
            onUploadFiles={handleImportFiles}
            delaySec={settings.captureDelaySec}
            onSetDelaySec={(sec) => handleSaveSettings({ ...settings, captureDelaySec: sec })}
            optimalQualityMode={settings.optimalQualityMode}
            enableProof={settings.enableProof ?? true}
            proofKeyId={proofKeyId}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            saveLocationMode={settings.saveLocationMode}
            customSaveFolderName={settings.customSaveFolderName}
            folderStatusState={folderStatusState}
            onOpenFolderPicker={() => {
              if (isChromeExtension() && chrome.tabs?.create && chrome.runtime?.getURL) {
                const param =
                  settings.saveLocationMode === 'folder' && folderStatusState === 'needs_permission'
                    ? 'reauthFolder=1'
                    : 'pickFolder=1';
                chrome.tabs.create({
                  url: chrome.runtime.getURL(`index.html?tab=true&view=options&${param}`),
                });
              } else {
                setView('options');
              }
            }}
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
              setRecentBatchReport(null);
              setView('menu');
            }}
            recentBatchReport={recentBatchReport}
            onDismissBatchBanner={dismissBatchReport}
            onSelectPreview={(item) => {
              setIsAnnotatingDirectly(false);
              setIsOcrDirectly(false);
              setPreviewItem(item);
            }}
            onSelectAnnotate={handleOpenAnnotation}
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

        {view === 'media' && (
          <MediaYoinkerModal
            settings={settings}
            isFullTab={false}
            onBack={() => setView('menu')}
            onUpdateSettings={handleSaveSettings}
            onSendToStudio={(newItem) => {
              if (newItem.dataUrl) {
                saveFullResolutionImage(newItem.id, newItem.dataUrl).catch(() => {});
              }
              setHistory((prev) => [indexItem(newItem), ...prev.filter((i) => i.id !== newItem.id)]);
              setIsAnnotatingDirectly(false);
              setIsOcrDirectly(false);
              setPreviewItem(newItem);
            }}
          />
        )}
      </div>

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
          onOpenAnnotate={
            typeof chrome !== 'undefined' && !!chrome.runtime?.id && previewItem.historySaved !== false
              ? handleOpenAnnotation
              : undefined
          }
          onClose={() => {
            setPreviewItem(null);
            setIsAnnotatingDirectly(false);
            setIsOcrDirectly(false);
          }}
          onSaved={(newItem) => {
            setHistory((prev) => [indexItem(newItem), ...prev.filter((i) => i.id !== newItem.id)]);
            setPreviewItem(newItem);
          }}
        />
      )}
    </div>
  );
}
