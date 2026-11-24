import React, { useState, useId, useEffect, useRef } from 'react';
import {
  Check,
  ChevronLeft,
  Copy,
  FolderOpen,
  Key,
  Keyboard,
  RotateCcw,
  Save,
  ScanText,
  ShieldCheck,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type { CaptureFormat, CaptureSettings } from '../types';
import { DEFAULT_SETTINGS, applyOptimalQualityPreset } from '../utils/storage';
import { formatFilename } from '../utils/capture';
import { getOrCreateProofIdentity } from '../utils/proof';
import {
  POPUP_CAPTURE_DELAYS,
  SETTINGS_TABS,
  formatDelayLabel,
  getNextSettingsTab,
  resolveInitialSettingsTab,
  type SettingsTabId,
} from '../utils/studioFormat';
import { SaveDestinationControl } from './SaveDestinationControl';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onSave: (newSettings: CaptureSettings) => void;
  onOpenVerify?: () => void;
  isFullTab?: boolean;
  highlightFolderPicker?: boolean;
}

const AVAILABLE_TOKENS = [
  '{title}',
  '{date}',
  '{time}',
  '{domain}',
  '{type}',
  '{width}',
  '{height}',
];

const SHORTCUT_ROWS = [
  { label: 'Full page scroll & stitch', key: 'Alt+Shift+1' },
  { label: 'Visible viewport', key: 'Alt+Shift+3' },
  { label: 'Region selection', key: 'Alt+Shift+4' },
] as const;

const CHROME_SHORTCUTS_URL = 'chrome://extensions/shortcuts';

const TAB_ICONS: Record<SettingsTabId, React.ReactNode> = {
  capture: <Sliders size={16} strokeWidth={1.5} className="shrink-0" />,
  files: <FolderOpen size={16} strokeWidth={1.5} className="shrink-0" />,
  proof: <ShieldCheck size={16} strokeWidth={1.5} className="shrink-0" />,
  shortcuts: <Keyboard size={16} strokeWidth={1.5} className="shrink-0" />,
};

export const OptionsDrawer: React.FC<Props> = React.memo(function OptionsDrawer({
  settings,
  onBack,
  onSave,
  onOpenVerify,
  isFullTab = false,
  highlightFolderPicker = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() =>
    resolveInitialSettingsTab(highlightFolderPicker)
  );
  const [keyFingerprint, setKeyFingerprint] = useState<string>('');
  const [form, setForm] = useState<CaptureSettings>({ ...settings });
  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'key' | 'shortcuts' | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Partial<Record<SettingsTabId, HTMLButtonElement | null>>>({});

  const enableProofId = useId();
  const visualStampId = useId();
  const autoDownloadId = useId();
  const hideStickyId = useId();
  const clipboardId = useId();
  const autoSliceId = useId();
  const losslessWebpId = useId();
  const optimalQualityId = useId();
  const allWindowsId = useId();

  useEffect(() => {
    getOrCreateProofIdentity()
      .then((id) => setKeyFingerprint(id.keyFingerprint))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setForm((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  useEffect(() => {
    if (highlightFolderPicker) {
      setActiveTab('files');
    }
  }, [highlightFolderPicker]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const triggerSavedBadge = () => {
    setSaved(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaved(false), 1600);
  };

  const handleCopyText = async (target: 'key' | 'shortcuts', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedTarget(null), 1600);
    } catch {
      // Clipboard write unavailable in restricted context
    }
  };

  const updateForm = (patch: Partial<CaptureSettings>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      onSave(next);
      return next;
    });
    triggerSavedBadge();
  };

  const handleSave = () => {
    onSave(form);
    triggerSavedBadge();
  };

  const handleBack = () => {
    onSave(form);
    onBack();
  };

  const handleReset = () => {
    const defaults = { ...DEFAULT_SETTINGS };
    setForm(defaults);
    onSave(defaults);
    setResetConfirm(false);
    triggerSavedBadge();
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, current: SettingsTabId) => {
    const nextTab = getNextSettingsTab(current, e.key);
    if (!nextTab) return;
    e.preventDefault();
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const insertToken = (token: string) => {
    if (form.filenameTemplate.includes(token)) return;
    const separator =
      form.filenameTemplate.endsWith('_') || form.filenameTemplate.length === 0 ? '' : '_';
    updateForm({
      filenameTemplate: `${form.filenameTemplate}${separator}${token}`,
    });
  };

  const sampleFilename = formatFilename(
    form.filenameTemplate || '{title}_{date}_{time}',
    'Dashboard_Analytics',
    'https://app.yoink.com/reports',
    'full',
    form.format,
    1440,
    900
  );

  const destinationSummary =
    form.saveLocationMode === 'folder'
      ? form.customSaveFolderName || 'Custom folder'
      : form.saveLocationMode === 'ask'
      ? 'Ask each save'
      : 'Downloads';

  const captureSummary = `${form.format.toUpperCase()} · ${form.scaleFactor || 1}x · ${form.scrollDelayMs} ms · Countdown ${formatDelayLabel(form.captureDelaySec || 0)}`;
  const filesSummary = `${destinationSummary} · ${form.autoDownload ? 'Auto-save on' : 'Manual save'}`;
  const proofSummary = `${form.enableProof !== false ? 'Signing on' : 'Signing paused'}${keyFingerprint ? ` · #${keyFingerprint}` : ''}`;
  const shortcutsSummary = `${SHORTCUT_ROWS.length} active bindings · Local OCR`;

  const gridClass = isFullTab ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 items-start' : 'space-y-6';

  const actionButtons = (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={() => setResetConfirm(true)}
        aria-label="Reset settings to defaults"
        className={`h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus ${
          isFullTab ? 'px-2 sm:px-3' : 'px-3'
        }`}
        title="Reset settings to defaults"
      >
        <RotateCcw size={16} strokeWidth={1.5} />
        {isFullTab && <span className="hidden sm:inline">Reset defaults</span>}
      </button>

      {/* Single Primary CTA */}
      <button
        type="button"
        onClick={handleSave}
        className="h-8 px-3 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
      >
        {saved ? <Check size={16} strokeWidth={1.5} /> : <Save size={16} strokeWidth={1.5} />}
        <span>{saved ? 'Saved' : 'Save'}</span>
      </button>
    </div>
  );

  const tabList = (
    <div
      role="tablist"
      aria-label="Engine settings sections"
      className={`flex flex-wrap items-center gap-2 ${isFullTab ? 'sm:gap-4 lg:order-1' : ''}`}
    >
      {SETTINGS_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            id={`settings-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            className={`h-[40px] ${isFullTab ? 'lg:h-[52px] px-1 sm:px-2' : 'px-1'} -mb-px border-b-2 type-ui-medium inline-flex items-center gap-2 cursor-pointer transition-colors studio-focus ${
              isActive
                ? 'border-[var(--ink)] text-[var(--ink)]'
                : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
          >
            {TAB_ICONS[tab.id]}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden">
      {/* Docked Action & Section Tab Bar */}
      {isFullTab ? (
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 md:px-6 shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="h-[44px] lg:h-[52px] border-b border-[var(--border)] lg:border-b-0 flex items-center justify-between lg:justify-end gap-2 lg:order-2 shrink-0">
            <span className="type-mono text-[var(--ink-muted)] lg:hidden">
              Auto-saved locally
            </span>
            {actionButtons}
          </div>
          {tabList}
        </div>
      ) : (
        <>
          <header className="h-[44px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={handleBack}
              className="h-8 px-2 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
              <span>Back</span>
            </button>
            {actionButtons}
          </header>

          <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 shrink-0">
            {tabList}
          </div>
        </>
      )}

      {/* Reset Confirmation */}
      {resetConfirm && (
        <div className="px-4 md:px-6 pt-4 shrink-0">
          <div className="p-4 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <p className="type-ui text-[var(--ink)]">
              Reset all capture settings to default values?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="h-8 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-ui-medium cursor-pointer studio-focus"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] type-ui-medium cursor-pointer studio-focus"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Tab Panel */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div
          id={`settings-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className="space-y-6"
        >
          {/* TAB 1: CAPTURE */}
          {activeTab === 'capture' && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--border)]">
                <h2 className="type-display-s text-[var(--ink)]">Capture</h2>
                <span className="type-mono text-[var(--ink-muted)]">{captureSummary}</span>
              </div>

              {/* Optimal HD Preset */}
              <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Sparkles size={16} strokeWidth={1.5} className="text-[var(--ink)] mt-0.5 shrink-0" />
                    <div className="min-w-0 space-y-1">
                      <label htmlFor={optimalQualityId} className="type-body-medium text-[var(--ink)] block cursor-pointer">
                        Optimal HD preset (2x)
                      </label>
                      <p className="type-ui text-[var(--ink-muted)]">
                        Sets lossless PNG, 2x Retina scaling, 900ms scroll delay, and 4,000px anti-squish slicing.
                      </p>
                    </div>
                  </div>
                  <input
                    id={optimalQualityId}
                    type="checkbox"
                    checked={Boolean(form.optimalQualityMode)}
                    onChange={(e) => {
                      if (e.target.checked) updateForm(applyOptimalQualityPreset(form));
                      else updateForm({ optimalQualityMode: false });
                    }}
                    className="mt-1 w-4 h-4 cursor-pointer shrink-0 studio-range"
                  />
                </div>

                {form.optimalQualityMode && (
                  <div className="pt-3 border-t border-[var(--border)] flex flex-wrap gap-2">
                    {['Lossless PNG', '2x Retina', '4,000px slice', '900ms delay'].map((chip) => (
                      <span
                        key={chip}
                        className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-mono text-[var(--ink-muted)]"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <div className={gridClass}>
                {/* Format & Scale */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="type-caption text-[var(--ink-muted)]">Output format &amp; scale</h3>
                    <span className="type-mono text-[var(--ink-muted)]">
                      {form.format.toUpperCase()} · {form.scaleFactor || 1}x
                    </span>
                  </div>

                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-4">
                    <div className="grid grid-cols-3 gap-1 p-1 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)]">
                      {(['png', 'jpeg', 'webp'] as CaptureFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => updateForm({ format: fmt })}
                          aria-pressed={form.format === fmt}
                          className={`h-8 rounded-[6px] type-mono cursor-pointer transition-colors studio-focus ${
                            form.format === fmt
                              ? 'bg-[var(--ink)] text-[var(--surface)]'
                              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                          }`}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {form.format !== 'png' && (
                      <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="type-ui text-[var(--ink)]">Compression quality</span>
                          <span className="type-mono text-[var(--ink)]">
                            {form.losslessWebp && form.format === 'webp'
                              ? '100% lossless'
                              : `${Math.round(form.quality * 100)}%`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.4"
                          max="1.0"
                          step="0.05"
                          disabled={Boolean(form.losslessWebp && form.format === 'webp')}
                          value={form.losslessWebp && form.format === 'webp' ? 1.0 : form.quality}
                          onChange={(e) => updateForm({ quality: parseFloat(e.target.value) })}
                          className="w-full h-2 cursor-pointer studio-range disabled:opacity-50"
                        />

                        {form.format === 'webp' && (
                          <label htmlFor={losslessWebpId} className="flex items-center gap-2 pt-2 cursor-pointer">
                            <input
                              id={losslessWebpId}
                              type="checkbox"
                              checked={Boolean(form.losslessWebp)}
                              onChange={(e) =>
                                updateForm({
                                  losslessWebp: e.target.checked,
                                  quality: e.target.checked ? 1.0 : form.quality,
                                })
                              }
                              className="w-4 h-4 cursor-pointer studio-range"
                            />
                            <span className="type-ui text-[var(--ink)]">Lossless WebP encoding</span>
                          </label>
                        )}
                      </div>
                    )}

                    <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="type-ui text-[var(--ink)]">Capture pixel scale</span>
                        <span className="type-mono text-[var(--ink)]">{form.scaleFactor || 1}x</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 p-1 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)]">
                        {[1, 1.5, 2].map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            onClick={() => updateForm({ scaleFactor: sc })}
                            aria-pressed={(form.scaleFactor || 1) === sc}
                            className={`h-8 rounded-[6px] type-mono cursor-pointer transition-colors studio-focus ${
                              (form.scaleFactor || 1) === sc
                                ? 'bg-[var(--ink)] text-[var(--surface)]'
                                : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                            }`}
                          >
                            {sc}x{sc === 2 ? ' Retina' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Scroll, Countdown & Page Handling */}
                <div className="space-y-6">
                  <section className="space-y-3">
                    <h3 className="type-caption text-[var(--ink-muted)]">Scroll &amp; capture timing</h3>
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="type-ui text-[var(--ink)]">Scroll step delay</span>
                          <span className="type-mono text-[var(--ink)]">{form.scrollDelayMs} ms</span>
                        </div>
                        <input
                          type="range"
                          min="200"
                          max="1600"
                          step="100"
                          value={form.scrollDelayMs}
                          onChange={(e) => updateForm({ scrollDelayMs: parseInt(e.target.value, 10) })}
                          className="w-full h-2 cursor-pointer studio-range"
                        />
                        <div className="flex justify-between type-mono text-[var(--ink-muted)]">
                          <span>200 ms</span>
                          <span>600 ms</span>
                          <span>1600 ms</span>
                        </div>
                      </div>

                      <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="type-ui text-[var(--ink)]">Capture countdown</span>
                          <span className="type-mono text-[var(--ink)]">
                            {formatDelayLabel(form.captureDelaySec || 0)}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1 p-1 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)]">
                          {POPUP_CAPTURE_DELAYS.map((sec) => (
                            <button
                              key={sec}
                              type="button"
                              onClick={() => updateForm({ captureDelaySec: sec })}
                              aria-pressed={(form.captureDelaySec || 0) === sec}
                              className={`h-8 rounded-[6px] type-mono cursor-pointer transition-colors studio-focus ${
                                (form.captureDelaySec || 0) === sec
                                  ? 'bg-[var(--ink)] text-[var(--surface)]'
                                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                              }`}
                            >
                              {formatDelayLabel(sec)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="type-caption text-[var(--ink-muted)]">Page handling</h3>
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
                      <label htmlFor={hideStickyId} className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--canvas)] transition-colors">
                        <input
                          id={hideStickyId}
                          type="checkbox"
                          checked={form.hideStickyElements}
                          onChange={(e) => updateForm({ hideStickyElements: e.target.checked })}
                          className="mt-0.5 w-4 h-4 cursor-pointer shrink-0 studio-range"
                        />
                        <div className="min-w-0 space-y-1">
                          <span className="type-body-medium text-[var(--ink)] block">
                            Suppress sticky headers
                          </span>
                          <span className="type-ui text-[var(--ink-muted)] block">
                            Keeps fixed navigation visible at the top and hides duplicates on lower scroll chunks.
                          </span>
                        </div>
                      </label>

                      <div className="p-4 space-y-3">
                        <label htmlFor={autoSliceId} className="flex items-start gap-3 cursor-pointer">
                          <input
                            id={autoSliceId}
                            type="checkbox"
                            checked={Boolean(form.autoSliceLongPages)}
                            onChange={(e) => updateForm({ autoSliceLongPages: e.target.checked })}
                            className="mt-0.5 w-4 h-4 cursor-pointer shrink-0 studio-range"
                          />
                          <div className="min-w-0 space-y-1">
                            <span className="type-body-medium text-[var(--ink)] block">
                              Split tall pages automatically
                            </span>
                            <span className="type-ui text-[var(--ink-muted)] block">
                              Splits very tall pages into parts so chat tools do not compress them.
                            </span>
                          </div>
                        </label>

                        {form.autoSliceLongPages && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
                            <span className="type-caption text-[var(--ink-muted)]">Max part height</span>
                            <div className="flex items-center gap-1">
                              {[3000, 4000, 6000].map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => updateForm({ maxSliceHeight: h })}
                                  aria-pressed={(form.maxSliceHeight || 4000) === h}
                                  className={`h-8 px-2 rounded-[6px] border type-mono cursor-pointer studio-focus ${
                                    (form.maxSliceHeight || 4000) === h
                                      ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
                                      : 'bg-[var(--canvas)] text-[var(--ink-muted)] border-[var(--border)] hover:text-[var(--ink)]'
                                  }`}
                                >
                                  {h}px
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <label htmlFor={allWindowsId} className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--canvas)] transition-colors">
                        <input
                          id={allWindowsId}
                          type="checkbox"
                          checked={Boolean(form.captureAllWindows)}
                          onChange={(e) => updateForm({ captureAllWindows: e.target.checked })}
                          className="mt-0.5 w-4 h-4 cursor-pointer shrink-0 studio-range"
                        />
                        <div className="min-w-0 space-y-1">
                          <span className="type-body-medium text-[var(--ink)] block">
                            Sweep tabs across all windows
                          </span>
                          <span className="type-ui text-[var(--ink-muted)] block">
                            Includes every normal Chrome window when running Capture all tabs.
                          </span>
                        </div>
                      </label>
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: FILES */}
          {activeTab === 'files' && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--border)]">
                <h2 className="type-display-s text-[var(--ink)]">Files &amp; storage</h2>
                <span className="type-mono text-[var(--ink-muted)]">{filesSummary}</span>
              </div>

              <div className={gridClass}>
                {/* Save Destination & Post-Capture Storage */}
                <div className="space-y-6">
                  <section className="space-y-3">
                    <h3 className="type-caption text-[var(--ink-muted)]">Destination</h3>
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] overflow-hidden">
                      <SaveDestinationControl
                        settings={form}
                        onUpdateSettings={updateForm}
                        isFullTab={isFullTab}
                        returnView="options"
                        variant="full"
                        highlightPicker={highlightFolderPicker}
                      />
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="type-caption text-[var(--ink-muted)]">Post-capture automation</h3>
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
                      <label htmlFor={autoDownloadId} className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--canvas)] transition-colors">
                        <input
                          id={autoDownloadId}
                          type="checkbox"
                          checked={form.autoDownload}
                          onChange={(e) => updateForm({ autoDownload: e.target.checked })}
                          className="mt-0.5 w-4 h-4 cursor-pointer shrink-0 studio-range"
                        />
                        <div className="min-w-0 space-y-1">
                          <span className="type-body-medium text-[var(--ink)] block">Auto-save captures</span>
                          <span className="type-ui text-[var(--ink-muted)] block">
                            Writes each finished capture automatically to the selected destination.
                          </span>
                        </div>
                      </label>

                      <label htmlFor={clipboardId} className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--canvas)] transition-colors">
                        <input
                          id={clipboardId}
                          type="checkbox"
                          checked={form.copyToClipboard}
                          onChange={(e) => updateForm({ copyToClipboard: e.target.checked })}
                          className="mt-0.5 w-4 h-4 cursor-pointer shrink-0 studio-range"
                        />
                        <div className="min-w-0 space-y-1">
                          <span className="type-body-medium text-[var(--ink)] block">
                            Copy to clipboard on capture
                          </span>
                          <span className="type-ui text-[var(--ink-muted)] block">
                            Copies new captures onto the clipboard immediately.
                          </span>
                        </div>
                      </label>
                    </div>
                  </section>
                </div>

                {/* Filename Pattern */}
                <section className="space-y-3">
                  <h3 className="type-caption text-[var(--ink-muted)]">Filename pattern</h3>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-3">
                    <input
                      type="text"
                      value={form.filenameTemplate}
                      onChange={(e) => updateForm({ filenameTemplate: e.target.value })}
                      aria-label="Filename template"
                      placeholder="{title}_{date}_{time}"
                      className="w-full h-9 px-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-mono text-[var(--ink)] select-text studio-focus"
                    />

                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_TOKENS.map((token) => (
                        <button
                          key={token}
                          type="button"
                          onClick={() => insertToken(token)}
                          className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] type-mono text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer studio-focus"
                        >
                          {token}
                        </button>
                      ))}
                    </div>

                    <div className="p-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] space-y-1">
                      <span className="type-caption text-[var(--ink-muted)] block">Preview</span>
                      <p className="type-mono text-[var(--ink)] truncate select-all">{sampleFilename}</p>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}

          {/* TAB 3: PROOF */}
          {activeTab === 'proof' && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--border)]">
                <h2 className="type-display-s text-[var(--ink)]">Proof &amp; identity</h2>
                <span className="type-mono text-[var(--ink-muted)]">{proofSummary}</span>
              </div>

              <div className={gridClass}>
                {/* Proof Signing Controls */}
                <section className="space-y-3">
                  <h3 className="type-caption text-[var(--ink-muted)]">Cryptographic signing</h3>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <ShieldCheck size={16} strokeWidth={1.5} className="text-[var(--ink)] mt-0.5 shrink-0" />
                        <div className="min-w-0 space-y-1">
                          <label htmlFor={enableProofId} className="type-body-medium text-[var(--ink)] block cursor-pointer">
                            Yoink Proof signing
                          </label>
                          <p className="type-ui text-[var(--ink-muted)]">
                            Embeds ECDSA P-256 signature, SHA-256 pixel hash, and IPTC screenCapture metadata locally.
                          </p>
                        </div>
                      </div>
                      <input
                        id={enableProofId}
                        type="checkbox"
                        checked={form.enableProof !== false}
                        onChange={(e) => updateForm({ enableProof: e.target.checked })}
                        className="mt-1 w-4 h-4 cursor-pointer shrink-0 studio-range"
                      />
                    </div>

                    {form.enableProof !== false ? (
                      <div className="pt-3 border-t border-[var(--border)] space-y-4">
                        <label className="block space-y-1">
                          <span className="type-caption text-[var(--ink-muted)] block">Creator handle</span>
                          <input
                            type="text"
                            value={form.proofAuthor || ''}
                            onChange={(e) => updateForm({ proofAuthor: e.target.value })}
                            onBlur={() => onSave(form)}
                            placeholder="@handle"
                            maxLength={60}
                            className="w-full h-9 px-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-mono text-[var(--ink)] placeholder:text-[var(--ink-muted)] select-text studio-focus"
                          />
                        </label>

                        <label htmlFor={visualStampId} className="flex items-start gap-3 cursor-pointer">
                          <input
                            id={visualStampId}
                            type="checkbox"
                            checked={Boolean(form.proofVisualStamp)}
                            onChange={(e) => updateForm({ proofVisualStamp: e.target.checked })}
                            className="mt-0.5 w-4 h-4 cursor-pointer shrink-0 studio-range"
                          />
                          <div className="min-w-0 space-y-1">
                            <span className="type-ui-medium text-[var(--ink)] block">
                              Receipt provenance footer
                            </span>
                            <span className="type-ui text-[var(--ink-muted)] block">
                              Appends a 36px verification strip with origin, UTC timestamp, and key ID.
                            </span>
                          </div>
                        </label>
                      </div>
                    ) : (
                      <p className="pt-3 border-t border-[var(--border)] type-ui text-[var(--ink-muted)]">
                        New captures will save without an ECDSA signature or pixel watermark until signing is re-enabled.
                      </p>
                    )}
                  </div>
                </section>

                {/* Device Key & Proof Vault */}
                <section className="space-y-3">
                  <h3 className="type-caption text-[var(--ink-muted)]">Local device key</h3>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 space-y-4">
                    <div className="flex items-start gap-3">
                      <Key size={16} strokeWidth={1.5} className="text-[var(--ink)] mt-0.5 shrink-0" />
                      <div className="min-w-0 space-y-1">
                        <span className="type-body-medium text-[var(--ink)] block">
                          ECDSA P-256 identity
                        </span>
                        <p className="type-ui text-[var(--ink-muted)]">
                          Generated locally in Chrome storage. Private keys never leave your browser.
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] flex items-center justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <span className="type-caption text-[var(--ink-muted)] block">Key fingerprint</span>
                        <span className="type-mono text-[var(--ink)] block truncate select-all">
                          {keyFingerprint ? `#${keyFingerprint}` : 'Loading key…'}
                        </span>
                      </div>
                      {keyFingerprint && (
                        <button
                          type="button"
                          onClick={() => void handleCopyText('key', `#${keyFingerprint}`)}
                          className="h-8 px-3 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-caption inline-flex items-center gap-2 shrink-0 cursor-pointer studio-focus"
                        >
                          {copiedTarget === 'key' ? (
                            <Check size={16} strokeWidth={1.5} />
                          ) : (
                            <Copy size={16} strokeWidth={1.5} />
                          )}
                          <span>{copiedTarget === 'key' ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                    </div>

                    {onOpenVerify && (
                      <div className="pt-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
                        <span className="type-ui text-[var(--ink-muted)]">
                          Inspect or verify any signed screenshot locally.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onSave(form);
                            onOpenVerify();
                          }}
                          className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium shrink-0 cursor-pointer studio-focus"
                        >
                          Open Proof Vault
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}

          {/* TAB 4: SHORTCUTS */}
          {activeTab === 'shortcuts' && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--border)]">
                <h2 className="type-display-s text-[var(--ink)]">Shortcuts &amp; OCR</h2>
                <span className="type-mono text-[var(--ink-muted)]">{shortcutsSummary}</span>
              </div>

              <div className={gridClass}>
                {/* Keyboard Shortcuts */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Keyboard size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                    <h3 className="type-caption text-[var(--ink-muted)]">Keyboard shortcuts</h3>
                  </div>

                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
                    {SHORTCUT_ROWS.map((row) => (
                      <div key={row.key} className="px-4 py-3 flex items-center justify-between gap-2">
                        <span className="type-ui text-[var(--ink)]">{row.label}</span>
                        <kbd className="px-2 py-0.5 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-keycap text-[var(--ink-muted)] shrink-0">
                          {row.key}
                        </kbd>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
                    <span className="type-mono text-[var(--ink-muted)] truncate">
                      {CHROME_SHORTCUTS_URL}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyText('shortcuts', CHROME_SHORTCUTS_URL)}
                      className="h-8 px-3 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center gap-2 shrink-0 cursor-pointer studio-focus"
                    >
                      {copiedTarget === 'shortcuts' ? (
                        <Check size={16} strokeWidth={1.5} />
                      ) : (
                        <Copy size={16} strokeWidth={1.5} />
                      )}
                      <span>{copiedTarget === 'shortcuts' ? 'Copied' : 'Copy URL'}</span>
                    </button>
                  </div>
                </section>

                {/* Offline OCR Info */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ScanText size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                    <h3 className="type-caption text-[var(--ink-muted)]">Offline OCR engine</h3>
                  </div>

                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
                    <div className="p-4">
                      <p className="type-ui text-[var(--ink-muted)]">
                        Runs locally using bundled Tesseract WASM and Chromium Shape Detection. Images never leave your device.
                      </p>
                    </div>
                    <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="type-caption text-[var(--ink-muted)]">Runtime</span>
                      <span className="type-mono text-[var(--ink)]">Tesseract WASM · Shape Detection</span>
                    </div>
                    <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="type-caption text-[var(--ink-muted)]">Processing</span>
                      <span className="type-mono text-[var(--ink)]">100% local · Zero uploads</span>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
