import React, { useState } from 'react';
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
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react';
import { CaptureSettings, HistoryItem, ResolutionConfig } from '../types';
import { captureMultiSize } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onFinished: (results: HistoryItem[]) => void;
  onPreview: (item: HistoryItem) => void;
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
}) => {
  const [resolutions, setResolutions] = useState<ResolutionConfig[]>(DEFAULT_PRESETS);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0, 1, 2]);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customWidth, setCustomWidth] = useState(375);
  const [customHeight, setCustomHeight] = useState(667);

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

  const handleStart = async () => {
    const targets = selectedIndices.map((i) => resolutions[i]);
    if (targets.length === 0) return;

    setIsRunning(true);
    setProgressMsg('Starting responsive multi-device capture...');
    setCompletedItems([]);

    try {
      const results = await captureMultiSize(targets, settings, (curr, total, name) => {
        setProgressMsg(`Capturing ${curr} of ${total}: ${name}`);
      });
      setCompletedItems(results);
      onFinished(results);
      setProgressMsg(`Finished capturing ${results.length} device viewports!`);
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

        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/60">
          Multi-Device
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        <div className="bg-white p-3 rounded-xl border border-zinc-200/80 shadow-2xs space-y-1">
          <h3 className="font-semibold text-xs text-zinc-900">Responsive Screenshot Suite</h3>
          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Automatically resizes your active browser viewport to simulate mobile, tablet, and desktop viewports in sequence.
          </p>
        </div>

        {/* Viewport Selectors */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              Select Target Devices ({selectedIndices.length})
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAll}
                disabled={isRunning}
                className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 transition cursor-pointer disabled:opacity-50"
              >
                {selectedIndices.length === resolutions.length ? 'Clear All' : 'Select All'}
              </button>
              <button
                onClick={() => setShowCustomForm(!showCustomForm)}
                disabled={isRunning}
                className="flex items-center gap-0.5 text-[10px] font-semibold text-zinc-600 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 px-1.5 py-0.5 rounded transition cursor-pointer"
              >
                <Plus size={11} />
                <span>Custom</span>
              </button>
            </div>
          </div>

          {/* Custom Breakpoint Inline Form */}
          {showCustomForm && (
            <form onSubmit={handleAddCustom} className="p-3 bg-white rounded-xl border border-blue-200/80 shadow-xs space-y-2.5 animate-in fade-in duration-150">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-700 block">
                Add Custom Breakpoint
              </span>
              <div className="space-y-1.5">
                <input
                  type="text"
                  placeholder="Device Name (e.g. Pixel 8)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-md focus:outline-none focus:border-blue-500"
                  required
                />
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono text-zinc-600">W:</span>
                    <input
                      type="number"
                      value={customWidth}
                      onChange={(e) => setCustomWidth(parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1 text-xs border border-zinc-200 rounded-md font-mono"
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
                      className="w-full px-2 py-1 text-xs border border-zinc-200 rounded-md font-mono"
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
                  className="px-2 py-0.5 text-[11px] text-zinc-600 hover:text-zinc-900 rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-0.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded cursor-pointer"
                >
                  Add Viewport
                </button>
              </div>
            </form>
          )}

          {/* Resolutions List */}
          <div className="space-y-1.5">
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
        </div>

        {/* Progress Display */}
        {progressMsg && (
          <div
            className={`p-3 rounded-xl border flex items-center gap-2.5 text-xs shadow-2xs ${
              isRunning
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

        {/* Completed Previews */}
        {completedItems.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-zinc-200/80">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600 block">
              Captured Devices ({completedItems.length})
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
                  <p className="text-[10px] text-zinc-700 truncate mt-1 font-semibold font-mono tabular-nums">
                    {item.width} × {item.height} px
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
          disabled={isRunning || selectedIndices.length === 0}
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
    </div>
  );
});
