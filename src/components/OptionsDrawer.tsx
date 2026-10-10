import React, { useState, useId } from 'react';
import {
  ChevronLeft,
  Save,
  Check,
  RotateCcw,
  Sparkles,
  Sliders,
  Keyboard,
  FileCode,
  Zap,
  ScanText,
} from 'lucide-react';
import { CaptureSettings, CaptureFormat } from '../types';
import { DEFAULT_SETTINGS } from '../utils/storage';
import { formatFilename } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onSave: (newSettings: CaptureSettings) => void;
}

const AVAILABLE_TOKENS = [
  { token: '{title}', label: 'Page Title' },
  { token: '{date}', label: 'YYYY-MM-DD' },
  { token: '{time}', label: 'HHMMSS' },
  { token: '{domain}', label: 'Domain Host' },
  { token: '{type}', label: 'Capture Type' },
  { token: '{width}', label: 'Pixel Width' },
  { token: '{height}', label: 'Pixel Height' },
];

const DELAY_OPTIONS = [0, 3, 5, 10];

export const OptionsDrawer: React.FC<Props> = React.memo(({ settings, onBack, onSave }) => {
  const [form, setForm] = useState<CaptureSettings>({ ...settings });
  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const autoDownloadId = useId();
  const hideStickyId = useId();
  const clipboardId = useId();

  const handleSave = () => {
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleReset = () => {
    setForm({ ...DEFAULT_SETTINGS });
    onSave({ ...DEFAULT_SETTINGS });
    setResetConfirm(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const insertToken = (token: string) => {
    if (form.filenameTemplate.includes(token)) return;
    const separator = form.filenameTemplate.endsWith('_') || form.filenameTemplate.length === 0 ? '' : '_';
    setForm({
      ...form,
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

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xs">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition cursor-pointer px-1 py-1 rounded hover:bg-zinc-100"
        >
          <ChevronLeft size={16} />
          <span>Back to Menu</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setResetConfirm(true)}
            className="p-1.5 text-zinc-500 hover:text-zinc-800 rounded-md hover:bg-zinc-100 transition cursor-pointer"
            title="Reset options to defaults"
          >
            <RotateCcw size={14} />
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer active:scale-95"
          >
            {saved ? <Check size={13} className="text-white" /> : <Save size={13} />}
            <span>{saved ? 'Saved!' : 'Save'}</span>
          </button>
        </div>
      </div>

      {/* Reset Confirmation Banner */}
      {resetConfirm && (
        <div className="p-3 m-3 bg-amber-50/90 border border-amber-200 rounded-xl shadow-xs animate-in fade-in duration-200">
          <p className="text-xs font-medium text-amber-900">
            Reset all settings to default configuration?
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleReset}
              className="px-2.5 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition cursor-pointer"
            >
              Reset
            </button>
            <button
              onClick={() => setResetConfirm(false)}
              className="px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 bg-white rounded-md border border-zinc-200 transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Options Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* Section 1: Output Format */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
              01 // Output Format & Quality
            </label>
            <span className="text-[10px] font-mono text-zinc-600 uppercase">
              {form.format} • {form.format === 'png' ? 'Lossless' : `${Math.round(form.quality * 100)}%`}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-1 bg-zinc-100 rounded-xl border border-zinc-200/80">
            {(['png', 'jpeg', 'webp'] as CaptureFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setForm({ ...form, format: fmt })}
                className={`py-1.5 px-2 text-center rounded-lg font-semibold uppercase text-xs transition cursor-pointer ${
                  form.format === fmt
                    ? 'bg-white text-blue-600 shadow-xs border border-zinc-200/60 font-bold'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          {form.format !== 'png' && (
            <div className="bg-white p-3 rounded-xl border border-zinc-200/80 space-y-2 shadow-2xs">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-zinc-700">Image Compression Level</span>
                <span className="font-mono font-bold text-blue-600 tabular-nums">
                  {Math.round(form.quality * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.4"
                max="1.0"
                step="0.05"
                value={form.quality}
                onChange={(e) => setForm({ ...form, quality: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-[10px] text-zinc-600">
                Balances image fidelity against storage and file transfer footprint.
              </p>
            </div>
          )}
        </div>

        {/* Section 2: Behavior & Automation */}
        <div className="space-y-2.5 pt-3 border-t border-zinc-200/80">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
            02 // Automation & Workflow
          </label>

          <div className="bg-white rounded-xl border border-zinc-200/80 divide-y divide-zinc-100 shadow-2xs overflow-hidden">
            {/* Auto Download */}
            <label htmlFor={autoDownloadId} className="flex items-start gap-3 p-3 hover:bg-zinc-50/70 transition cursor-pointer">
              <input
                id={autoDownloadId}
                type="checkbox"
                checked={form.autoDownload}
                onChange={(e) => setForm({ ...form, autoDownload: e.target.checked })}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-zinc-900 block leading-tight">
                  Auto-Save to Downloads
                </span>
                <span className="text-[11px] text-zinc-600 block mt-0.5 leading-snug">
                  Automatically downloads each finished capture to your local drive.
                </span>
              </div>
            </label>

            {/* Hide Sticky Elements */}
            <label htmlFor={hideStickyId} className="flex items-start gap-3 p-3 hover:bg-zinc-50/70 transition cursor-pointer">
              <input
                id={hideStickyId}
                type="checkbox"
                checked={form.hideStickyElements}
                onChange={(e) => setForm({ ...form, hideStickyElements: e.target.checked })}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-zinc-900 block leading-tight">
                  Suppress Sticky & Fixed Elements
                </span>
                <span className="text-[11px] text-zinc-600 block mt-0.5 leading-snug">
                  Prevents floating navbars or headers from duplicating across scrolling stitches.
                </span>
              </div>
            </label>

            {/* Auto Copy to Clipboard */}
            <label htmlFor={clipboardId} className="flex items-start gap-3 p-3 hover:bg-zinc-50/70 transition cursor-pointer">
              <input
                id={clipboardId}
                type="checkbox"
                checked={form.copyToClipboard}
                onChange={(e) => setForm({ ...form, copyToClipboard: e.target.checked })}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-zinc-900 block leading-tight">
                  Copy to Clipboard on Capture
                </span>
                <span className="text-[11px] text-zinc-600 block mt-0.5 leading-snug">
                  Places new viewport captures directly onto system clipboard ready to paste.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Section 3: Scrolling Speed */}
        <div className="space-y-2.5 pt-3 border-t border-zinc-200/80">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
            03 // Scroll & Stitch Latency
          </label>

          <div className="bg-white p-3 rounded-xl border border-zinc-200/80 space-y-2 shadow-2xs">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-zinc-700">Scroll Step Delay</span>
              <span className="font-mono font-bold text-blue-600 tabular-nums">
                {form.scrollDelayMs} ms
              </span>
            </div>
            <input
              type="range"
              min="200"
              max="1600"
              step="100"
              value={form.scrollDelayMs}
              onChange={(e) => setForm({ ...form, scrollDelayMs: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
              <span>Fast (200ms)</span>
              <span>Default (600ms)</span>
              <span>Heavy Feeds (1600ms)</span>
            </div>
          </div>

          {/* P1-6 Delayed Capture Timer */}
          <div className="bg-white p-3 rounded-xl border border-zinc-200/80 space-y-2 shadow-2xs">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-zinc-700">Capture Delay Timer</span>
              <span className="font-mono font-bold text-orange-600 tabular-nums">
                {form.captureDelaySec ? `${form.captureDelaySec} s` : 'Off'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-zinc-100 rounded-xl border border-zinc-200/80">
              {DELAY_OPTIONS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setForm({ ...form, captureDelaySec: sec })}
                  className={`py-1 text-center rounded-lg font-semibold text-xs transition cursor-pointer ${
                    (form.captureDelaySec || 0) === sec
                      ? 'bg-white text-orange-600 shadow-xs border border-zinc-200/60'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  {sec === 0 ? 'Off' : `${sec}s`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600">
              Counts down on the toolbar icon before Visible and Full Page captures. Use it to open menus or hover states first.
            </p>
          </div>
        </div>

        {/* Section 4: Filename Pattern & Token Builder */}
        <div className="space-y-2.5 pt-3 border-t border-zinc-200/80">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
            04 // Smart Filename Pattern
          </label>

          <input
            type="text"
            value={form.filenameTemplate}
            onChange={(e) => setForm({ ...form, filenameTemplate: e.target.value })}
            placeholder="{title}_{date}_{time}"
            className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-zinc-900 shadow-2xs"
          />

          {/* Clickable Token Pills */}
          <div className="space-y-1">
            <span className="text-[10px] text-zinc-600 font-medium">Click to insert token:</span>
            <div className="flex flex-wrap gap-1">
              {AVAILABLE_TOKENS.map(({ token }) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="px-2 py-0.5 rounded-md bg-zinc-100 hover:bg-blue-50 hover:text-blue-700 text-zinc-700 font-mono text-[10px] transition cursor-pointer border border-zinc-200/60"
                >
                  {token}
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="p-2.5 bg-blue-50/70 border border-blue-200/70 rounded-lg space-y-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-900 block">
              Sample File Output:
            </span>
            <p className="text-[11px] font-mono text-blue-700 truncate select-all">
              {sampleFilename}
            </p>
          </div>
        </div>

        {/* Section 5: Offline OCR & Local AI */}
        <div className="space-y-2.5 pt-3 border-t border-zinc-200/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ScanText size={13} className="text-zinc-600" />
              <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
                05 // Text Extraction (OCR) & Local AI
              </label>
            </div>
            <span className="text-[9.5px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/70 px-1.5 py-0.5 rounded">
              100% Offline
            </span>
          </div>

          <div className="bg-white border border-zinc-200/80 rounded-xl p-3 space-y-2 shadow-2xs text-xs">
            <p className="text-zinc-700 leading-relaxed text-[11.5px]">
              Yoink uses Chromium native <b>Shape Detection API</b> (<code className="bg-zinc-100 px-1 py-0.5 rounded text-[10px] font-mono">window.TextDetector</code>) and Chrome Prompt API (<code className="bg-zinc-100 px-1 py-0.5 rounded text-[10px] font-mono">Gemini Nano</code>) for instant on-device text recognition.
            </p>
            <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200/60 text-[11px] text-zinc-600 space-y-1">
              <div className="font-semibold text-zinc-800">How to use OCR:</div>
              <div>1. Open any capture in <b>Gallery & History</b> or the <b>Preview Modal</b>.</div>
              <div>2. Click the <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">OCR</span> button on the card or toolbar.</div>
              <div>3. Inspect, edit, and copy extracted text to your clipboard.</div>
            </div>
          </div>
        </div>

        {/* Section 6: Keyboard Shortcuts Reference */}
        <div className="space-y-2.5 pt-3 border-t border-zinc-200/80">
          <div className="flex items-center gap-1.5">
            <Keyboard size={13} className="text-zinc-600" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              06 // Active Keyboard Shortcuts
            </span>
          </div>

          <div className="bg-white border border-zinc-200/80 rounded-xl p-3 space-y-2 font-mono text-[11px] shadow-2xs">
            <div className="flex justify-between items-center">
              <span className="text-zinc-700 font-sans text-xs">Capture Entire Page</span>
              <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-zinc-800 text-[10px]">
                Alt + Shift + 1
              </kbd>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-700 font-sans text-xs">Capture Visible Viewport</span>
              <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-zinc-800 text-[10px]">
                Alt + Shift + 3
              </kbd>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-700 font-sans text-xs">Capture Selection Area</span>
              <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-zinc-800 text-[10px]">
                Alt + Shift + 4
              </kbd>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">
            Configure custom shortcut bindings anytime in Chrome at <code className="bg-zinc-100 px-1 py-0.5 rounded text-zinc-800 font-mono">chrome://extensions/shortcuts</code>.
          </p>
        </div>
      </div>
    </div>
  );
});
