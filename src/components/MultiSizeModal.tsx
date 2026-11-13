import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  Play,
  Smartphone,
  Tablet,
  Monitor,
  Tv,
  Loader2,
  CheckCircle2,
  Plus,
  CheckSquare,
  Square,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { BatchIssue, CaptureSettings, HistoryItem, ResolutionConfig } from '../types';
import {
  captureMultiSize,
  ensureAllSitesAccess,
  getInjectableOpenTabs,
  isCapturableWebUrl,
  OpenTabInfo,
} from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onFinished: (results: HistoryItem[]) => void;
  onPreview: (item: HistoryItem) => void;
  isFullTab?: boolean;
}

const DEFAULT_PRESETS: ResolutionConfig[] = [
  { name: 'Mobile (iPhone 14)', width: 390, height: 844 },
  { name: 'Tablet (iPad Air)', width: 820, height: 1180 },
  { name: 'Desktop (Full HD)', width: 1440, height: 900 },
  { name: '4K Display', width: 1920, height: 1080 },
];

export const MultiSizeModal: React.FC<Props> = React.memo(({
  settings,
  onBack,
  onFinished,
  onPreview,
  isFullTab = false,
}) => {
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [openTabs, setOpenTabs] = useState<OpenTabInfo[]>([]);
  const [resolutions, setResolutions] = useState<ResolutionConfig[]>(DEFAULT_PRESETS);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0, 1, 2]);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);
  const [issues, setIssues] = useState<BatchIssue[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customWidth, setCustomWidth] = useState(375);
  const [customHeight, setCustomHeight] = useState(667);

  const loadTabs = async () => {
    const tabs = await getInjectableOpenTabs();
    setOpenTabs(tabs);
    setTargetUrl((prev) => {
      if (prev && isCapturableWebUrl(prev)) return prev;
      return tabs[0]?.url || 'https://developer.chrome.com';
    });
  };

  useEffect(() => {
    loadTabs();
  }, []);

  const toggleSelect = (idx: number) => {
    if (isRunning) return;
    if (selectedIndices.includes(idx)) {
      if (selectedIndices.length > 1) {
        setSelectedIndices(selectedIndices.filter((i) => i !== idx));
      }
    } else {
      setSelectedIndices([...selectedIndices, idx]);
    }
  };

  const handleSelectAll = () => {
    if (isRunning) return;
    if (selectedIndices.length === resolutions.length) {
      setSelectedIndices([0]);
    } else {
      setSelectedIndices(resolutions.map((_, i) => i));
    }
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || customWidth <= 0 || customHeight <= 0) return;

    const newRes: ResolutionConfig = {
      name: customName.trim(),
      width: customWidth,
      height: customHeight,
    };

    const newResolutions = [...resolutions, newRes];
    setResolutions(newResolutions);
    setSelectedIndices([...selectedIndices, newResolutions.length - 1]);
    setCustomName('');
    setShowCustomForm(false);
  };

  const isValidUrl = isCapturableWebUrl(targetUrl.trim());

  const handleStart = async (retryNames?: string[]) => {
    const targets = selectedIndices.map((i) => resolutions[i]).filter((r) => !retryNames || retryNames.includes(r.name || `${r.width}x${r.height}`));
    let failed: BatchIssue[] = [];
    if (targets.length === 0) return;
    if (!isValidUrl) {
      setProgressMsg('Error: Please enter or select a valid http(s) URL.');
      return;
    }

    try {
      if (!(await ensureAllSitesAccess())) {
        setProgressMsg('Yoink needs access to all sites for responsive multi-size capture.');
        return;
      }
      setIsRunning(true);
      setProgressMsg('Starting responsive multi-device capture...');
      setIssues([]);
      setCompletedItems([]);
    } catch {
      return;
    }

    try {
      const results = await captureMultiSize(
        targets,
        settings,
        (curr, total, name) => {
          setProgressMsg(`Capturing ${curr} of ${total}: ${name}`);
        },
        targetUrl.trim(),
        (outcome) => { failed = outcome.failures; setIssues(failed); }
      );
      setCompletedItems(results);
      onFinished(results);
      setProgressMsg(`Finished: ${results.length} captured, ${failed.length} failed.`);
    } catch (err: any) {
      setProgressMsg(`Error: ${err.message || 'Capture failed'}`);
    } finally {
      setIsRunning(false);
    }
  };

  const getDeviceIcon = (width: number) => {
    if (width <= 480) return <Smartphone size={16} className="text-blue-600" />;
    if (width <= 900) return <Tablet size={16} className="text-indigo-600" />;
    if (width <= 1600) return <Monitor size={16} className="text-sky-600" />;
    return <Tv size={16} className="text-purple-600" />;
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden">
      {/* Popup-only Sub-Header */}
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

          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/60">
            Multi-Device
          </span>
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto text-xs ${
          isFullTab ? 'p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start' : 'p-4 space-y-4'
        }`}
      >
        {/* Left Column: URL Target & Breakpoint Configuration */}
        <div className={isFullTab ? 'lg:col-span-7 space-y-5' : 'space-y-4'}>
          <div className="bg-white p-4 rounded-xl border border-zinc-200/80 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-zinc-900">Responsive Viewport Lab</h3>
                <p className="text-[11.5px] text-zinc-600 leading-relaxed mt-0.5">
                  Opens your target URL in a managed viewport window and snapshots each selected device resolution in sequence.
                </p>
              </div>
              <span className="hidden sm:inline-flex text-[10px] font-mono font-bold uppercase tracking-wider text-sky-700 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-200/70">
                {selectedIndices.length} Viewports
              </span>
            </div>

            {/* Target URL Input */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                  Target Website URL
                </label>
                <button
                  type="button"
                  onClick={loadTabs}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                  title="Refresh open browser tabs"
                >
                  <RefreshCw size={11} />
                  <span>Refresh Open Tabs</span>
                </button>
              </div>
              <div className="relative flex items-center">
                <Globe size={14} className="text-zinc-400 absolute left-3 pointer-events-none" />
                <input
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  disabled={isRunning}
                  placeholder="https://example.com"
                  className="w-full pl-8 pr-3 py-2 font-mono text-xs bg-zinc-50/70 focus:bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Quick-Pick from Open Browser Tabs */}
              {openTabs.length > 0 && (
                <div className="pt-1 space-y-1">
                  <span className="text-[10px] font-mono text-zinc-500 block">
                    Or pick an open browser tab:
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap max-h-20 overflow-y-auto">
                    {openTabs.slice(0, 6).map((t) => {
                      const active = targetUrl.trim() === t.url;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTargetUrl(t.url)}
                          disabled={isRunning}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium truncate max-w-[200px] border transition cursor-pointer flex items-center gap-1.5 ${
                            active
                              ? 'bg-blue-50 border-blue-300 text-blue-800 font-semibold'
                              : 'bg-white border-zinc-200/80 text-zinc-700 hover:border-zinc-300'
                          }`}
                          title={t.url}
                        >
                          {t.favIconUrl ? (
                            <img src={t.favIconUrl} alt="" className="w-3.5 h-3.5 rounded-xs shrink-0" />
                          ) : (
                            <Globe size={11} className="text-zinc-400 shrink-0" />
                          )}
                          <span className="truncate">{t.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Viewport Selectors */}
          <div className="space-y-2.5 bg-white p-4 rounded-xl border border-zinc-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                Select Target Devices ({selectedIndices.length})
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAll}
                  disabled={isRunning}
                  className="text-[10.5px] font-semibold text-blue-600 hover:text-blue-700 transition cursor-pointer disabled:opacity-50"
                >
                  {selectedIndices.length === resolutions.length ? 'Clear All' : 'Select All'}
                </button>
                <button
                  onClick={() => setShowCustomForm(!showCustomForm)}
                  disabled={isRunning}
                  className="flex items-center gap-0.5 text-[10.5px] font-semibold text-zinc-700 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 px-2 py-0.5 rounded-md transition cursor-pointer"
                >
                  <Plus size={11} />
                  <span>Custom Size</span>
                </button>
              </div>
            </div>

            {/* Custom Breakpoint Inline Form */}
            {showCustomForm && (
              <form onSubmit={handleAddCustom} className="p-3 bg-blue-50/40 rounded-xl border border-blue-200/80 space-y-2.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-700 block">
                  Add Custom Breakpoint
                </span>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Device Name (e.g. Pixel 8)"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-md focus:outline-none focus:border-blue-500"
                    required
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-zinc-600">W:</span>
                      <input
                        type="number"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(parseInt(e.target.value, 10))}
                        className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-md font-mono"
                        min={280}
                        max={3840}
                        required
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-zinc-600">H:</span>
                      <input
                        type="number"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(parseInt(e.target.value, 10))}
                        className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-md font-mono"
                        min={400}
                        max={2400}
                        required
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCustomForm(false)}
                    className="px-2 py-1 text-[11px] text-zinc-600 hover:text-zinc-900 rounded cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer"
                  >
                    Add Viewport
                  </button>
                </div>
              </form>
            )}

            {/* Resolutions List */}
            <div className={isFullTab ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'space-y-1.5'}>
              {resolutions.map((res, idx) => {
                const isChecked = selectedIndices.includes(idx);
                return (
                  <div
                    key={`${res.name}_${idx}`}
                    onClick={() => toggleSelect(idx)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all duration-150 cursor-pointer ${
                      isChecked
                        ? 'bg-blue-50/70 border-blue-300 text-blue-950 shadow-2xs'
                        : 'bg-white border-zinc-200/80 text-zinc-700 hover:border-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-white border border-zinc-200/60 flex items-center justify-center shrink-0 shadow-2xs">
                        {getDeviceIcon(res.width)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-xs leading-tight truncate">{res.name}</h4>
                        <p className="text-[10px] font-mono text-zinc-600 tabular-nums">
                          {res.width} × {res.height} px
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 ml-2">
                      {isChecked ? (
                        <CheckSquare size={16} className="text-blue-600" />
                      ) : (
                        <Square size={16} className="text-zinc-300" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {isFullTab && (
              <div className="pt-2">
                <button
                  onClick={() => handleStart()}
                  disabled={isRunning || selectedIndices.length === 0 || !isValidUrl}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition cursor-pointer shadow-xs active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunning ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Resizing & Capturing Viewports...</span>
                    </>
                  ) : (
                    <>
                      <Play size={13} fill="currentColor" />
                      <span>Capture Selected Viewports ({selectedIndices.length})</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Progress & Results */}
        <div className={isFullTab ? 'lg:col-span-5 space-y-4' : 'space-y-4'}>
          {progressMsg && (
            <div
              className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs shadow-2xs ${
                progressMsg.startsWith('Error:')
                  ? 'bg-rose-50/90 border-rose-200 text-rose-900'
                  : isRunning
                  ? 'bg-blue-50/90 border-blue-200 text-blue-900'
                  : 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
              }`}
            >
              {isRunning ? (
                <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              )}
              <span className="font-medium text-xs leading-snug">{progressMsg}</span>
            </div>
          )}

          {issues.length > 0 && <div role="alert" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 space-y-2"><p className="font-semibold">Viewports not captured</p><ul>{issues.map((issue, i) => <li key={i}>{issue.target}: {issue.reason}</li>)}</ul><button type="button" disabled={isRunning} className="underline font-semibold" onClick={() => handleStart(issues.map((issue) => issue.target))}>Retry failed</button></div>}
          {completedItems.length > 0 ? (
            <div className="bg-white p-4 rounded-xl border border-zinc-200/80 shadow-2xs space-y-3">
              <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
                Captured Viewports ({completedItems.length}) — Click to Inspect
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
                    <p className="text-[11px] text-zinc-900 truncate mt-1.5 font-semibold">
                      {item.title}
                    </p>
                    <p className="text-[10px] text-zinc-500 font-mono tabular-nums">
                      {item.viewport ? `Viewport ${item.viewport.width} × ${item.viewport.height} CSS px · Image ${item.width} × ${item.height} px` : `Image ${item.width} × ${item.height} px`}
                      {item.viewport && (item.viewport.width !== item.viewport.requestedWidth || item.viewport.height !== item.viewport.requestedHeight) && <span className="block text-amber-700">Requested {item.viewport.requestedWidth} × {item.viewport.requestedHeight}; window limits prevented an exact match.</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            isFullTab && (
              <div className="bg-white p-6 rounded-xl border border-dashed border-zinc-300 text-center space-y-2">
                <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
                  <Smartphone size={20} />
                </div>
                <h4 className="font-semibold text-xs text-zinc-800">No Viewports Captured Yet</h4>
                <p className="text-[11px] text-zinc-500 max-w-xs mx-auto leading-relaxed">
                  Choose a target URL on the left, select your device breakpoints, and click Capture to generate side-by-side responsive snapshots.
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
            disabled={isRunning || selectedIndices.length === 0 || !isValidUrl}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition cursor-pointer shadow-xs active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Resizing Viewports...</span>
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                <span>Capture Selected ({selectedIndices.length})</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
});
