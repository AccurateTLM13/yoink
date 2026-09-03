import React, { useState } from 'react';
import {
  FileText,
  File,
  Crop,
  Layers,
  Globe,
  History,
  Settings,
  Smartphone,
  ChevronRight,
  Loader2,
} from 'lucide-react';

interface Props {
  onCaptureFullPage: () => void;
  onCaptureVisible: () => void;
  onCaptureSelection: () => void;
  onCaptureAllTabs: () => void;
  onOpenUrlBatch: () => void;
  onOpenMultiSize: () => void;
  onOpenHistory: () => void;
  onOpenOptions: () => void;
  historyCount: number;
  isCapturing: boolean;
  activeAction: string | null;
}

export const QuickMenu: React.FC<Props> = React.memo(({
  onCaptureFullPage,
  onCaptureVisible,
  onCaptureSelection,
  onCaptureAllTabs,
  onOpenUrlBatch,
  onOpenMultiSize,
  onOpenHistory,
  onOpenOptions,
  historyCount,
  isCapturing,
  activeAction,
}) => {
  const [selectedKey, setSelectedKey] = useState<string>('selection');

  return (
    <div className="flex flex-col h-full bg-white text-zinc-900 select-none font-sans">
      {/* Centered Top Brand Logo */}
      <div className="pt-4 pb-3 px-4 flex items-center justify-center gap-2.5">
        <img
          src="/yoink-symbol.png"
          alt="Yoink"
          className="h-8 w-8 object-contain"
        />
        <img
          src="/yoink-text.png"
          alt="Yoink"
          className="h-7 w-auto object-contain"
        />
      </div>

      <div className="border-b border-zinc-150" />

      {/* Main Body */}
      <div className="flex-1 px-4 py-3 flex flex-col justify-between space-y-2.5 overflow-hidden">
        {/* Card 1: Capture Actions */}
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-1 space-y-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          {/* Item 1: Capture entire page */}
          <button
            onClick={onCaptureFullPage}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('fullpage')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'fullpage'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <FileText size={18} className="text-blue-600 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'fullpage' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                Capture entire page
              </span>
            </div>
            <span className={`text-xs ${selectedKey === 'fullpage' ? 'font-medium text-blue-600' : 'text-zinc-400'}`}>
              Alt+Shift+1
            </span>
          </button>

          {/* Item 2: Capture visible part */}
          <button
            onClick={onCaptureVisible}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('visible')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'visible'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <File size={18} className="text-blue-600 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'visible' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                Capture visible part
              </span>
            </div>
            <span className={`text-xs ${selectedKey === 'visible' ? 'font-medium text-blue-600' : 'text-zinc-400'}`}>
              Alt+Shift+3
            </span>
          </button>

          {/* Item 3: Capture selection (Active in mock) */}
          <button
            onClick={onCaptureSelection}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('selection')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'selection'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <Crop size={18} className="text-blue-600 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'selection' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                Capture selection
              </span>
            </div>
            <span className={`text-xs ${selectedKey === 'selection' ? 'font-medium text-blue-600' : 'text-zinc-400'}`}>
              Alt+Shift+4
            </span>
          </button>

          {/* Item 4: Capture all tabs */}
          <button
            onClick={onCaptureAllTabs}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('alltabs')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'alltabs'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <Layers size={18} className="text-blue-600 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'alltabs' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                Capture all tabs
              </span>
            </div>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-100/90 px-2.5 py-0.5 rounded-full tracking-wide">
              BATCH
            </span>
          </button>

          {/* Item 5: Capture list of URLs ... */}
          <button
            onClick={onOpenUrlBatch}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('urllist')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'urllist'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <Globe size={18} className="text-blue-600 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'urllist' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                Capture list of URLs ...
              </span>
            </div>
            <ChevronRight size={16} className="text-zinc-700 shrink-0" />
          </button>
        </div>

        {/* Card 2: Utilities (History & Options) */}
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-1 space-y-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          {/* History */}
          <button
            onClick={onOpenHistory}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('history')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'history'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <History size={18} className="text-zinc-700 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'history' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                History ...
              </span>
            </div>
            <span className="text-xs font-semibold text-zinc-600 bg-zinc-100 px-2.5 py-0.5 rounded-full min-w-[20px] text-center">
              {historyCount > 0 ? historyCount : 9}
            </span>
          </button>

          {/* Options */}
          <button
            onClick={onOpenOptions}
            disabled={isCapturing}
            onMouseEnter={() => setSelectedKey('options')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
              selectedKey === 'options'
                ? 'border border-[#3b82f6] bg-[#eff6ff] text-blue-600'
                : 'border border-transparent hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <div className="flex items-center space-x-3">
              <Settings size={18} className="text-zinc-700 shrink-0" />
              <span className={`text-[13px] ${selectedKey === 'options' ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                Options ...
              </span>
            </div>
            <ChevronRight size={16} className="text-zinc-700 shrink-0" />
          </button>
        </div>

        {/* Card 3: Multi-Device Capture */}
        <button
          onClick={onOpenMultiSize}
          disabled={isCapturing}
          onMouseEnter={() => setSelectedKey('multisize')}
          className="w-full rounded-2xl border border-blue-200/80 bg-[#eff6ff]/70 hover:bg-blue-100/60 transition-all p-3 flex items-center justify-between cursor-pointer text-left"
        >
          <div className="flex items-center space-x-3 min-w-0">
            <Smartphone size={18} className="text-blue-600 shrink-0" />
            <span className="text-[13px] font-semibold text-blue-600 truncate whitespace-nowrap">
              Multi-Device Capture ...
            </span>
          </div>
          <span className="text-xs font-semibold text-blue-600 bg-blue-100/90 px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ml-2">
            3 sizes
          </span>
        </button>
      </div>

      {/* Footer Status Bar */}
      <div className="border-t border-zinc-150 px-4 py-2.5 flex items-center justify-between bg-white text-xs">
        <span className="text-[11px] font-bold tracking-widest text-zinc-400 uppercase font-mono">
          STATUS
        </span>
        <div className="flex items-center gap-2">
          {isCapturing && <Loader2 size={12} className="animate-spin text-blue-600" />}
          <span className="text-xs font-medium text-zinc-800">
            {activeAction || (isCapturing ? 'Processing...' : 'Ready')}
          </span>
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isCapturing ? 'bg-amber-400 animate-ping' : 'bg-[#22c55e]'
            }`}
          />
        </div>
      </div>
    </div>
  );
});

