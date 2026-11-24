import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Crop,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Monitor,
  Play,
  RefreshCw,
  ScreenShare,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Upload,
} from 'lucide-react';
import type { CaptureSettings, FolderAccessState, HistoryItem } from '../../types';
import type { OpenTabInfo } from '../../utils/capture';
import {
  computeLibrarySummary,
  formatSaveDestinationSummary,
  formatTimestamp,
  getModeLabel,
  safeHostname,
} from '../../utils/studioFormat';
import { CropReticleFrame } from './CropReticleFrame';
import type { StudioView } from './StudioShell';

interface StudioHubViewProps {
  history: HistoryItem[];
  settings: CaptureSettings;
  folderStatusState: FolderAccessState;
  openTabs: OpenTabInfo[];
  selectedTabId?: number;
  isLoadingTabs: boolean;
  isCapturing: boolean;
  lastCaptureError: string | null;
  copiedShortcut: string | null;
  selectedItemId: string | null;
  onSelectTabId: (id: number) => void;
  onRefreshTabs: () => void;
  onDismissCaptureError: () => void;
  onCaptureFullPage: () => void;
  onCaptureVisible: () => void;
  onCaptureSelection: () => void;
  onCaptureElement: () => void;
  onCaptureDesktop: () => void;
  onCaptureAllTabs: () => void;
  onCopyShortcut: (shortcut: string, label: string) => void;
  onNavigateView: (view: StudioView) => void;
  onSelectItem: (item: HistoryItem) => void;
  onSelectPreview: (item: HistoryItem) => void;
  onImportClick: () => void;
}

export const StudioHubView: React.FC<StudioHubViewProps> = ({
  history,
  settings,
  folderStatusState,
  openTabs,
  selectedTabId,
  isLoadingTabs,
  isCapturing,
  lastCaptureError,
  copiedShortcut,
  selectedItemId,
  onSelectTabId,
  onRefreshTabs,
  onDismissCaptureError,
  onCaptureFullPage,
  onCaptureVisible,
  onCaptureSelection,
  onCaptureElement,
  onCaptureDesktop,
  onCaptureAllTabs,
  onCopyShortcut,
  onNavigateView,
  onSelectItem,
  onSelectPreview,
  onImportClick,
}) => {
  const summary = computeLibrarySummary(history);
  const saveSummary = formatSaveDestinationSummary(settings, folderStatusState);
  const recentItems = history.slice(0, 4);

  const captureCommands = [
    {
      id: 'full',
      icon: <FileText size={16} strokeWidth={1.5} />,
      title: 'Full page scroll & stitch',
      description: 'Auto-scrolls lazy content, suppresses sticky headers, and stitches tall pages.',
      shortcut: 'Alt+Shift+1',
      copyLabel: 'Full page capture',
      action: onCaptureFullPage,
    },
    {
      id: 'visible',
      icon: <Monitor size={16} strokeWidth={1.5} />,
      title: 'Visible viewport',
      description: 'Instant capture of the active browser viewport at native pixel density.',
      shortcut: 'Alt+Shift+3',
      copyLabel: 'Visible viewport',
      action: onCaptureVisible,
    },
    {
      id: 'selection',
      icon: <Crop size={16} strokeWidth={1.5} />,
      title: 'Region selection',
      description: 'Crosshair crop overlay with live pixel dimensions on the target tab.',
      shortcut: 'Alt+Shift+4',
      copyLabel: 'Region selection',
      action: onCaptureSelection,
    },
    {
      id: 'element',
      icon: <ScrollText size={16} strokeWidth={1.5} />,
      title: 'Scrollable element',
      description: 'Capture nested overflow panels such as logs, chats, or data tables.',
      shortcut: null,
      copyLabel: '',
      action: onCaptureElement,
    },
    {
      id: 'alltabs',
      icon: <Layers size={16} strokeWidth={1.5} />,
      title: 'All open tabs',
      description: 'Sweep every capturable tab in the current window into your Gallery.',
      shortcut: null,
      copyLabel: '',
      action: onCaptureAllTabs,
    },
  ];

  const workspaceTools: Array<{
    view: StudioView;
    icon: React.ReactNode;
    title: string;
    description: string;
  }> = [
    {
      view: 'media',
      icon: <ImageIcon size={16} strokeWidth={1.5} />,
      title: 'Page media yoinker',
      description: 'Extract srcset images, inline SVGs, CSS backgrounds, and video frames.',
    },
    {
      view: 'urllist',
      icon: <Globe size={16} strokeWidth={1.5} />,
      title: 'Batch URL queue',
      description: 'Queue URLs for sequential tab capture and automatic gallery indexing.',
    },
    {
      view: 'multisize',
      icon: <Smartphone size={16} strokeWidth={1.5} />,
      title: 'Responsive matrix',
      description: 'Capture mobile, tablet, laptop, and desktop viewports in one run.',
    },
    {
      view: 'verify',
      icon: <ShieldCheck size={16} strokeWidth={1.5} />,
      title: 'Proof Vault',
      description: 'Verify ECDSA P-256 signatures, IPTC metadata, and pixel integrity.',
    },
  ];

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6">
      {/* Error banner if background capture failed */}
      {lastCaptureError && (
        <div
          role="alert"
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle
              size={16}
              strokeWidth={1.5}
              className="text-[var(--semantic-error)] shrink-0"
            />
            <span className="type-ui text-[var(--ink)] break-words">{lastCaptureError}</span>
          </div>
          <button
            type="button"
            onClick={onDismissCaptureError}
            className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] type-caption text-[var(--ink)] cursor-pointer shrink-0 studio-focus"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SUMMARY BEFORE DETAIL: Target Tab Launch Strip + Live Engine Summary */}
      <section aria-label="Capture summary and target tab" className="space-y-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="studio-target-tab" className="type-caption text-[var(--ink-muted)]">
              Target browser tab
            </label>
            <span className="type-mono text-[var(--ink-muted)]">
              {openTabs.length} {openTabs.length === 1 ? 'tab open' : 'tabs open'}
            </span>
          </div>

          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {openTabs.length > 0 ? (
                <select
                  id="studio-target-tab"
                  value={selectedTabId ?? openTabs[0]?.id ?? ''}
                  onChange={(e) => onSelectTabId(Number(e.target.value))}
                  className="flex-1 min-w-0 w-full h-9 px-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink)] cursor-pointer truncate studio-focus"
                >
                  {openTabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.title} — {safeHostname(tab.url)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="flex-1 min-w-0 type-ui text-[var(--ink-muted)]">
                  No capturable web tabs detected. Open an http or https webpage, then refresh.
                </p>
              )}

              <button
                type="button"
                onClick={onRefreshTabs}
                disabled={isLoadingTabs}
                aria-label="Refresh open tabs"
                title="Refresh open tabs"
                className="w-9 h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50 transition-colors studio-focus"
              >
                <RefreshCw
                  size={16}
                  strokeWidth={1.5}
                  className={isLoadingTabs ? 'animate-spin' : ''}
                />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
              {/* Single Primary CTA on Studio Hub (Accent #1) */}
              <button
                type="button"
                onClick={onCaptureFullPage}
                disabled={isCapturing}
                className="h-9 px-3 sm:px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-opacity studio-focus"
              >
                <Play size={16} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">Capture full page</span>
              </button>

              <button
                type="button"
                onClick={onCaptureDesktop}
                disabled={isCapturing}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-colors studio-focus"
              >
                <ScreenShare size={16} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">Capture screen</span>
              </button>
            </div>
          </div>
        </div>

        {/* Hairline-divided real library & engine summary */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
          <div className="p-4 space-y-1 min-w-0">
            <div className="type-caption text-[var(--ink-muted)]">Saved captures</div>
            <div className="type-display-l text-[var(--ink)] tabular-nums">
              {summary.totalCount}
            </div>
            <div className="type-mono text-[var(--ink-muted)] truncate">
              {summary.signedCount} Proof signed
            </div>
          </div>

          <div className="p-4 space-y-1 min-w-0">
            <div className="type-caption text-[var(--ink-muted)]">Output engine</div>
            <div className="type-display-s text-[var(--ink)] tabular-nums">
              {(settings.format || 'png').toUpperCase()} · {settings.scaleFactor || 1}x
            </div>
            <div className="type-mono text-[var(--ink-muted)] truncate">
              {(settings.enableProof ?? true) ? 'ECDSA P-256 signing on' : 'ECDSA signing off'}
            </div>
          </div>

          <div className="p-4 space-y-1 min-w-0">
            <div className="type-caption text-[var(--ink-muted)]">Save destination</div>
            <div className="type-display-s text-[var(--ink)] truncate">{saveSummary.label}</div>
            <div className="type-mono text-[var(--ink-muted)] truncate">{saveSummary.detail}</div>
          </div>
        </div>
      </section>

      {/* RECENT CAPTURES WORKBENCH (Eagle density, synced to Inspector rail/sheet) */}
      <section aria-label="Recent captures" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="type-display-s text-[var(--ink)]">Recent captures</h2>
            <span className="type-mono text-[var(--ink-muted)]">{history.length} total</span>
          </div>

          <button
            type="button"
            onClick={() => onNavigateView('history')}
            className="h-8 px-2 rounded-[8px] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium flex items-center gap-2 cursor-pointer transition-colors studio-focus"
          >
            <span>Open gallery</span>
            <ArrowRight size={16} strokeWidth={1.5} />
          </button>
        </div>

        {recentItems.length === 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h3 className="type-body-medium text-[var(--ink)]">No captures saved yet</h3>
              <p className="type-ui text-[var(--ink-muted)]">
                Run a capture above, press Alt+Shift+1 on any webpage, or paste an image with Ctrl+V.
              </p>
            </div>
            <button
              type="button"
              onClick={onImportClick}
              className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium flex items-center gap-2 shrink-0 cursor-pointer transition-colors studio-focus"
            >
              <Upload size={16} strokeWidth={1.5} />
              <span>Import image</span>
            </button>
          </div>
        ) : (
          <div className="studio-gallery-grid">
            {recentItems.map((item) => {
              const isSelected = selectedItemId === item.id;
              return (
                <div key={item.id} className="min-w-0 space-y-2">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => onSelectItem(item)}
                    onDoubleClick={() => onSelectPreview(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectItem(item);
                      }
                    }}
                    className="cursor-pointer rounded-[12px] studio-focus"
                  >
                    <CropReticleFrame item={item} selected={isSelected} showProofStamp={true} />
                  </div>

                  <div className="px-1 space-y-1 min-w-0">
                    <h3 className="type-body-medium text-[var(--ink)] truncate">
                      {item.title || 'Untitled capture'}
                    </h3>
                    <p className="type-mono text-[var(--ink-muted)] truncate">
                      {getModeLabel(item.mode)} · {safeHostname(item.url)} ·{' '}
                      {formatTimestamp(item.timestamp).short}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* CAPTURE MODES COMMAND LIST (Raycast / Linear hairline rows) */}
      <section aria-label="Capture modes" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-display-s text-[var(--ink)]">Capture modes</h2>
          <span className="type-mono text-[var(--ink-muted)]">
            Click a row to run or copy its shortcut
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
          {captureCommands.map((cmd) => (
            <div
              key={cmd.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isCapturing) cmd.action();
              }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isCapturing) {
                  e.preventDefault();
                  cmd.action();
                }
              }}
              className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--canvas)] transition-colors cursor-pointer studio-focus"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span className="w-4 h-4 mt-0.5 text-[var(--ink-muted)] shrink-0 flex items-center justify-center">
                  {cmd.icon}
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="type-body-medium text-[var(--ink)]">{cmd.title}</div>
                  <p className="type-ui text-[var(--ink-muted)]">{cmd.description}</p>
                </div>
              </div>

              {cmd.shortcut ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (cmd.shortcut) {
                      onCopyShortcut(cmd.shortcut, cmd.copyLabel);
                    }
                  }}
                  title={`Copy shortcut ${cmd.shortcut}`}
                  className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)] type-keycap flex items-center gap-1 shrink-0 cursor-pointer studio-focus"
                >
                  {copiedShortcut === cmd.shortcut ? (
                    <>
                      <Check size={12} strokeWidth={1.5} />
                      <span>Copied</span>
                    </>
                  ) : (
                    <span>{cmd.shortcut}</span>
                  )}
                </button>
              ) : (
                <ChevronRight
                  size={16}
                  strokeWidth={1.5}
                  className="text-[var(--ink-muted)] shrink-0"
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* WORKSPACE TOOLS GRID */}
      <section aria-label="Workspace tools" className="space-y-3">
        <h2 className="type-display-s text-[var(--ink)]">Workspace tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {workspaceTools.map((tool) => (
            <button
              key={tool.view}
              type="button"
              onClick={() => onNavigateView(tool.view)}
              className="p-4 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--canvas)] flex items-start justify-between gap-3 text-left cursor-pointer transition-colors studio-focus"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span className="w-4 h-4 mt-0.5 text-[var(--ink-muted)] shrink-0 flex items-center justify-center">
                  {tool.icon}
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="type-body-medium text-[var(--ink)]">{tool.title}</div>
                  <p className="type-ui text-[var(--ink-muted)]">{tool.description}</p>
                </div>
              </div>
              <ChevronRight
                size={16}
                strokeWidth={1.5}
                className="text-[var(--ink-muted)] shrink-0 mt-0.5"
              />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
