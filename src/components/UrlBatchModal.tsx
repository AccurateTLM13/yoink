import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  Play,
  Globe,
  ListPlus,
  CheckCircle,
  Loader2,
  Trash2,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { CaptureSettings, HistoryItem } from '../types';
import { captureUrlList, getOpenTabUrls } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onFinished: (results: HistoryItem[]) => void;
  onPreview: (item: HistoryItem) => void;
}

const DEFAULT_SAMPLE_URLS = `https://news.ycombinator.com
https://github.com
https://developer.chrome.com`;

export const UrlBatchModal: React.FC<Props> = React.memo(({
  settings,
  onBack,
  onFinished,
  onPreview,
}) => {
  const [urlsText, setUrlsText] = useState(DEFAULT_SAMPLE_URLS);
  const [delaySec, setDelaySec] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStep, setProgressStep] = useState({ current: 0, total: 0 });
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);

  const validUrls = useMemo(() => {
    return urlsText
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')));
  }, [urlsText]);

  const handleLoadOpenTabs = async () => {
    const tabs = await getOpenTabUrls();
    if (tabs.length > 0) {
      const urls = tabs.map((t) => t.url).filter(Boolean);
      setUrlsText(urls.join('\n'));
    }
  };

  const handleClear = () => {
    if (isRunning) return;
    setUrlsText('');
  };

  const handleStart = async () => {
    if (validUrls.length === 0) return;

    setIsRunning(true);
    setProgressStep({ current: 0, total: validUrls.length });
    setProgressMsg('Starting batch URL capture sequence...');
    setCompletedItems([]);

    try {
      const results = await captureUrlList(
        validUrls,
        settings,
        delaySec * 1000,
        (current, total, activeUrl) => {
          setProgressStep({ current, total });
          setProgressMsg(`Capturing ${current} of ${total}: ${activeUrl}`);
        }
      );
      setCompletedItems(results);
      onFinished(results);
      setProgressMsg(`Batch complete! Captured ${results.length} URLs.`);
    } catch (err: any) {
      setProgressMsg(`Error: ${err.message || 'Batch capture failed'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xs">
        <button
          onClick={onBack}
          disabled={isRunning}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition cursor-pointer px-1 py-1 rounded hover:bg-zinc-100 disabled:opacity-50"
        >
          <ChevronLeft size={16} />
          <span>Back to Menu</span>
        </button>

        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
          Batch URLs
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Instructions & Actions Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              Target URLs ({validUrls.length} valid)
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleLoadOpenTabs}
                disabled={isRunning}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/70 px-2 py-0.5 rounded-md transition cursor-pointer disabled:opacity-50 border border-blue-200/60"
              >
                <ListPlus size={12} />
                <span>Load Open Tabs</span>
              </button>
              {urlsText.length > 0 && (
                <button
                  onClick={handleClear}
                  disabled={isRunning}
                  className="p-1 text-zinc-400 hover:text-zinc-700 rounded transition cursor-pointer disabled:opacity-50"
                  title="Clear URLs"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          {/* URLs Textarea */}
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            disabled={isRunning}
            rows={5}
            placeholder="https://example.com/page1&#10;https://example.com/page2"
            className="w-full p-2.5 font-mono text-xs bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-zinc-50 leading-relaxed shadow-2xs resize-none"
          />
        </div>

        {/* Wait Delay Slider */}
        <div className="bg-white p-3 rounded-xl border border-zinc-200/80 space-y-2 shadow-2xs">
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium text-zinc-700">Page Render Latency</span>
            <span className="font-mono font-bold text-blue-600 tabular-nums">{delaySec}s delay</span>
          </div>
          <input
            type="range"
            min="1"
            max="8"
            step="1"
            value={delaySec}
            onChange={(e) => setDelaySec(parseInt(e.target.value, 10))}
            disabled={isRunning}
            className="w-full h-1.5 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
          />
          <p className="text-[10px] text-zinc-600 leading-snug">
            Allows JavaScript hydration, webfonts, and deferred images to finish before capture.
          </p>
        </div>

        {/* Status / Progress Display */}
        {progressMsg && (
          <div
            className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs shadow-2xs ${
              isRunning
                ? 'bg-blue-50/90 border-blue-200 text-blue-900'
                : 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
            }`}
          >
            {isRunning ? (
              <Loader2 size={15} className="animate-spin text-blue-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle size={15} className="text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-xs leading-tight truncate">{progressMsg}</p>
              {isRunning && progressStep.total > 0 && (
                <div className="w-full bg-blue-200/80 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${(progressStep.current / progressStep.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed Previews */}
        {completedItems.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-zinc-200/80">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
              Captured URLs ({completedItems.length})
            </label>
            <div className="grid grid-cols-2 gap-2">
              {completedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onPreview(item)}
                  className="group relative bg-white border border-zinc-200/80 hover:border-blue-400 rounded-lg p-1.5 cursor-pointer shadow-2xs hover:shadow-xs transition"
                >
                  <img
                    src={item.dataUrl}
                    alt={item.title}
                    className="w-full h-16 object-cover rounded bg-zinc-100"
                  />
                  <p className="text-[10px] text-zinc-700 truncate mt-1 font-medium font-mono">
                    {item.url ? new URL(item.url).hostname : 'capture'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Start Button */}
      <div className="p-3.5 border-t border-zinc-200/80 bg-white">
        <button
          onClick={handleStart}
          disabled={isRunning || validUrls.length === 0}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition cursor-pointer shadow-xs active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Processing Batch URLs...</span>
            </>
          ) : (
            <>
              <Play size={13} fill="currentColor" />
              <span>Capture {validUrls.length} URLs</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});
