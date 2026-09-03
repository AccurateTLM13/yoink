import React, { useState, useEffect, useCallback } from 'react';
import { CaptureSettings, HistoryItem } from './types';
import {
  DEFAULT_SETTINGS,
  getStoredSettings,
  saveStoredSettings,
  getStoredHistory,
  deleteStoredHistoryItem,
  clearStoredHistory,
  addHistoryItem,
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

  const isFullTab = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).has('view') ||
    window.innerWidth > 450
  );

  // Sync body classes based on popup vs full tab
  useEffect(() => {
    if (isFullTab) {
      document.body.className = 'bg-zinc-50 w-full min-h-screen m-0 p-0 select-none antialiased overflow-y-auto';
    } else {
      document.body.className = 'bg-white w-[370px] h-[550px] m-0 p-0 overflow-hidden select-none antialiased';
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
        // Seamless UX: Automatically navigate to History so user sees all captured tabs
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

  if (isFullTab) {
    return (
      <div className="min-h-screen w-full bg-zinc-50 flex flex-col items-center py-6 px-4">
        <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl border border-zinc-200 overflow-hidden min-h-[700px] flex flex-col">
          {/* Full Tab Header */}
          <div className="px-6 py-4 border-b border-zinc-150 flex items-center justify-between bg-white">
            <div className="flex items-center gap-2.5">
              <img src="/yoink-symbol.png" alt="Yoink" className="h-8 w-8 object-contain" />
              <img src="/yoink-text.png" alt="Yoink" className="h-7 w-auto object-contain" />
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Yoink Gallery Hub</span>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative flex flex-col">
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
              <div className="flex-1 flex items-center justify-center p-8 bg-zinc-50/50">
                <div className="w-[370px] bg-white rounded-2xl border border-zinc-200 shadow-md overflow-hidden">
                  <QuickMenu
                    onCaptureFullPage={handleCaptureFullPage}
                    onCaptureVisible={handleCaptureVisible}
                    onCaptureSelection={handleCaptureSelection}
                    onCaptureAllTabs={handleCaptureAllTabs}
                    onOpenUrlBatch={() => setView('urllist')}
                    onOpenMultiSize={() => setView('multisize')}
                    onOpenHistory={() => setView('history')}
                    onOpenOptions={() => setView('options')}
                    historyCount={history.length}
                    isCapturing={isCapturing}
                    activeAction={statusMessage}
                  />
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
          </div>

          {/* Image Preview / Quick Action Modal */}
          {previewItem && (
            <ImagePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[370px] h-[550px] flex flex-col bg-white text-zinc-900 overflow-hidden font-sans border border-zinc-200/80 rounded-2xl shadow-xl">
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

      {/* Image Preview / Quick Action Modal */}
      {previewItem && (
        <ImagePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
}
