import React, { useState } from 'react';
import { ChevronLeft, Play, Smartphone, Tablet, Monitor, Loader2, CheckCircle2 } from 'lucide-react';
import { CaptureSettings, HistoryItem, ResolutionConfig } from '../types';
import { captureMultiSize } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onBack: () => void;
  onFinished: (results: HistoryItem[]) => void;
  onPreview: (item: HistoryItem) => void;
}

const PRESET_RESOLUTIONS: ResolutionConfig[] = [
  { name: 'Mobile (iPhone 14)', width: 390, height: 844 },
  { name: 'Tablet (iPad Air)', width: 820, height: 1180 },
  { name: 'Desktop (Full HD)', width: 1440, height: 900 },
  { name: '4K Display', width: 1920, height: 1080 },
];

export const MultiSizeModal: React.FC<Props> = React.memo(({ settings, onBack, onFinished, onPreview }) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0, 1, 2]);
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [completedItems, setCompletedItems] = useState<HistoryItem[]>([]);

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

  const handleStart = async () => {
    const targets = selectedIndices.map((i) => PRESET_RESOLUTIONS[i]);
    if (targets.length === 0) return;

    setIsRunning(true);
    setProgressMsg('Starting responsive captures...');
    setCompletedItems([]);

    try {
      const results = await captureMultiSize(targets, settings, (curr, total, name) => {
        setProgressMsg(`Capturing ${curr} of ${total}: ${name}`);
      });
      setCompletedItems(results);
      onFinished(results);
      setProgressMsg(`Finished capturing ${results.length} device resolutions!`);
    } catch (err: any) {
      setProgressMsg(`Error: ${err.message || 'Capture failed'}`);
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
          Multi-Device Capture
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        <p className="text-zinc-600 leading-relaxed">
          Capture the active page across multiple viewport resolutions simultaneously in one click.
        </p>

        {/* Device Selection Cards */}
        <div className="space-y-2">
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
            Select Viewports to Capture
          </label>
          <div className="space-y-2">
            {PRESET_RESOLUTIONS.map((res, idx) => {
              const isChecked = selectedIndices.includes(idx);
              return (
                <div
                  key={res.name}
                  onClick={() => toggleSelect(idx)}
                  className={`flex items-center justify-between p-3 rounded-lg border transition cursor-pointer ${
                    isChecked
                      ? 'bg-blue-50/70 border-blue-500 text-blue-950'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={isChecked ? 'text-blue-600' : 'text-zinc-400'}>
                      {idx === 0 ? <Smartphone size={18} /> : idx === 1 ? <Tablet size={18} /> : <Monitor size={18} />}
                    </div>
                    <div>
                      <h4 className="font-semibold text-xs leading-tight">{res.name}</h4>
                      <p className="text-[11px] font-mono text-zinc-500">
                        {res.width} × {res.height} px
                      </p>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    disabled={isRunning}
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Progress Display */}
        {progressMsg && (
          <div
            className={`p-3 rounded-lg border flex items-center gap-2 text-xs ${
              isRunning
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {isRunning ? (
              <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />
            ) : (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            )}
            <span className="font-semibold">{progressMsg}</span>
          </div>
        )}

        {/* Completed Previews */}
        {completedItems.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-zinc-200">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
              Captured Devices ({completedItems.length})
            </label>
            <div className="grid grid-cols-2 gap-2">
              {completedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onPreview(item)}
                  className="group relative bg-white border border-zinc-200 hover:border-blue-500 rounded p-1.5 cursor-pointer shadow-sm"
                >
                  <img src={item.dataUrl} alt={item.title} className="w-full h-16 object-cover rounded bg-zinc-100" />
                  <p className="text-[10px] text-zinc-700 truncate mt-1 font-medium font-mono">
                    {item.width} × {item.height} px
                  </p>
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
          disabled={isRunning || selectedIndices.length === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-xs transition cursor-pointer shadow-sm disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Resizing & Capturing...</span>
            </>
          ) : (
            <>
              <Play size={15} fill="currentColor" />
              <span>Capture Selected Resolutions ({selectedIndices.length})</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});
