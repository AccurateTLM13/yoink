import React, { useRef } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Clock,
  Crop,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Monitor,
  Moon,
  ScreenShare,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sun,
  Upload,
} from 'lucide-react';
import type { FolderAccessState, SaveLocationMode } from '../types';
import type { ThemeMode } from '../utils/theme';
import {
  POPUP_CAPTURE_DELAYS,
  formatDelayLabel,
  formatPopupProofStatus,
  formatPopupSaveDestination,
} from '../utils/studioFormat';
import { YoinkMark } from './studio/YoinkMark';

interface Props {
  lastCaptureError?: string | null;
  onDismissCaptureError?: () => void;
  onCaptureFullPage: () => void;
  onCaptureVisible: () => void;
  onCaptureSelection: () => void;
  onCaptureElement?: () => void;
  onCaptureDesktop?: () => void;
  onCaptureAllTabs: () => void;
  onOpenUrlBatch: () => void;
  onOpenMultiSize: () => void;
  onOpenHistory: () => void;
  onOpenOptions: () => void;
  onOpenStudio?: () => void;
  onOpenVerify?: () => void;
  onOpenMediaYoinker?: () => void;
  onUploadFiles?: (files: File[]) => void;
  delaySec?: number;
  onSetDelaySec?: (sec: number) => void;
  optimalQualityMode?: boolean;
  enableProof?: boolean;
  proofKeyId?: string;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
  saveLocationMode?: SaveLocationMode;
  customSaveFolderName?: string;
  folderStatusState?: FolderAccessState;
  onOpenFolderPicker?: () => void;
  historyCount: number;
  isCapturing: boolean;
  activeAction: string | null;
}

interface CommandRowProps {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}

const PopupCommandRow: React.FC<CommandRowProps> = ({
  icon,
  label,
  trailing,
  disabled,
  primary = false,
  onClick,
}) => (
  <button
    type="button"
    data-popup-cmd="true"
    onClick={onClick}
    disabled={disabled}
    className={`w-full px-2 rounded-[8px] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed studio-focus ${
      primary
        ? 'h-10 bg-[var(--accent)] text-[var(--accent-ink)] type-body-medium'
        : 'h-9 text-[var(--ink)] hover:bg-[var(--canvas)] type-body'
    }`}
  >
    <span className="flex items-center gap-2 min-w-0">
      <span
        className={`w-4 h-4 flex items-center justify-center shrink-0 ${
          primary ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-muted)]'
        }`}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </span>
    {trailing && <span className="shrink-0 flex items-center gap-1">{trailing}</span>}
  </button>
);

export const QuickMenu: React.FC<Props> = React.memo(function QuickMenu({
    lastCaptureError,
    onDismissCaptureError,
    onCaptureFullPage,
    onCaptureVisible,
    onCaptureSelection,
    onCaptureElement,
    onCaptureDesktop,
    onCaptureAllTabs,
    onOpenUrlBatch,
    onOpenMultiSize,
    onOpenHistory,
    onOpenOptions,
    onOpenStudio,
    onOpenVerify,
    onOpenMediaYoinker,
    onUploadFiles,
    delaySec = 0,
    onSetDelaySec,
    optimalQualityMode = false,
    enableProof = true,
    proofKeyId,
    theme = 'light',
    onToggleTheme,
    saveLocationMode = 'downloads',
    customSaveFolderName = '',
    folderStatusState = 'unset',
    onOpenFolderPicker,
    historyCount,
    isCapturing,
    activeAction,
  }: Props) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const listContainerRef = useRef<HTMLDivElement | null>(null);

    const saveDest = formatPopupSaveDestination(
      saveLocationMode,
      customSaveFolderName,
      folderStatusState
    );
    const proofStatus = formatPopupProofStatus(enableProof, proofKeyId);

    const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const root = listContainerRef.current;
      if (!root) return;
      const buttons = Array.from(
        root.querySelectorAll<HTMLButtonElement>('button[data-popup-cmd="true"]:not(:disabled)')
      ) as HTMLButtonElement[];
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      const nextIdx =
        e.key === 'ArrowDown'
          ? (idx + 1) % buttons.length
          : (idx - 1 + buttons.length) % buttons.length;
      buttons[nextIdx]?.focus();
    };

    return (
      <div
        data-popup-launcher="true"
        className="flex flex-col h-full w-full bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? (Array.from(e.target.files) as File[]) : [];
            e.target.value = '';
            if (files.length > 0 && onUploadFiles) {
              onUploadFiles(files);
            }
          }}
        />

        {/* Compact 44px Header */}
        <header className="h-[44px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <YoinkMark size={20} className="text-[var(--ink)] shrink-0" />
            <span className="type-display-s text-[var(--ink)] truncate">Yoink</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center cursor-pointer transition-colors studio-focus"
              >
                {theme === 'dark' ? (
                  <Sun size={16} strokeWidth={1.5} />
                ) : (
                  <Moon size={16} strokeWidth={1.5} />
                )}
              </button>
            )}

            {onOpenStudio && (
              <button
                type="button"
                onClick={onOpenStudio}
                title="Open Studio Hub in a full browser tab"
                className="h-8 px-2 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                <span>Studio Hub</span>
                <ExternalLink size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Single-Column Command Launcher */}
        <div
          ref={listContainerRef}
          onKeyDown={handleListKeyDown}
          className="flex-1 p-4 space-y-4 overflow-y-auto overflow-x-hidden"
        >
          {lastCaptureError && (
            <div
              role="alert"
              className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2"
            >
              <div className="flex items-start gap-2">
                <AlertCircle
                  size={16}
                  strokeWidth={1.5}
                  className="text-[var(--semantic-error)] shrink-0 mt-0.5"
                />
                <div className="min-w-0 space-y-1">
                  <p className="type-ui-medium text-[var(--ink)]">Capture did not finish</p>
                  <p className="type-ui text-[var(--ink-muted)] break-words">{lastCaptureError}</p>
                </div>
              </div>
              {onDismissCaptureError && (
                <button
                  type="button"
                  onClick={onDismissCaptureError}
                  className="h-8 px-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] type-caption text-[var(--ink)] cursor-pointer studio-focus"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          {/* Group 1: Capture (1-click capture modes + inline delay) */}
          <section aria-label="Capture" className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="type-caption text-[var(--ink-muted)]">Capture</h2>

              {onSetDelaySec && (
                <div
                  className="flex items-center gap-2"
                  role="group"
                  aria-label="Capture delay"
                >
                  <Clock
                    size={16}
                    strokeWidth={1.5}
                    className={delaySec > 0 ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'}
                  />
                  <div className="flex items-center gap-0.5 p-0.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
                    {POPUP_CAPTURE_DELAYS.map((sec) => {
                      const active = delaySec === sec;
                      return (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => onSetDelaySec(sec)}
                          aria-pressed={active}
                          className={`px-2 py-0.5 rounded-[6px] type-keycap cursor-pointer transition-colors studio-focus ${
                            active
                              ? 'bg-[var(--ink)] text-[var(--surface)]'
                              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                          }`}
                        >
                          {formatDelayLabel(sec)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-1 space-y-1">
              <PopupCommandRow
                primary={true}
                icon={<FileText size={16} strokeWidth={1.5} />}
                label="Capture full page"
                disabled={isCapturing}
                onClick={onCaptureFullPage}
                trailing={
                  <kbd className="px-2 py-0.5 rounded-[6px] border border-[var(--accent-ink)] type-keycap text-[var(--accent-ink)]">
                    Alt+Shift+1
                  </kbd>
                }
              />

              <PopupCommandRow
                icon={<Monitor size={16} strokeWidth={1.5} />}
                label="Visible viewport"
                disabled={isCapturing}
                onClick={onCaptureVisible}
                trailing={
                  <kbd className="px-2 py-0.5 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-keycap text-[var(--ink-muted)]">
                    Alt+Shift+3
                  </kbd>
                }
              />

              <PopupCommandRow
                icon={<Crop size={16} strokeWidth={1.5} />}
                label="Region selection"
                disabled={isCapturing}
                onClick={onCaptureSelection}
                trailing={
                  <kbd className="px-2 py-0.5 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-keycap text-[var(--ink-muted)]">
                    Alt+Shift+4
                  </kbd>
                }
              />

              {onCaptureElement && (
                <PopupCommandRow
                  icon={<ScrollText size={16} strokeWidth={1.5} />}
                  label="Scrollable element"
                  disabled={isCapturing}
                  onClick={onCaptureElement}
                  trailing={<span className="type-mono text-[var(--ink-muted)]">Element</span>}
                />
              )}

              {onCaptureDesktop && (
                <PopupCommandRow
                  icon={<ScreenShare size={16} strokeWidth={1.5} />}
                  label="Desktop screen"
                  disabled={isCapturing}
                  onClick={onCaptureDesktop}
                  trailing={<span className="type-mono text-[var(--ink-muted)]">Display</span>}
                />
              )}

              <PopupCommandRow
                icon={<Layers size={16} strokeWidth={1.5} />}
                label="All open tabs"
                disabled={isCapturing}
                onClick={onCaptureAllTabs}
                trailing={<span className="type-mono text-[var(--ink-muted)]">Window</span>}
              />
            </div>
          </section>

          {/* Group 2: Tools & Workspace */}
          <section aria-label="Tools" className="space-y-2">
            <h2 className="px-1 type-caption text-[var(--ink-muted)]">Tools</h2>

            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-1 space-y-1">
              <PopupCommandRow
                icon={<History size={16} strokeWidth={1.5} />}
                label="Gallery"
                disabled={isCapturing}
                onClick={onOpenHistory}
                trailing={
                  <>
                    <span className="type-mono text-[var(--ink)]">{historyCount}</span>
                    <ChevronRight size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                  </>
                }
              />

              {onOpenMediaYoinker && (
                <PopupCommandRow
                  icon={<ImageIcon size={16} strokeWidth={1.5} />}
                  label="Page media yoinker"
                  disabled={isCapturing}
                  onClick={onOpenMediaYoinker}
                  trailing={<span className="type-mono text-[var(--ink-muted)]">Media</span>}
                />
              )}

              {onUploadFiles && (
                <PopupCommandRow
                  icon={<Upload size={16} strokeWidth={1.5} />}
                  label="Import & annotate"
                  disabled={isCapturing}
                  onClick={() => fileInputRef.current?.click()}
                  trailing={<span className="type-mono text-[var(--ink-muted)]">Image</span>}
                />
              )}

              {onOpenVerify && (
                <PopupCommandRow
                  icon={<ShieldCheck size={16} strokeWidth={1.5} />}
                  label="Verify proof"
                  disabled={isCapturing}
                  onClick={onOpenVerify}
                  trailing={<span className="type-mono text-[var(--ink-muted)]">Vault</span>}
                />
              )}

              <PopupCommandRow
                icon={<Globe size={16} strokeWidth={1.5} />}
                label="Batch URL queue"
                disabled={isCapturing}
                onClick={onOpenUrlBatch}
                trailing={<span className="type-mono text-[var(--ink-muted)]">Batch</span>}
              />

              <PopupCommandRow
                icon={<Smartphone size={16} strokeWidth={1.5} />}
                label="Responsive matrix"
                disabled={isCapturing}
                onClick={onOpenMultiSize}
                trailing={<span className="type-mono text-[var(--ink-muted)]">Viewports</span>}
              />

              <PopupCommandRow
                icon={<Settings size={16} strokeWidth={1.5} />}
                label="Engine settings"
                disabled={isCapturing}
                onClick={onOpenOptions}
                trailing={
                  <>
                    <span className="type-mono text-[var(--ink-muted)]">
                      {optimalQualityMode ? '2x HD' : '1x'}
                    </span>
                    <ChevronRight size={16} strokeWidth={1.5} className="text-[var(--ink-muted)]" />
                  </>
                }
              />
            </div>
          </section>
        </div>

        {/* Single 40px Bottom Bar: Save Destination & Proof Status */}
        <footer className="h-[40px] px-4 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (onOpenFolderPicker) {
                onOpenFolderPicker();
              } else {
                onOpenOptions();
              }
            }}
            title="Configure save folder or external drive"
            className="flex items-center gap-2 min-w-0 text-left cursor-pointer hover:text-[var(--ink)] transition-colors studio-focus rounded-[6px]"
          >
            {saveLocationMode === 'folder' ? (
              <HardDrive
                size={16}
                strokeWidth={1.5}
                className={
                  saveDest.needsAttention
                    ? 'text-[var(--ink)] shrink-0'
                    : 'text-[var(--ink-muted)] shrink-0'
                }
              />
            ) : (
              <FolderOpen size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
            )}
            <span
              className={`type-mono truncate ${
                saveDest.needsAttention ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
              }`}
            >
              {saveDest.label}
            </span>
          </button>

          {isCapturing ? (
            <div role="status" className="flex items-center gap-2 min-w-0 shrink-0">
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)] shrink-0" />
              <span className="type-mono text-[var(--ink)] truncate max-w-[140px]">
                {activeAction || 'Capturing…'}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenVerify || onOpenOptions}
              title={`Proof signing: ${proofStatus.detail}`}
              className="flex items-center gap-2 shrink-0 cursor-pointer studio-focus rounded-[6px]"
            >
              {proofStatus.active ? (
                <ShieldCheck
                  size={16}
                  strokeWidth={1.5}
                  className="text-[var(--semantic-valid)] shrink-0"
                />
              ) : (
                <Shield size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              )}
              <span
                className={`type-mono ${
                  proofStatus.active ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
                }`}
              >
                {proofStatus.label}
              </span>
            </button>
          )}
        </footer>
      </div>
    );
  });
