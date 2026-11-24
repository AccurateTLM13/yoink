import React, { useState, useEffect } from 'react';
import {
  Camera,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  Globe,
  Loader2,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Square,
  Tablet,
  Tv,
  XCircle,
} from 'lucide-react';
import type { BatchIssue, CaptureSettings, HistoryItem, ResolutionConfig } from '../types';
import {
  captureMultiSize,
  ensureAllSitesAccess,
  getInjectableOpenTabs,
  isCapturableWebUrl,
  type OpenTabInfo,
} from '../utils/capture';
import { formatViewportFrameHeader } from '../utils/studioFormat';

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

const ZOOM_LEVELS = [50, 75, 100] as const;

export const MultiSizeModal: React.FC<Props> = React.memo(function MultiSizeModal({
  settings,
  onBack,
  onFinished,
  onPreview,
  isFullTab = false,
}: Props) {
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [openTabs, setOpenTabs] = useState<OpenTabInfo[]>([]);
  const [resolutions, setResolutions] = useState<ResolutionConfig[]>(DEFAULT_PRESETS);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0, 1, 2]);
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [hasIssues, setHasIssues] = useState(false);
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
    void loadTabs();
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

    const next = [...resolutions, newRes];
    setResolutions(next);
    setSelectedIndices([...selectedIndices, next.length - 1]);
    setCustomName('');
    setShowCustomForm(false);
  };

  const isValidUrl = isCapturableWebUrl(targetUrl.trim());

  const handleStart = async (explicitTargets?: ResolutionConfig[], retryNames?: string[]) => {
    const targets =
      explicitTargets ||
      selectedIndices
        .map((i) => resolutions[i])
        .filter((r) => !retryNames || retryNames.includes(r.name || `${r.width}x${r.height}`));
    let failed: BatchIssue[] = [];
    if (targets.length === 0) return;
    if (!isValidUrl) {
      setHasIssues(true);
      setProgressMsg('Error: Enter or select a valid http or https URL.');
      return;
    }

    try {
      if (!(await ensureAllSitesAccess())) {
        setHasIssues(true);
        setProgressMsg('Yoink needs access to all sites for responsive capture.');
        return;
      }
      setIsRunning(true);
      setHasIssues(false);
      setProgressMsg('Starting responsive viewport capture…');
      setIssues([]);
      if (!explicitTargets) setCompletedItems([]);
    } catch (error) {
      setHasIssues(true);
      setProgressMsg(
        `Could not request site access: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
        (outcome) => {
          failed = outcome.failures;
          setIssues(failed);
          setHasIssues(failed.length > 0);
        }
      );
      setCompletedItems((prev) =>
        explicitTargets
          ? [...results, ...prev.filter((p) => !results.some((r) => r.title === p.title))]
          : results
      );
      onFinished(results);
      setProgressMsg(`Finished: ${results.length} captured, ${failed.length} failed.`);
    } catch (err: unknown) {
      setHasIssues(true);
      setProgressMsg(`Error: ${err instanceof Error ? err.message : 'Capture failed'}`);
    } finally {
      setIsRunning(false);
    }
  };

  const getDeviceIcon = (width: number) => {
    if (width <= 480) return <Smartphone size={16} strokeWidth={1.5} />;
    if (width <= 900) return <Tablet size={16} strokeWidth={1.5} />;
    if (width <= 1600) return <Monitor size={16} strokeWidth={1.5} />;
    return <Tv size={16} strokeWidth={1.5} />;
  };

  const findCompletedForResolution = (res: ResolutionConfig): HistoryItem | undefined =>
    completedItems.find(
      (item) =>
        item.viewport?.requestedWidth === res.width && item.viewport?.requestedHeight === res.height
    ) || completedItems.find((item) => item.title.includes(res.name));

  return (
    <div className="flex flex-col h-full bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden">
      {/* Popup-only 44px Header */}
      {!isFullTab && (
        <header className="h-[44px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            disabled={isRunning}
            className="h-8 px-2 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
            <span>Back</span>
          </button>
          <span className="type-mono text-[var(--ink-muted)]">{selectedIndices.length} viewports</span>
        </header>
      )}

      {/* Docked Target URL & Controls Bar */}
      <div className="bg-[var(--surface)] border-b border-[var(--border)] px-4 md:px-6 py-3 space-y-3 shrink-0">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-0 flex items-center">
              <Globe
                size={16}
                strokeWidth={1.5}
                className="text-[var(--ink-muted)] absolute left-3 pointer-events-none"
              />
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                disabled={isRunning}
                aria-label="Target website URL"
                placeholder="https://example.com"
                className="w-full h-9 pl-8 pr-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-mono text-[var(--ink)] placeholder:text-[var(--ink-muted)] select-text studio-focus"
              />
            </div>

            <button
              type="button"
              onClick={loadTabs}
              disabled={isRunning}
              aria-label="Refresh open tabs"
              title="Refresh open tabs"
              className="w-9 h-9 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50 studio-focus"
            >
              <RefreshCw size={16} strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Global frame preview zoom */}
            <div
              role="group"
              aria-label="Frame zoom"
              className="flex items-center gap-0.5 p-0.5 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)]"
            >
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoomPercent(z)}
                  aria-pressed={zoomPercent === z}
                  className={`h-8 px-2 rounded-[6px] type-mono cursor-pointer transition-colors studio-focus ${
                    zoomPercent === z
                      ? 'bg-[var(--ink)] text-[var(--surface)]'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {z}%
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSelectAll}
              disabled={isRunning}
              className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium cursor-pointer disabled:opacity-50 studio-focus"
            >
              {selectedIndices.length === resolutions.length ? 'Reset' : 'Select all'}
            </button>

            <button
              type="button"
              onClick={() => setShowCustomForm((s) => !s)}
              disabled={isRunning}
              className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
            >
              <Plus size={16} strokeWidth={1.5} />
              <span>Custom</span>
            </button>

            {isFullTab && (
              <button
                type="button"
                onClick={() => handleStart()}
                disabled={isRunning || selectedIndices.length === 0 || !isValidUrl}
                className="h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                    <span>Capturing…</span>
                  </>
                ) : (
                  <>
                    <Play size={16} strokeWidth={1.5} />
                    <span>Capture selected ({selectedIndices.length})</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Open browser tab chips */}
        {openTabs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {openTabs.slice(0, 6).map((tab) => {
              const active = targetUrl.trim() === tab.url;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTargetUrl(tab.url)}
                  disabled={isRunning}
                  title={tab.url}
                  className={`h-8 px-2 rounded-[6px] border type-caption truncate max-w-[200px] cursor-pointer transition-colors studio-focus ${
                    active
                      ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                      : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {tab.title}
                </button>
              );
            })}
          </div>
        )}

        {/* Custom breakpoint inline form */}
        {showCustomForm && (
          <form
            onSubmit={handleAddCustom}
            className="p-4 rounded-[12px] bg-[var(--canvas)] border border-[var(--border)] grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
          >
            <label className="sm:col-span-5 space-y-1">
              <span className="type-caption text-[var(--ink-muted)] block">Device name</span>
              <input
                type="text"
                placeholder="Pixel 8"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] type-ui text-[var(--ink)] select-text studio-focus"
              />
            </label>

            <label className="sm:col-span-2 space-y-1">
              <span className="type-caption text-[var(--ink-muted)] block">Width</span>
              <input
                type="number"
                value={customWidth}
                onChange={(e) => setCustomWidth(parseInt(e.target.value, 10))}
                min={280}
                max={3840}
                required
                className="w-full h-9 px-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] type-mono text-[var(--ink)] select-text studio-focus"
              />
            </label>

            <label className="sm:col-span-2 space-y-1">
              <span className="type-caption text-[var(--ink-muted)] block">Height</span>
              <input
                type="number"
                value={customHeight}
                onChange={(e) => setCustomHeight(parseInt(e.target.value, 10))}
                min={400}
                max={2400}
                required
                className="w-full h-9 px-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] type-mono text-[var(--ink)] select-text studio-focus"
              />
            </label>

            <div className="sm:col-span-3 flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 h-9 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-ui-medium cursor-pointer studio-focus"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowCustomForm(false)}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Scrollable Device Frames Matrix */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        {progressMsg && (
          <div
            role="status"
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isRunning ? (
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)] shrink-0" />
              ) : hasIssues || progressMsg.startsWith('Error:') ? (
                <XCircle size={16} strokeWidth={1.5} className="text-[var(--semantic-error)] shrink-0" />
              ) : (
                <CheckCircle2 size={16} strokeWidth={1.5} className="text-[var(--semantic-valid)] shrink-0" />
              )}
              <span className="type-ui text-[var(--ink)] break-words">{progressMsg}</span>
            </div>

            {issues.length > 0 && !isRunning && (
              <button
                type="button"
                onClick={() =>
                  handleStart(
                    undefined,
                    issues.map((issue) => issue.target)
                  )
                }
                className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-2 cursor-pointer studio-focus"
              >
                <RotateCcw size={16} strokeWidth={1.5} />
                <span>Retry failed</span>
              </button>
            )}
          </div>
        )}

        {issues.length > 0 && (
          <div
            role="alert"
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-2"
          >
            <div className="type-body-medium text-[var(--ink)]">Viewports not captured</div>
            <ul className="space-y-1">
              {issues.map((issue, idx) => (
                <li key={idx} className="type-mono text-[var(--semantic-error)] break-words">
                  {issue.target}: {issue.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Labeled Device Frames — Stacks vertically < 768px (Sizzy + Responsively) */}
        <div className={isFullTab ? 'grid grid-cols-1 md:grid-cols-2 gap-5' : 'space-y-4'}>
          {resolutions.map((res, idx) => {
            const isChecked = selectedIndices.includes(idx);
            const captured = findCompletedForResolution(res);
            const aspect = Math.max(0.65, Math.min(1.85, res.width / res.height));
            const scaledWidthPercent = zoomPercent;

            return (
              <article
                key={`${res.name}_${idx}`}
                className={`bg-[var(--surface)] rounded-[12px] border overflow-hidden flex flex-col ${
                  isChecked ? 'border-[var(--ink)]' : 'border-[var(--border)]'
                }`}
              >
                {/* Frame Header: Device + (width × height) zoom% + single screenshot trigger */}
                <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelect(idx)}
                    aria-pressed={isChecked}
                    className="flex items-center gap-2 min-w-0 text-left cursor-pointer studio-focus rounded-[6px]"
                  >
                    <span className="text-[var(--ink)] shrink-0">
                      {isChecked ? (
                        <CheckSquare size={16} strokeWidth={1.5} />
                      ) : (
                        <Square size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                      )}
                    </span>
                    <span className="text-[var(--ink-muted)] shrink-0">{getDeviceIcon(res.width)}</span>
                    <span className="type-ui-medium text-[var(--ink)] truncate">{res.name}</span>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="type-mono text-[var(--ink-muted)]">
                      {formatViewportFrameHeader(res, zoomPercent)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleStart([res])}
                      disabled={isRunning || !isValidUrl}
                      title={`Capture ${res.name} (${res.width}×${res.height})`}
                      aria-label={`Capture ${res.name}`}
                      className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center cursor-pointer disabled:opacity-50 studio-focus"
                    >
                      <Camera size={16} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                {/* Device Frame Body */}
                <div className="p-4 bg-[var(--canvas)] flex-1 flex flex-col items-center justify-center">
                  {captured ? (
                    <button
                      type="button"
                      onClick={() => onPreview(captured)}
                      className="w-full text-left cursor-pointer rounded-[8px] overflow-hidden border border-[var(--border)] bg-[var(--surface)] studio-focus"
                      style={{ maxWidth: `${scaledWidthPercent}%` }}
                    >
                      <div className="w-full overflow-hidden bg-[var(--canvas)]" style={{ aspectRatio: aspect }}>
                        <img
                          src={captured.thumbnailUrl || captured.dataUrl}
                          alt={captured.title}
                          className="w-full h-full object-cover object-top block"
                        />
                      </div>
                      <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--surface)] space-y-1">
                        <div className="type-mono text-[var(--ink)]">
                          {captured.viewport
                            ? `${captured.viewport.width}×${captured.viewport.height} CSS · ${captured.width}×${captured.height} px`
                            : `${captured.width}×${captured.height} px`}
                        </div>
                        {captured.viewport &&
                          (captured.viewport.width !== captured.viewport.requestedWidth ||
                            captured.viewport.height !== captured.viewport.requestedHeight) && (
                            <div className="type-caption text-[var(--ink-muted)]">
                              Requested {captured.viewport.requestedWidth}×{captured.viewport.requestedHeight}; window limits adjusted viewport.
                            </div>
                          )}
                      </div>
                    </button>
                  ) : (
                    <div
                      className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] flex flex-col items-center justify-center p-4 text-center space-y-1"
                      style={{
                        maxWidth: `${scaledWidthPercent}%`,
                        aspectRatio: aspect,
                        maxHeight: '200px',
                      }}
                    >
                      <span className="type-mono text-[var(--ink)]">
                        {res.width} × {res.height}
                      </span>
                      <span className="type-caption text-[var(--ink-muted)]">
                        {isChecked ? 'Included in matrix run' : 'Not selected'}
                      </span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Popup-only sticky footer CTA */}
      {!isFullTab && (
        <footer className="p-4 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
          <button
            type="button"
            onClick={() => handleStart()}
            disabled={isRunning || selectedIndices.length === 0 || !isValidUrl}
            className="w-full h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            {isRunning ? (
              <>
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                <span>Capturing viewports…</span>
              </>
            ) : (
              <>
                <Play size={16} strokeWidth={1.5} />
                <span>Capture selected ({selectedIndices.length})</span>
              </>
            )}
          </button>
        </footer>
      )}
    </div>
  );
});
