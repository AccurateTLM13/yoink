import React from 'react';
import {
  FileText,
  Monitor,
  Crop,
  Layers,
  Globe,
  History,
  Settings,
  Smartphone,
  ChevronRight,
  Loader2,
  Sparkles,
  ExternalLink,
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
  onOpenStudio?: () => void;
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
  onOpenStudio,
  historyCount,
  isCapturing,
  activeAction,
}) => {
  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-zinc-900 select-none font-sans overflow-hidden">
      {/* Brand Header */}
      <div className="pt-3 pb-2 px-3.5 flex items-center justify-between border-b border-zinc-200/80 bg-white/80 backdrop-blur-xs shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-blue-50/80 border border-blue-200/60 shadow-[0_1px_3px_rgba(37,99,235,0.08)]">
            <img
              src="/yoink-symbol.png"
              alt="Yoink"
              className="h-4.5 w-4.5 object-contain"
            />
          </div>
          <img
            src="/yoink-text.png"
            alt="Yoink"
            className="h-4.5 w-auto object-contain"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenStudio && (
            <button
              onClick={onOpenStudio}
              title="Open full Studio Hub in a browser tab"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold text-zinc-600 hover:text-blue-700 bg-zinc-100 hover:bg-blue-50 border border-zinc-200/80 hover:border-blue-200 transition cursor-pointer"
            >
              <span>Studio</span>
              <ExternalLink size={10} className="text-zinc-500" />
            </button>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-blue-50 text-blue-700 border border-blue-200/60 font-mono">
            <Sparkles size={10} className="text-blue-600" />
            <span>v1.1</span>
          </span>
        </div>
      </div>

      {/* Main Action Body */}
      <div className="flex-1 px-3 py-2 flex flex-col justify-between space-y-1.5 overflow-hidden">
        {/* Card 1: Core Capture Actions */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-600">
              Direct Capture
            </span>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-white p-1 space-y-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
            {/* Capture Entire Page */}
            <button
              onClick={onCaptureFullPage}
              disabled={isCapturing}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-blue-50/60 border border-transparent hover:border-blue-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-6.5 h-6.5 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-150">
                  <FileText size={14} />
                </div>
                <span className="text-[12.5px] font-medium text-zinc-800 group-hover:text-blue-900 truncate">
                  Capture entire page
                </span>
              </div>
              <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono font-medium text-zinc-600 bg-zinc-100 group-hover:bg-blue-100/70 group-hover:text-blue-700 rounded border border-zinc-200/80 group-hover:border-blue-200 transition-colors">
                Alt+Shift+1
              </kbd>
            </button>

            {/* Capture Visible Part */}
            <button
              onClick={onCaptureVisible}
              disabled={isCapturing}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-blue-50/60 border border-transparent hover:border-blue-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-6.5 h-6.5 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-150">
                  <Monitor size={14} />
                </div>
                <span className="text-[12.5px] font-medium text-zinc-800 group-hover:text-blue-900 truncate">
                  Capture visible part
                </span>
              </div>
              <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono font-medium text-zinc-600 bg-zinc-100 group-hover:bg-blue-100/70 group-hover:text-blue-700 rounded border border-zinc-200/80 group-hover:border-blue-200 transition-colors">
                Alt+Shift+3
              </kbd>
            </button>

            {/* Capture Selection */}
            <button
              onClick={onCaptureSelection}
              disabled={isCapturing}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-blue-50/60 border border-transparent hover:border-blue-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-6.5 h-6.5 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-150">
                  <Crop size={14} />
                </div>
                <span className="text-[12.5px] font-medium text-zinc-800 group-hover:text-blue-900 truncate">
                  Capture selection area
                </span>
              </div>
              <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono font-medium text-zinc-600 bg-zinc-100 group-hover:bg-blue-100/70 group-hover:text-blue-700 rounded border border-zinc-200/80 group-hover:border-blue-200 transition-colors">
                Alt+Shift+4
              </kbd>
            </button>
          </div>
        </div>

        {/* Card 2: Batch & Multi-Viewport Actions */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1 mb-0.5">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-600">
              Workflows
            </span>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-white p-1 space-y-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
            {/* Capture All Tabs */}
            <button
              onClick={onCaptureAllTabs}
              disabled={isCapturing}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-zinc-50 border border-transparent hover:border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99] disabled:opacity-50"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-6.5 h-6.5 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-150">
                  <Layers size={14} />
                </div>
                <span className="text-[12.5px] font-medium text-zinc-800 truncate">
                  Capture all open tabs
                </span>
              </div>
              <span className="text-[9.5px] font-bold font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200/70 tracking-wide">
                WINDOW
              </span>
            </button>

            {/* Batch URL list */}
            <button
              onClick={onOpenUrlBatch}
              disabled={isCapturing}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-zinc-50 border border-transparent hover:border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99] disabled:opacity-50"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-6.5 h-6.5 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-150">
                  <Globe size={14} />
                </div>
                <span className="text-[12.5px] font-medium text-zinc-800 truncate">
                  Batch capture URLs ...
                </span>
              </div>
              <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-900 group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Multi-Device Capture */}
            <button
              onClick={onOpenMultiSize}
              disabled={isCapturing}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-zinc-50 border border-transparent hover:border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99] disabled:opacity-50"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-6.5 h-6.5 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:bg-sky-600 group-hover:text-white transition-colors duration-150">
                  <Smartphone size={14} />
                </div>
                <span className="text-[12.5px] font-medium text-zinc-800 truncate">
                  Multi-device viewports ...
                </span>
              </div>
              <span className="text-[9.5px] font-mono font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200/70">
                Responsive
              </span>
            </button>
          </div>
        </div>

        {/* Card 3: Gallery & Settings Navigation */}
        <div className="rounded-xl border border-zinc-200/80 bg-white p-1 space-y-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          {/* History */}
          <button
            onClick={onOpenHistory}
            disabled={isCapturing}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-zinc-50 border border-transparent hover:border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99]"
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="w-6.5 h-6.5 rounded-lg bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0 group-hover:bg-zinc-800 group-hover:text-white transition-colors duration-150">
                <History size={14} />
              </div>
              <span className="text-[12.5px] font-medium text-zinc-800">
                Gallery & History ...
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold font-mono tabular-nums text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200/60 min-w-[20px] text-center">
                {historyCount}
              </span>
              <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-900 group-hover:translate-x-0.5 transition-all" />
            </div>
          </button>

          {/* Options */}
          <button
            onClick={onOpenOptions}
            disabled={isCapturing}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-left group hover:bg-zinc-50 border border-transparent hover:border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.99]"
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="w-6.5 h-6.5 rounded-lg bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0 group-hover:bg-zinc-800 group-hover:text-white transition-colors duration-150">
                <Settings size={14} />
              </div>
              <span className="text-[12.5px] font-medium text-zinc-800">
                Options & Shortcuts ...
              </span>
            </div>
            <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-900 group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div className="border-t border-zinc-200/80 px-3 py-2 flex items-center justify-between bg-white text-xs shrink-0">
        <span className="text-[9.5px] font-bold tracking-widest text-zinc-600 uppercase font-mono">
          ENGINE
        </span>
        <div className="flex items-center gap-2 min-w-0">
          {isCapturing && <Loader2 size={11} className="animate-spin text-blue-600 shrink-0" />}
          <span className="text-[11.5px] font-medium text-zinc-700 truncate max-w-[190px]">
            {activeAction || (isCapturing ? 'Processing capture...' : 'Ready')}
          </span>
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isCapturing
                ? 'bg-amber-400 ring-4 ring-amber-100 animate-pulse'
                : 'bg-emerald-500 ring-4 ring-emerald-50'
            }`}
          />
        </div>
      </div>
    </div>
  );
});
