import React, { useEffect, useState, useCallback } from 'react';
import {
  FolderOpen,
  HardDrive,
  Download,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
} from 'lucide-react';
import { CaptureSettings, FolderAccessState, SaveLocationMode } from '../types';
import {
  checkSavedDirectoryStatus,
  clearSavedDirectoryHandle,
  pickSaveDirectory,
  reauthorizeSavedDirectory,
  FOLDER_STATUS_KEY,
} from '../utils/saveDestination';
import { isChromeExtension } from '../utils/capture';

interface Props {
  settings: CaptureSettings;
  onUpdateSettings: (patch: Partial<CaptureSettings>) => void;
  isFullTab?: boolean;
  returnView?: 'options' | 'media';
  variant?: 'full' | 'compact';
  highlightPicker?: boolean;
}

export const SaveDestinationControl: React.FC<Props> = ({
  settings,
  onUpdateSettings,
  isFullTab = false,
  returnView = 'options',
  variant = 'full',
  highlightPicker = false,
}) => {
  const mode: SaveLocationMode = settings.saveLocationMode || 'downloads';
  const [statusState, setStatusState] = useState<FolderAccessState>('unset');
  const [folderName, setFolderName] = useState<string>(settings.customSaveFolderName || '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const res = await checkSavedDirectoryStatus();
    setStatusState(res.state);
    if (res.name) {
      setFolderName(res.name);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes[FOLDER_STATUS_KEY]?.newValue) {
          const next = changes[FOLDER_STATUS_KEY].newValue as {
            state?: FolderAccessState;
            folderName?: string;
          };
          if (next.state) setStatusState(next.state);
          if (typeof next.folderName === 'string' && next.folderName) setFolderName(next.folderName);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, [refreshStatus]);

  const openStudioPickerTab = (param: 'pickFolder=1' | 'reauthFolder=1') => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
      chrome.tabs.create({
        url: chrome.runtime.getURL(`index.html?tab=true&view=${returnView}&${param}`),
      });
    }
  };

  const handleChooseFolder = async () => {
    setFeedback(null);
    if (!isFullTab && isChromeExtension()) {
      openStudioPickerTab('pickFolder=1');
      return;
    }

    setBusy(true);
    try {
      const picked = await pickSaveDirectory();
      setFolderName(picked.name);
      setStatusState('ready');
      onUpdateSettings({
        saveLocationMode: 'folder',
        customSaveFolderName: picked.name,
      });
      setFeedback(`Connected to "${picked.name}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not select folder.';
      if (!/abort|cancel/i.test(msg)) {
        setFeedback(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReauthorize = async () => {
    setFeedback(null);
    if (!isFullTab && isChromeExtension()) {
      openStudioPickerTab('reauthFolder=1');
      return;
    }

    setBusy(true);
    try {
      const res = await reauthorizeSavedDirectory();
      setStatusState(res.state);
      if (res.name) setFolderName(res.name);
      if (res.ok) {
        onUpdateSettings({
          saveLocationMode: 'folder',
          customSaveFolderName: res.name || settings.customSaveFolderName,
        });
        setFeedback(`Access granted for "${res.name}".`);
      } else if (res.state === 'not_found') {
        setFeedback(`"${res.name || 'Selected drive'}" could not be found. Reconnect the drive or pick a new folder.`);
      } else if (res.state === 'unset') {
        await handleChooseFolder();
      } else {
        setFeedback('Write access was not granted.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearFolder = async () => {
    await clearSavedDirectoryHandle();
    setFolderName('');
    setStatusState('unset');
    setFeedback(null);
    onUpdateSettings({
      saveLocationMode: 'downloads',
      customSaveFolderName: '',
    });
  };

  const handleSelectMode = (nextMode: SaveLocationMode) => {
    setFeedback(null);
    if (nextMode === 'folder' && statusState === 'unset') {
      void handleChooseFolder();
      return;
    }
    onUpdateSettings({ saveLocationMode: nextMode });
  };

  const displayFolder = folderName || settings.customSaveFolderName || 'No folder selected';

  if (variant === 'compact') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white border border-zinc-200/80 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          {mode === 'folder' ? (
            <HardDrive size={12} className="text-blue-600 shrink-0" />
          ) : mode === 'ask' ? (
            <MessageSquare size={12} className="text-indigo-600 shrink-0" />
          ) : (
            <Download size={12} className="text-zinc-500 shrink-0" />
          )}
          <span className="text-zinc-500 font-medium shrink-0">Save to:</span>
          <span className="font-mono font-semibold text-zinc-800 truncate max-w-[165px]" title={displayFolder}>
            {mode === 'folder'
              ? displayFolder
              : mode === 'ask'
              ? 'Ask Each Time'
              : 'Downloads Folder'}
          </span>

          {mode === 'folder' && statusState === 'ready' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9.5px] font-mono font-semibold shrink-0">
              <CheckCircle2 size={9} /> Ready
            </span>
          )}
          {mode === 'folder' && (statusState === 'needs_permission' || statusState === 'not_found') && (
            <button
              type="button"
              onClick={handleReauthorize}
              disabled={busy}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[9.5px] font-semibold cursor-pointer shrink-0"
            >
              <AlertTriangle size={9} />
              <span>{statusState === 'not_found' ? 'Drive Missing' : 'Grant Access'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <select
            aria-label="Save destination mode"
            value={mode}
            onChange={(e) => handleSelectMode(e.target.value as SaveLocationMode)}
            className="px-1.5 py-0.5 rounded-md bg-zinc-50 border border-zinc-200 text-[10.5px] font-medium text-zinc-700 cursor-pointer focus:outline-none focus:border-blue-500"
          >
            <option value="downloads">Downloads</option>
            <option value="folder">Custom Folder / Drive</option>
            <option value="ask">Ask Every Time</option>
          </select>

          <button
            type="button"
            onClick={handleChooseFolder}
            disabled={busy}
            className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold transition cursor-pointer flex items-center gap-1 ${
              highlightPicker
                ? 'bg-blue-600 text-white ring-2 ring-blue-400 animate-pulse'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80'
            }`}
            title="Select any folder on your computer or an external attached drive"
          >
            <FolderOpen size={11} />
            <span>{mode === 'folder' ? 'Change' : 'Pick Folder'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-3 space-y-2.5 transition ${
        highlightPicker ? 'bg-blue-50/60 ring-2 ring-inset ring-blue-500/40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold text-zinc-900 block leading-tight">
            Save Destination (Local Folder &amp; External Drives)
          </span>
          <span className="text-[11px] text-zinc-600 block mt-0.5 leading-snug">
            Applies to both captured screenshots and yoinked page images/SVGs.
          </span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-100 rounded-xl border border-zinc-200/80">
        <button
          type="button"
          onClick={() => handleSelectMode('downloads')}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
            mode === 'downloads'
              ? 'bg-white text-blue-600 shadow-xs border border-zinc-200/60 font-bold'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
          }`}
        >
          <Download size={11} />
          <span>Downloads</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectMode('folder')}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
            mode === 'folder'
              ? 'bg-white text-blue-600 shadow-xs border border-zinc-200/60 font-bold'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
          }`}
        >
          <HardDrive size={11} />
          <span>Folder / Drive</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectMode('ask')}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
            mode === 'ask'
              ? 'bg-white text-blue-600 shadow-xs border border-zinc-200/60 font-bold'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
          }`}
        >
          <MessageSquare size={11} />
          <span>Ask Each Time</span>
        </button>
      </div>

      {/* Folder / External Drive Details */}
      {mode === 'folder' && (
        <div className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-200/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 border border-blue-200/70 flex items-center justify-center shrink-0">
                <FolderOpen size={14} />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[11px] font-bold text-zinc-900 truncate" title={displayFolder}>
                  {displayFolder}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {statusState === 'ready' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                      <CheckCircle2 size={10} /> Connected &amp; writable
                    </span>
                  )}
                  {statusState === 'needs_permission' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                      <AlertTriangle size={10} /> Permission required after restart
                    </span>
                  )}
                  {statusState === 'not_found' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700">
                      <AlertTriangle size={10} /> Folder or external drive disconnected
                    </span>
                  )}
                  {statusState === 'unset' && (
                    <span className="text-[10px] text-zinc-500">Pick any folder or external USB/SSD drive</span>
                  )}
                  {statusState === 'unsupported' && (
                    <span className="text-[10px] text-rose-700">Folder picker unavailable in this browser</span>
                  )}
                </div>
              </div>
            </div>

            {statusState !== 'unset' && (
              <button
                type="button"
                onClick={handleClearFolder}
                title="Reset to default Downloads folder"
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition cursor-pointer shrink-0"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleChooseFolder}
              disabled={busy}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                highlightPicker
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs ring-2 ring-blue-300'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
              }`}
            >
              <FolderOpen size={12} />
              <span>
                {statusState === 'unset'
                  ? 'Choose Folder / External Drive…'
                  : 'Change Folder / Drive…'}
              </span>
            </button>

            {(statusState === 'needs_permission' || statusState === 'not_found') && (
              <button
                type="button"
                onClick={handleReauthorize}
                disabled={busy}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white transition cursor-pointer flex items-center gap-1"
              >
                <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
                <span>{statusState === 'not_found' ? 'Retry Drive' : 'Grant Access'}</span>
              </button>
            )}
          </div>

          <p className="text-[10px] text-zinc-500 leading-snug">
            Supports any folder on your computer and external attached drives. Choose <b>Allow on every visit</b> when Chrome prompts to keep access across restarts.
          </p>
        </div>
      )}

      {mode === 'ask' && (
        <p className="text-[10.5px] text-zinc-600 bg-zinc-50 px-2.5 py-2 rounded-lg border border-zinc-200/70">
          Chrome will open the OS &ldquo;Save As&rdquo; dialog for each capture or yoinked image so you can pick a folder or drive on the fly.
        </p>
      )}

      {feedback && (
        <div className="text-[10.5px] font-medium px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-800 border border-blue-200/80">
          {feedback}
        </div>
      )}
    </div>
  );
};
