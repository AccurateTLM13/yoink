import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  Play,
  Globe,
  ListPlus,
  CheckCircle,
  Loader2,
  Trash2,
} from 'lucide-react';
import { BatchIssue, CaptureSettings, HistoryItem } from '../types';
import { captureUrlList, getOpenTabUrls, ensureAllSitesAccess } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onFinished: (results: HistoryItem[]) => void;
  onPreview: (item: HistoryItem) => void;
  isFullTab?: boolean;
}

const DEFAULT_SAMPLE_URLS = `https://news.ycombinator.com
https://github.com
https://developer.chrome.com`;

function safeHostname(url?: string): string {
  if (!url) return 'capture';
  try {
    return new URL(url).hostname || 'capture';
  } catch {
    return 'capture';
  }
}

export const UrlBatchModal: React.FC<Props> = React.memo(({
  settings,
  onBack,
  onFinished,
  onPreview,
  isFullTab = false,
}) => {
  const [urlsText, setUrlsText] = useState(DEFAULT_SAMPLE_URLS);
  const [delaySec, setDelaySec] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStep, setProgressStep] = useState({ current: 0, total: 0 });
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);
  const [issues, setIssues] = useState<BatchIssue[]>([]);

  const inputUrls = useMemo(() => urlsText.split('\n').map((u) => u.trim()).filter(Boolean), [urlsText]);
  const validUrls = useMemo(() => inputUrls.filter((u) => {
    try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
  }), [inputUrls]);
  const invalidCount = inputUrls.length - validUrls.length;
  const invalidQueue = invalidCount > 0 || validUrls.length > 100;


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

  const handleStart = async (retryUrls?: string[]) => {
    const targets = retryUrls || validUrls;
    if (targets.length === 0 || (!retryUrls && invalidQueue)) return;
    let failed: BatchIssue[] = [];

    try {
      if (!(await ensureAllSitesAccess())) {
        setProgressMsg('Yoink needs access to all sites for batch URL capture.');
        return;
      }
      setIsRunning(true);
      setProgressStep({ current: 0, total: targets.length });
      setIssues([]);
      setProgressMsg('Starting batch URL capture sequence...');
      setCompletedItems([]);
    } catch {
      return;
    }

    try {
      const results = await captureUrlList(
        targets,
        settings,
        delaySec * 1000,
        (current, total, activeUrl) => {
          setProgressStep({ current, total });
          setProgressMsg(`Capturing ${current} of ${total}: ${activeUrl}`);
        },
        (outcome) => { failed = [...outcome.failures, ...outcome.skipped]; setIssues(failed); }
      );
      setCompletedItems(results);
      onFinished(results);
      setProgressMsg(`Batch complete: ${results.length} captured, ${failed.length} failed or skipped.`);
    } catch (err: any) {
      setProgressMsg(`Error: ${err.message || 'Batch capture failed'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden">
      {/* Popup-only Header */}
      {!isFullTab && (
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
      )}

      <div
        className={`flex-1 overflow-y-auto text-xs ${
          isFullTab ? 'p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start' : 'p-4 space-y-4'
        }`}
      >
        {/* Left Column: URL Queue & Latency Config */}
        <div className={isFullTab ? 'lg:col-span-7 space-y-4 bg-white p-5 rounded-xl border border-zinc-200/80 shadow-2xs' : 'space-y-4'}>
          {isFullTab && (
            <div className="flex items-center justify-between pb-1 border-b border-zinc-100">
              <div>
                <h3 className="font-semibold text-sm text-zinc-900">Automated Batch URL Queue</h3>
                <p className="text-[11.5px] text-zinc-600 mt-0.5">
                  Paste one URL per line or import your open browser tabs to capture them sequentially.
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/70">
                {validUrls.length} Valid
              </span>
            </div>
          )}

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
                  className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/70 px-2.5 py-1 rounded-md transition cursor-pointer disabled:opacity-50 border border-blue-200/60"
                >
                  <ListPlus size={12} />
                  <span>Load Open Web Tabs</span>
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
              rows={isFullTab ? 8 : 5}
              placeholder="https://example.com/page1&#10;https://example.com/page2"
              className="w-full p-3 font-mono text-xs bg-zinc-50/50 focus:bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-zinc-50 leading-relaxed shadow-2xs resize-none"
            />
          </div>

          {/* Wait Delay Slider */}
          <div className="bg-zinc-50/80 p-3.5 rounded-xl border border-zinc-200/80 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-zinc-700">Page Render & Hydration Latency</span>
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
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
            />
            <p className="text-[10.5px] text-zinc-600 leading-snug">
              Allows JavaScript hydration, webfonts, and deferred images to finish before each snapshot.
            </p>
          </div>

          {isFullTab && (
            <button
              onClick={() => handleStart()}
              disabled={isRunning || validUrls.length === 0 || invalidQueue}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition cursor-pointer shadow-xs active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Processing Batch URLs...</span>
                </>
              ) : (
                <>
                  <Play size={13} fill="currentColor" />
                  <span>Capture {validUrls.length} URL{validUrls.length === 1 ? '' : 's'}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Right Column: Progress & Results */}
        <div className={isFullTab ? 'lg:col-span-5 space-y-4' : 'space-y-4'}>
          {progressMsg && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs shadow-2xs ${
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

          {invalidQueue && <div role="alert" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950">{invalidCount > 0 ? `${invalidCount} URL(s) are invalid. Enter one complete http(s) URL per line. ` : ''}{validUrls.length > 100 ? 'The limit is 100 URLs per batch.' : ''}</div>}
          {issues.length > 0 && (
            <div role="alert" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 space-y-2">
              <p className="font-semibold">Could not capture {issues.length} URL(s)</p>
              <ul className="max-h-40 overflow-y-auto space-y-1">{issues.map((issue, i) => <li key={i} className="break-all">{issue.target}: {issue.reason}</li>)}</ul>
              <button type="button" disabled={isRunning} onClick={() => handleStart(issues.map((issue) => issue.target))} className="underline font-semibold disabled:opacity-50">Retry failed</button>
            </div>
          )}
          {completedItems.length > 0 ? (
            <div className="bg-white p-4 rounded-xl border border-zinc-200/80 shadow-2xs space-y-3">
              <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
                Captured URLs ({completedItems.length}) — Click to Inspect
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {completedItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onPreview(item)}
                    className="group relative bg-zinc-50 border border-zinc-200/80 hover:border-blue-400 rounded-xl p-2 cursor-pointer shadow-2xs hover:shadow-xs transition"
                  >
                    <img
                      src={item.thumbnailUrl || item.dataUrl}
                      alt={item.title}
                      className="w-full h-24 object-cover object-top rounded-lg bg-white border border-zinc-200/60"
                    />
                    <p className="text-[11px] text-zinc-800 truncate mt-1.5 font-semibold font-mono">
                      {safeHostname(item.url)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            isFullTab && (
              <div className="bg-white p-6 rounded-xl border border-dashed border-zinc-300 text-center space-y-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <Globe size={20} />
                </div>
                <h4 className="font-semibold text-xs text-zinc-800">Ready for Batch Capture</h4>
                <p className="text-[11px] text-zinc-500 max-w-xs mx-auto leading-relaxed">
                  Queue up to 100 URLs on the left. Yoink will open each page, wait for hydration, capture the viewport, and save every snapshot to your Gallery.
                </p>
              </div>
            )
          )}
        </div>
      </div>

      {/* Popup-only Footer Start Button */}
      {!isFullTab && (
        <div className="p-3.5 border-t border-zinc-200/80 bg-white">
          <button
            onClick={() => handleStart()}
            disabled={isRunning || validUrls.length === 0 || invalidQueue}
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
      )}
    </div>
  );
});
