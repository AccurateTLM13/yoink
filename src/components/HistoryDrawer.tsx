import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  Trash2,
  Download,
  Copy,
  Check,
  Eye,
  Clock,
  Image as ImageIcon,
  Search,
  Layers,
  X,
} from 'lucide-react';
import { HistoryItem } from '../types';
import { copyImageToClipboard, downloadDataUrl } from '../utils/storage';

interface Props {
  history: HistoryItem[];
  onBack: () => void;
  onSelectPreview: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void;
  onClearAll: () => void;
  recentBatchBanner?: number | null;
  onDismissBatchBanner?: () => void;
  isFullTab?: boolean;
}

export const HistoryDrawer: React.FC<Props> = React.memo(({
  history,
  onBack,
  onSelectPreview,
  onDeleteItem,
  onClearAll,
  recentBatchBanner,
  onDismissBatchBanner,
  isFullTab,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'alltabs' | 'full' | 'visible' | 'selection'>('all');

  const filtered = useMemo(() => {
    let list = history;

    if (activeFilter !== 'all') {
      list = list.filter((item) => item.mode === activeFilter);
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(s) ||
          (item.url && item.url.toLowerCase().includes(s)) ||
          item.mode.toLowerCase().includes(s)
      );
    }

    return list;
  }, [history, search, activeFilter]);

  const handleCopy = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    if (!item.dataUrl) return;
    const success = await copyImageToClipboard(item.dataUrl);
    if (success) {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const handleDownload = (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    if (!item.dataUrl) return;
    const ext = item.format || 'png';
    const filename = `${item.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}_${Date.now()}.${ext}`;
    downloadDataUrl(item.dataUrl, filename);
  };

  const handleDownloadAll = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const itemsToDownload = filtered.length > 0 ? filtered : history;
    itemsToDownload.forEach((item, idx) => {
      if (!item.dataUrl) return;
      const ext = item.format || 'png';
      const filename = `${item.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}_${item.id.slice(-4)}.${ext}`;
      setTimeout(() => {
        downloadDataUrl(item.dataUrl, filename);
      }, idx * 150);
    });
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDeleteItem(id);
  };

  return (
    <div className="flex flex-col h-full bg-[#fdfdfd] text-[#1a1a1a]">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 border-b border-zinc-200 bg-white">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition cursor-pointer"
        >
          <ChevronLeft size={16} />
          <span>Back to Menu</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-500 font-mono">
            {history.length} {history.length === 1 ? 'item' : 'items'}
          </span>
          {history.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-[11px] font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition cursor-pointer"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Recent Batch Success Banner */}
      {recentBatchBanner && recentBatchBanner > 0 && (
        <div className="m-3 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Layers size={16} />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-blue-900 truncate">
                {recentBatchBanner} Tabs Captured!
              </h4>
              <p className="text-[10px] text-blue-700 truncate">
                Saved to your gallery. Ready to view or export.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={handleDownloadAll}
              className="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <Download size={12} />
              <span>Save All</span>
            </button>
            {onDismissBatchBanner && (
              <button
                onClick={onDismissBatchBanner}
                className="p-1 text-blue-400 hover:text-blue-700 rounded transition cursor-pointer"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      {history.length > 0 && (
        <div className="px-3.5 py-2 bg-zinc-50 border-b border-zinc-200 space-y-2">
          {/* Search */}
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-2.5 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search history by title, url, or type..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer ${
                activeFilter === 'all'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              All ({history.length})
            </button>
            <button
              onClick={() => setActiveFilter('alltabs')}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer ${
                activeFilter === 'alltabs'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Tabs ({history.filter((h) => h.mode === 'alltabs').length})
            </button>
            <button
              onClick={() => setActiveFilter('full')}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer ${
                activeFilter === 'full'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Full Page
            </button>
            <button
              onClick={() => setActiveFilter('selection')}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer ${
                activeFilter === 'selection'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Selection
            </button>
          </div>
        </div>
      )}

      {/* History Items List */}
      <div className="flex-1 overflow-y-auto p-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center p-4">
            <ImageIcon size={32} className="text-zinc-300 mb-2" />
            <p className="text-sm font-semibold text-zinc-700">No Captures Yet</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-[220px]">
              Take your first screenshot using the capture menu to see your history here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-xs text-zinc-500">No matching captures found.</div>
        ) : (
          <div className={isFullTab ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5' : 'space-y-2.5'}>
            {filtered.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectPreview(item)}
                className="group relative flex flex-col bg-white border border-zinc-200 hover:border-blue-400 rounded-xl p-2.5 shadow-sm transition hover:shadow cursor-pointer"
              >
                {isFullTab && (
                  <div className="w-full h-36 rounded-lg bg-zinc-100 border border-zinc-200 overflow-hidden mb-2 flex items-center justify-center">
                    {item.dataUrl ? (
                      <img src={item.dataUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-200" />
                    ) : (
                      <ImageIcon size={24} className="text-zinc-400" />
                    )}
                  </div>
                )}

                <div className="flex items-start gap-2.5">
                  {!isFullTab && (
                    <div className="w-16 h-16 rounded-lg bg-zinc-100 border border-zinc-200 overflow-hidden flex items-center justify-center shrink-0">
                      {item.dataUrl ? (
                        <img src={item.dataUrl} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon size={20} className="text-zinc-400" />
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                        {item.mode}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-zinc-900 truncate leading-tight mb-1">{item.title}</h4>
                  <p className="text-[10px] text-zinc-400 truncate font-mono">
                    {item.width > 0 ? `${item.width} × ${item.height}px • ` : ''}
                    {item.format.toUpperCase()}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-zinc-100">
                <button
                  onClick={(e) => handleCopy(e, item)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:text-blue-600 bg-zinc-50 hover:bg-blue-50 rounded-lg border border-zinc-200 hover:border-blue-200 transition cursor-pointer"
                  title="Copy to clipboard"
                >
                  {copiedId === item.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  onClick={(e) => handleDownload(e, item)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:text-blue-600 bg-zinc-50 hover:bg-blue-50 rounded-lg border border-zinc-200 hover:border-blue-200 transition cursor-pointer"
                  title="Download image"
                >
                  <Download size={12} />
                  <span>Download</span>
                </button>

                <button
                  onClick={(e) => handleDelete(e, item.id)}
                  className="p-1 text-zinc-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition cursor-pointer ml-1"
                  title="Delete from history"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
