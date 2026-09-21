import React, { useState, useMemo } from 'react';
import { ChevronLeft, Save, Sliders, Keyboard, Check, AlertTriangle } from 'lucide-react';
import { CaptureSettings, CaptureFormat } from '../types';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onSave: (newSettings: CaptureSettings) => void;
}

export const OptionsDrawer: React.FC<Props> = React.memo(({ settings, onBack, onSave }) => {
  const [form, setForm] = useState<CaptureSettings>({ ...settings });
  const [saved, setSaved] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);

  /**
   * isDirty: true when the user has made unsaved changes.
   * JSON comparison is safe here — CaptureSettings contains only primitives.
   */
  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(settings),
    [form, settings]
  );

  const handleSave = () => {
    onSave(form);
    setSaved(true);
    setConfirmBack(false);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleBack = () => {
    if (isDirty && !confirmBack) {
      // First click: warn the user
      setConfirmBack(true);
      return;
    }
    // Second click (confirmed) or no dirty state: navigate away
    onBack();
  };

  return (
    <div className="flex flex-col h-full bg-[#fdfdfd] text-[#1a1a1a]">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 border-b border-zinc-200 bg-white">
        <button
          onClick={handleBack}
          className={`flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
            confirmBack
              ? 'text-amber-600 hover:text-amber-700'
              : 'text-zinc-700 hover:text-zinc-950'
          }`}
        >
          <ChevronLeft size={16} />
          <span>{confirmBack ? 'Discard changes?' : 'Back to Menu'}</span>
        </button>

        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
        >
          {saved ? <Check size={14} className="text-white" /> : <Save size={14} />}
          <span>{saved ? 'Saved!' : 'Save Options'}</span>
        </button>
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="mx-3.5 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-800">
          <AlertTriangle size={13} className="shrink-0 text-amber-500" />
          <span className="font-medium">
            {confirmBack
              ? 'Click "Discard changes?" again to leave without saving, or click "Save Options".'
              : 'You have unsaved changes.'}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* Section: Image Format & Quality */}
        <div className="space-y-3">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
            01 // Output Format & Compression
          </label>

          <div className="grid grid-cols-3 gap-2">
            {(['png', 'jpeg', 'webp'] as CaptureFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setForm({ ...form, format: fmt })}
                className={`py-2 px-3 text-center rounded-md font-medium uppercase text-xs border transition cursor-pointer ${
                  form.format === fmt
                    ? 'bg-blue-50 border-blue-600 text-blue-700 font-bold'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          {form.format !== 'png' && (
            <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-zinc-700">Image Quality</span>
                <span className="font-mono font-bold text-blue-600">{Math.round(form.quality * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.05"
                value={form.quality}
                onChange={(e) => setForm({ ...form, quality: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-[10px] text-zinc-500">Higher quality produces clearer images but larger files.</p>
            </div>
          )}
        </div>

        {/* Section: Behavior & Automation */}
        <div className="space-y-3 pt-3 border-t border-zinc-200">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
            02 // Capture Behavior
          </label>

          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoDownload}
                onChange={(e) => setForm({ ...form, autoDownload: e.target.checked })}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div>
                <span className="font-medium text-zinc-900 block">Auto-Download Files</span>
                <span className="text-[11px] text-zinc-500 block">
                  Automatically save screenshots to your default Downloads folder.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.hideStickyElements}
                onChange={(e) => setForm({ ...form, hideStickyElements: e.target.checked })}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div>
                <span className="font-medium text-zinc-900 block">Hide Fixed / Sticky Elements</span>
                <span className="text-[11px] text-zinc-500 block">
                  Prevents floating navbars or headers from duplicating during full-page stitching.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Section: Full Page Scrolling */}
        <div className="space-y-3 pt-3 border-t border-zinc-200">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
            03 // Scroll & Stitch Timing
          </label>

          <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-zinc-700">Scroll Delay (ms)</span>
              <span className="font-mono font-bold text-blue-600">{form.scrollDelayMs}ms</span>
            </div>
            <input
              type="range"
              min="200"
              max="2000"
              step="100"
              value={form.scrollDelayMs}
              onChange={(e) => setForm({ ...form, scrollDelayMs: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <p className="text-[10px] text-zinc-500">
              Increase delay if page contains heavy lazy-loaded images or infinite feeds.
            </p>
          </div>
        </div>

        {/* Section: Filename Template */}
        <div className="space-y-2 pt-3 border-t border-zinc-200">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
            04 // Filename Pattern
          </label>
          <input
            type="text"
            value={form.filenameTemplate}
            onChange={(e) => setForm({ ...form, filenameTemplate: e.target.value })}
            placeholder="{title}_{date}_{time}"
            className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-[10px] text-zinc-500">
            Available tokens: <code className="bg-zinc-100 px-1 py-0.5 rounded">{'{title}'}</code>,{' '}
            <code className="bg-zinc-100 px-1 py-0.5 rounded">{'{date}'}</code>,{' '}
            <code className="bg-zinc-100 px-1 py-0.5 rounded">{'{time}'}</code>,{' '}
            <code className="bg-zinc-100 px-1 py-0.5 rounded">{'{domain}'}</code>,{' '}
            <code className="bg-zinc-100 px-1 py-0.5 rounded">{'{type}'}</code>
          </p>
        </div>

        {/* Section: Keyboard Shortcuts Reference */}
        <div className="space-y-2 pt-3 border-t border-zinc-200">
          <div className="flex items-center gap-1.5">
            <Keyboard size={14} className="text-zinc-600" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Keyboard Shortcuts
            </span>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-2.5 space-y-2 font-mono text-[11px]">
            <div className="flex justify-between items-center">
              <span className="text-zinc-700 font-sans">Capture Entire Page</span>
              <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800">
                Alt + Shift + 1
              </kbd>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-700 font-sans">Capture Visible Part</span>
              <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800">
                Alt + Shift + 3
              </kbd>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-700 font-sans">Capture Selection</span>
              <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800">
                Alt + Shift + 4
              </kbd>
            </div>
          </div>
          <p className="text-[10px] text-zinc-400">
            You can customize these shortcuts in Chrome under <code>chrome://extensions/shortcuts</code>.
          </p>
        </div>
      </div>
    </div>
  );
});
