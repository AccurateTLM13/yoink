import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Circle,
  ExternalLink,
  ListPlus,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { BatchIssue, CaptureSettings, HistoryItem } from '../types';
import { captureUrlList, getOpenTabUrls, ensureAllSitesAccess } from '../utils/capture';
import { formatCaptureReadout, safeHostname } from '../utils/studioFormat';

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

export const UrlBatchModal: React.FC<Props> = React.memo(function UrlBatchModal({
  settings,
  onBack,
  onFinished,
  onPreview,
  isFullTab = false,
}: Props) {
  const [urlsText, setUrlsText] = useState(DEFAULT_SAMPLE_URLS);
  const [delaySec, setDelaySec] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  const [hasIssues, setHasIssues] = useState(false);
  const [progressStep, setProgressStep] = useState({ current: 0, total: 0 });
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);
  const [issues, setIssues] = useState<BatchIssue[]>([]);

  const inputUrls = useMemo(
    () =>
      urlsText
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean),
    [urlsText]
  );

  const validUrls = useMemo(
    () =>
      inputUrls.filter((u) => {
        try {
          return ['http:', 'https:'].includes(new URL(u).protocol);
        } catch {
          return false;
        }
      }),
    [inputUrls]
  );

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
        setHasIssues(true);
        setProgressMsg('Yoink needs access to all sites for batch URL capture.');
        return;
      }
      setIsRunning(true);
      setHasIssues(false);
      setActiveUrl(targets[0] || null);
      setProgressStep({ current: 0, total: targets.length });
      setIssues([]);
      setProgressMsg('Starting batch capture sequence…');
      setCompletedItems([]);
    } catch (error) {
      setHasIssues(true);
      setProgressMsg(
        `Could not request site access: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return;
    }

    try {
      const results = await captureUrlList(
        targets,
        settings,
        delaySec * 1000,
        (current, total, currentTarget) => {
          setProgressStep({ current, total });
          setActiveUrl(currentTarget);
          setProgressMsg(`Capturing ${current} of ${total}: ${currentTarget}`);
        },
        (outcome) => {
          failed = [...outcome.failures, ...outcome.skipped];
          setIssues(failed);
          setHasIssues(failed.length > 0);
        }
      );
      setCompletedItems(results);
      onFinished(results);
      setProgressMsg(
        `Batch complete: ${results.length} captured, ${failed.length} failed or skipped.`
      );
    } catch (err: unknown) {
      setHasIssues(true);
      setProgressMsg(`Error: ${err instanceof Error ? err.message : 'Batch capture failed'}`);
    } finally {
      setIsRunning(false);
      setActiveUrl(null);
    }
  };

  const completedByUrl = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const item of completedItems) {
      if (item.url) map.set(item.url, item);
    }
    return map;
  }, [completedItems]);

  const issueByUrl = useMemo(() => {
    const map = new Map<string, BatchIssue>();
    for (const issue of issues) {
      map.set(issue.target, issue);
    }
    return map;
  }, [issues]);

  return (
    <div className="flex flex-col h-full bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden">
      {/* Popup-only 44px sub-header */}
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
          <span className="type-mono text-[var(--ink-muted)]">{validUrls.length} URLs</span>
        </header>
      )}

      {/* Main Content */}
      <div className={`flex-1 overflow-y-auto ${isFullTab ? 'p-4 md:p-6 space-y-6' : 'p-4 space-y-4'}`}>
        {/* Queue Configuration Card */}
        <section
          aria-label="URL queue input"
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <label htmlFor="batch-urls-textarea" className="type-display-s text-[var(--ink)] block">
                Target URLs
              </label>
              <p className="type-ui text-[var(--ink-muted)]">
                Enter one http or https URL per line (up to 100) or load open tabs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleLoadOpenTabs}
                disabled={isRunning}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
              >
                <ListPlus size={16} strokeWidth={1.5} />
                <span>Load open tabs</span>
              </button>

              {urlsText.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={isRunning}
                  aria-label="Clear URL queue"
                  title="Clear URL queue"
                  className="w-9 h-9 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)] flex items-center justify-center cursor-pointer disabled:opacity-50 studio-focus"
                >
                  <Trash2 size={16} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>

          <textarea
            id="batch-urls-textarea"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            disabled={isRunning}
            rows={isFullTab ? 6 : 4}
            placeholder={'https://example.com/page-1\nhttps://example.com/page-2'}
            className="w-full p-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-mono text-[var(--ink)] placeholder:text-[var(--ink-muted)] resize-y select-text studio-focus disabled:opacity-50"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[var(--border)]">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="batch-delay-slider" className="type-ui text-[var(--ink)]">
                  Page render delay
                </label>
                <span className="type-mono text-[var(--ink)]">{delaySec}s</span>
              </div>
              <input
                id="batch-delay-slider"
                type="range"
                min="1"
                max="8"
                step="1"
                value={delaySec}
                onChange={(e) => setDelaySec(parseInt(e.target.value, 10))}
                disabled={isRunning}
                className="w-full h-2 rounded-[6px] bg-[var(--canvas)] cursor-pointer studio-range disabled:opacity-50"
              />
            </div>

            {isFullTab && (
              <button
                type="button"
                onClick={() => handleStart()}
                disabled={isRunning || validUrls.length === 0 || invalidQueue}
                className="h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 studio-focus"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                    <span>Running…</span>
                  </>
                ) : (
                  <>
                    <Play size={16} strokeWidth={1.5} />
                    <span>
                      Capture {validUrls.length} {validUrls.length === 1 ? 'URL' : 'URLs'}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>

          {invalidQueue && (
            <div
              role="alert"
              className="p-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] flex items-start gap-2"
            >
              <XCircle
                size={16}
                strokeWidth={1.5}
                className="text-[var(--semantic-error)] shrink-0 mt-0.5"
              />
              <span className="type-ui text-[var(--ink)]">
                {invalidCount > 0
                  ? `${invalidCount} invalid line(s). Enter one complete http or https URL per line. `
                  : ''}
                {validUrls.length > 100 ? 'Maximum 100 URLs per batch.' : ''}
              </span>
            </div>
          )}
        </section>

        {/* Live Run Status Summary */}
        {progressMsg && (
          <div
            role="status"
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {isRunning ? (
                  <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)] shrink-0" />
                ) : hasIssues ? (
                  <XCircle size={16} strokeWidth={1.5} className="text-[var(--semantic-error)] shrink-0" />
                ) : (
                  <CheckCircle2 size={16} strokeWidth={1.5} className="text-[var(--semantic-valid)] shrink-0" />
                )}
                <span className="type-body-medium text-[var(--ink)] break-words">{progressMsg}</span>
              </div>

              {issues.length > 0 && !isRunning && (
                <button
                  type="button"
                  onClick={() => handleStart(issues.map((issue) => issue.target))}
                  className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center gap-2 shrink-0 cursor-pointer studio-focus"
                >
                  <RotateCcw size={16} strokeWidth={1.5} />
                  <span>Retry failed ({issues.length})</span>
                </button>
              )}
            </div>

            {isRunning && progressStep.total > 0 && (
              <div className="w-full h-1 rounded-[4px] bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full bg-[var(--ink)] transition-all"
                  style={{ width: `${Math.round((progressStep.current / progressStep.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Full-Width Single-Column Run Rows (GitHub Actions pattern) */}
        <section aria-label="Batch run queue" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="type-display-s text-[var(--ink)]">Run queue</h2>
            <span className="type-mono text-[var(--ink-muted)]">
              {completedItems.length}/{validUrls.length} completed
            </span>
          </div>

          {validUrls.length === 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-6 text-center space-y-1">
              <p className="type-body-medium text-[var(--ink)]">Queue is empty</p>
              <p className="type-ui text-[var(--ink-muted)]">
                Paste URLs above or load open tabs to prepare a batch run.
              </p>
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
              {validUrls.map((url, idx) => {
                const doneItem = completedByUrl.get(url);
                const failedIssue = issueByUrl.get(url);
                const isActive = isRunning && activeUrl === url;

                return (
                  <div
                    key={`${url}-${idx}`}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[var(--canvas)] transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
                        {isActive ? (
                          <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)]" />
                        ) : doneItem ? (
                          <CheckCircle2
                            size={16}
                            strokeWidth={1.5}
                            className="text-[var(--semantic-valid)]"
                          />
                        ) : failedIssue ? (
                          <XCircle
                            size={16}
                            strokeWidth={1.5}
                            className="text-[var(--semantic-error)]"
                          />
                        ) : (
                          <Circle size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="type-body-medium text-[var(--ink)] truncate">
                          {doneItem?.title || safeHostname(url)}
                        </div>
                        <div className="type-mono text-[var(--ink-muted)] truncate">{url}</div>
                        {failedIssue && (
                          <div className="type-ui text-[var(--semantic-error)] break-words">
                            {failedIssue.reason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 pl-6 sm:pl-0">
                      {doneItem ? (
                        <>
                          <span className="type-mono text-[var(--ink-muted)]">
                            {formatCaptureReadout(doneItem)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onPreview(doneItem)}
                            className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-2 cursor-pointer studio-focus"
                          >
                            <span>Inspect</span>
                            <ExternalLink size={16} strokeWidth={1.5} />
                          </button>
                        </>
                      ) : (
                        <span className="type-mono text-[var(--ink-muted)]">
                          {isActive ? 'Capturing' : failedIssue ? 'Failed' : 'Queued'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Popup-only sticky footer primary action */}
      {!isFullTab && (
        <footer className="p-4 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
          <button
            type="button"
            onClick={() => handleStart()}
            disabled={isRunning || validUrls.length === 0 || invalidQueue}
            className="w-full h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
          >
            {isRunning ? (
              <>
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                <span>Processing…</span>
              </>
            ) : (
              <>
                <Play size={16} strokeWidth={1.5} />
                <span>
                  Capture {validUrls.length} {validUrls.length === 1 ? 'URL' : 'URLs'}
                </span>
              </>
            )}
          </button>
        </footer>
      )}
    </div>
  );
});
