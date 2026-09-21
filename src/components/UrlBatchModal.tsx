import React, { useState } from 'react';
import { ChevronLeft, Play, Link2, ListPlus, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { CaptureSettings, HistoryItem } from '../types';
import { captureUrlList, getOpenTabUrls } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onFinished: (results: HistoryItem[]) => void;
  onPreview: (item: HistoryItem) => void;
}

export const UrlBatchModal: React.FC<Props> = React.memo(({ settings, onBack, onFinished, onPreview }) => {
  const [urlsText, setUrlsText] = useState('');
  const [delaySec, setDelaySec] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStep, setProgressStep] = useState({ current: 0, total: 0 });
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);

  const handleLoadOpenTabs = async () => {
    const tabs = await getOpenTabUrls();
    if (tabs.length > 0) {
      const urls = tabs.map((t) => t.url).filter(Boolean);
      setUrlsText(urls.join('\n'));
    }
  };

  const handleStart = async () => {
    const urls = urlsText
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length === 0) return;

    setIsRunning(true);
    setProgressStep({ current: 0, total: urls.length });
    setProgressMsg('Starting batch capture...');
    setCompletedItems([]);

    try {
      const results = await captureUrlList(
        urls,
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
      setProgressMsg(`Error: ${err.message || 'Batch failed'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fdfdfd] text-[#1a1a1a]">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 border-b border-zinc-200 bg-white">
        <button
          onClick={onBack}
          disabled={isRunning}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition cursor-pointer disabled:opacity-50"
        >
          <ChevronLeft size={16} />
          <span>Back to Menu</span>
        </button>

        <span className="text-xs font-bold font-mono uppercase tracking-wider text-blue-600">
          Batch URL Capture
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Instructions & Load Tabs helper */}
        <div className="flex items-center justify-between">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Enter Target URLs (One per line)
          </label>
          <button
            onClick={handleLoadOpenTabs}
            disabled={isRunning}
            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded transition cursor-pointer disabled:opacity-50"
          >
            <ListPlus size={13} />
            <span>Load Current Tabs</span>
          </button>
        </div>

        {/* URLs Textarea */}
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          disabled={isRunning}
          rows={6}
          placeholder="https://example.com/page1&#10;https://example.com/page2"
          className="w-full p-2.5 font-mono text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50 leading-relaxed"
        />

        {/* Wait Delay Slider */}
        <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium text-zinc-700">Page Render Delay</span>
            <span className="font-mono font-bold text-blue-600">{delaySec} seconds</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={delaySec}
            onChange={(e) => setDelaySec(parseInt(e.target.value, 10))}
            disabled={isRunning}
            className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
          />
          <p className="text-[10px] text-zinc-500">
            Gives each page time to fully execute JavaScript & load dynamic media before capture.
          </p>
        </div>

        {/* Status / Progress Display */}
        {progressMsg && (
          <div
            className={`p-3 rounded-lg border flex items-start gap-2 text-xs ${
              isRunning
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {isRunning ? (
              <Loader2 size={16} className="animate-spin text-blue-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="font-semibold leading-tight">{progressMsg}</p>
              {isRunning && progressStep.total > 0 && (
                <div className="w-full bg-blue-200 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full transition-all duration-300"
                    style={{ width: `${(progressStep.current / progressStep.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed Previews */}
        {completedItems.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-zinc-200">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
              Captured Screenshots ({completedItems.length})
            </label>
            <div className="grid grid-cols-2 gap-2">
              {completedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onPreview(item)}
                  className="group relative bg-white border border-zinc-200 hover:border-blue-500 rounded p-1.5 cursor-pointer shadow-sm"
                >
                  <img src={item.dataUrl} alt={item.title} className="w-full h-16 object-cover rounded bg-zinc-100" />
                  <p className="text-[10px] text-zinc-700 truncate mt-1 font-medium">{item.url}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Start Button */}
      <div className="p-3.5 border-t border-zinc-200 bg-white">
        <button
          onClick={handleStart}
          disabled={isRunning || urlsText.trim().length === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-xs transition cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Processing Batch...</span>
            </>
          ) : (
            <>
              <Play size={15} fill="currentColor" />
              <span>Start Batch Capture</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});
