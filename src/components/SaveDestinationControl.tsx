import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  MessageSquare,
  RefreshCw,
  X,
} from 'lucide-react';
import type { CaptureSettings, FolderAccessState, SaveLocationMode } from '../types';
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
    if (res.name) setFolderName(res.name);
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
        setFeedback(
          `"${res.name || 'Selected drive'}" could not be found. Reconnect the drive or pick a new folder.`
        );
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)]">
        <div className="flex items-center gap-2 min-w-0">
          {mode === 'folder' ? (
            <HardDrive size={16} strokeWidth={1.5} className="text-[var(--ink)] shrink-0" />
          ) : mode === 'ask' ? (
            <MessageSquare size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
          ) : (
            <Download size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
          )}
          <span className="type-caption text-[var(--ink-muted)] shrink-0">Save to</span>
          <span className="type-mono text-[var(--ink)] truncate max-w-[160px]" title={displayFolder}>
            {mode === 'folder'
              ? displayFolder
              : mode === 'ask'
              ? 'Ask each save'
              : 'Downloads'}
          </span>

          {mode === 'folder' && (statusState === 'needs_permission' || statusState === 'not_found') && (
            <button
              type="button"
              onClick={handleReauthorize}
              disabled={busy}
              className="h-7 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] type-caption inline-flex items-center gap-1 cursor-pointer shrink-0 studio-focus"
            >
              <AlertCircle size={12} strokeWidth={1.5} />
              <span>{statusState === 'not_found' ? 'Reconnect' : 'Grant access'}</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            aria-label="Save destination mode"
            value={mode}
            onChange={(e) => handleSelectMode(e.target.value as SaveLocationMode)}
            className="h-8 px-2 rounded-[6px] bg-[var(--surface)] border border-[var(--border)] type-ui text-[var(--ink)] cursor-pointer studio-focus"
          >
            <option value="downloads">Downloads</option>
            <option value="folder">Custom folder</option>
            <option value="ask">Ask each save</option>
          </select>

          <button
            type="button"
            onClick={handleChooseFolder}
            disabled={busy}
            className={`h-8 px-2 rounded-[6px] border type-caption inline-flex items-center gap-1 cursor-pointer studio-focus ${
              highlightPicker
                ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]'
                : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)]'
            }`}
          >
            <FolderOpen size={16} strokeWidth={1.5} />
            <span>{mode === 'folder' ? 'Change' : 'Pick folder'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-4 space-y-3 ${
        highlightPicker ? 'bg-[var(--canvas)]' : 'bg-[var(--surface)]'
      }`}
    >
      <div className="space-y-1">
        <span className="type-body-medium text-[var(--ink)] block">
          Save destination
        </span>
        <span className="type-ui text-[var(--ink-muted)] block">
          Applies to captured screenshots and extracted page media (local folders or external drives).
        </span>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)]">
        <button
          type="button"
          onClick={() => handleSelectMode('downloads')}
          aria-pressed={mode === 'downloads'}
          className={`h-8 px-2 rounded-[6px] type-caption inline-flex items-center justify-center gap-1 cursor-pointer transition-colors studio-focus ${
            mode === 'downloads'
              ? 'bg-[var(--ink)] text-[var(--surface)]'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
          }`}
        >
          <Download size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">Downloads</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectMode('folder')}
          aria-pressed={mode === 'folder'}
          className={`h-8 px-2 rounded-[6px] type-caption inline-flex items-center justify-center gap-1 cursor-pointer transition-colors studio-focus ${
            mode === 'folder'
              ? 'bg-[var(--ink)] text-[var(--surface)]'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
          }`}
        >
          <HardDrive size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">Folder</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectMode('ask')}
          aria-pressed={mode === 'ask'}
          className={`h-8 px-2 rounded-[6px] type-caption inline-flex items-center justify-center gap-1 cursor-pointer transition-colors studio-focus ${
            mode === 'ask'
              ? 'bg-[var(--ink)] text-[var(--surface)]'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
          }`}
        >
          <MessageSquare size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">Ask</span>
        </button>
      </div>

      {mode === 'folder' && (
        <div className="p-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              <div className="min-w-0">
                <div className="type-mono text-[var(--ink)] truncate" title={displayFolder}>
                  {displayFolder}
                </div>
                <div className="flex items-center gap-1 type-caption text-[var(--ink-muted)]">
                  {statusState === 'ready' && (
                    <>
                      <CheckCircle2 size={12} strokeWidth={1.5} />
                      <span>Connected and writable</span>
                    </>
                  )}
                  {statusState === 'needs_permission' && (
                    <>
                      <AlertCircle size={12} strokeWidth={1.5} />
                      <span>Permission required after restart</span>
                    </>
                  )}
                  {statusState === 'not_found' && (
                    <>
                      <AlertCircle size={12} strokeWidth={1.5} />
                      <span>Folder or drive disconnected</span>
                    </>
                  )}
                  {statusState === 'unset' && <span>Choose any local folder or external drive</span>}
                  {statusState === 'unsupported' && <span>Folder picker unavailable in this browser</span>}
                </div>
              </div>
            </div>

            {statusState !== 'unset' && (
              <button
                type="button"
                onClick={handleClearFolder}
                aria-label="Reset to default Downloads folder"
                title="Reset to default Downloads folder"
                className="w-8 h-8 rounded-[6px] hover:bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)] flex items-center justify-center shrink-0 cursor-pointer studio-focus"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleChooseFolder}
              disabled={busy}
              className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
            >
              <FolderOpen size={16} strokeWidth={1.5} />
              <span>{statusState === 'unset' ? 'Choose folder…' : 'Change folder…'}</span>
            </button>

            {(statusState === 'needs_permission' || statusState === 'not_found') && (
              <button
                type="button"
                onClick={handleReauthorize}
                disabled={busy}
                className="h-8 px-3 rounded-[8px] bg-[var(--ink)] text-[var(--surface)] type-ui-medium inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 studio-focus"
              >
                <RefreshCw size={16} strokeWidth={1.5} className={busy ? 'animate-spin' : ''} />
                <span>{statusState === 'not_found' ? 'Retry drive' : 'Grant access'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {mode === 'ask' && (
        <p className="p-3 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-ui text-[var(--ink-muted)]">
          Chrome opens the system Save As dialog for each capture or extracted media file.
        </p>
      )}

      {feedback && (
        <p role="status" className="p-2 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-mono text-[var(--ink)]">
          {feedback}
        </p>
      )}
    </div>
  );
};
