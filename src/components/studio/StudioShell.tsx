import React, { useEffect, useRef } from 'react';
import {
  Globe,
  HardDrive,
  History,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LayoutGrid,
  Loader2,
  Menu,
  Moon,
  PanelRight,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stamp,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import type { CaptureSettings, FolderAccessState } from '../../types';
import type { ThemeMode } from '../../utils/theme';
import { formatSaveDestinationSummary } from '../../utils/studioFormat';
import { YoinkMark } from './YoinkMark';

export type StudioView = 'menu' | 'urllist' | 'history' | 'options' | 'multisize' | 'verify' | 'media';

interface StudioShellProps {
  view: StudioView;
  viewTitle: string;
  viewSummary: string;
  historyCount: number;
  settings: CaptureSettings;
  folderStatusState: FolderAccessState;
  proofKeyId: string;
  statusMessage: string;
  isCapturing: boolean;
  isDraggingFiles: boolean;
  theme: ThemeMode;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  showInspectorToggle: boolean;
  onToggleTheme: () => void;
  onToggleSidebar: (open: boolean) => void;
  onToggleInspector: () => void;
  onSelectView: (view: StudioView) => void;
  onCaptureAllTabs: () => void;
  onImportFiles: (files: File[]) => void;
  onSaveSettings: (next: CaptureSettings) => void;
  onToggleOptimalHD: () => void;
  onToggleProof: () => void;
  onToggleReceiptStamp: () => void;
  onDragStateChange: (dragging: boolean) => void;
  inspectorRail?: React.ReactNode;
  inspectorSheet?: React.ReactNode;
  children: React.ReactNode;
}

interface NavRowProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  trailing?: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

const SidebarNavRow: React.FC<NavRowProps> = ({
  icon,
  label,
  active,
  trailing,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-current={active ? 'page' : undefined}
    className={`w-full h-9 px-2 rounded-[8px] flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50 studio-focus ${
      active
        ? 'bg-[var(--canvas)] border border-[var(--border)] text-[var(--ink)] type-ui-medium'
        : 'border border-transparent text-[var(--ink-muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] type-ui'
    }`}
  >
    <span className="flex items-center gap-2 min-w-0">
      <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
    {trailing && <span className="shrink-0">{trailing}</span>}
  </button>
);

export const StudioShell: React.FC<StudioShellProps> = ({
  view,
  viewTitle,
  viewSummary,
  historyCount,
  settings,
  folderStatusState,
  proofKeyId,
  statusMessage,
  isCapturing,
  isDraggingFiles,
  theme,
  sidebarOpen,
  inspectorOpen,
  showInspectorToggle,
  onToggleTheme,
  onToggleSidebar,
  onToggleInspector,
  onSelectView,
  onCaptureAllTabs,
  onImportFiles,
  onSaveSettings,
  onToggleOptimalHD,
  onToggleProof,
  onToggleReceiptStamp,
  onDragStateChange,
  inspectorRail,
  inspectorSheet,
  children,
}) => {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const saveSummary = formatSaveDestinationSummary(settings, folderStatusState);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleSidebar(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, onToggleSidebar]);

  const navigate = (next: StudioView) => {
    onSelectView(next);
    onToggleSidebar(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[var(--surface)] text-[var(--ink)]">
      {/* Brand header */}
      <div className="h-[56px] sm:h-[64px] px-4 border-b border-[var(--border)] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => navigate('menu')}
          className="flex items-center gap-2 text-[var(--ink)] cursor-pointer studio-focus rounded-[6px]"
        >
          <YoinkMark size={20} className="text-[var(--ink)] shrink-0" />
          <span className="type-display-s text-[var(--ink)]">Yoink</span>
          <span className="type-caption text-[var(--ink-muted)]">Studio</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleSidebar(false)}
          aria-label="Close navigation"
          className="md:hidden w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Navigation groups */}
      <nav aria-label="Studio navigation" className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-1">
          <div className="px-2 pb-1 type-caption text-[var(--ink-muted)]">Workspace</div>
          <SidebarNavRow
            icon={<LayoutGrid size={16} strokeWidth={1.5} />}
            label="Studio Hub"
            active={view === 'menu'}
            onClick={() => navigate('menu')}
          />
          <SidebarNavRow
            icon={<History size={16} strokeWidth={1.5} />}
            label="Gallery"
            active={view === 'history'}
            trailing={
              <span className="type-mono text-[var(--ink-muted)]">{historyCount}</span>
            }
            onClick={() => navigate('history')}
          />
          <SidebarNavRow
            icon={<ImageIcon size={16} strokeWidth={1.5} />}
            label="Page media"
            active={view === 'media'}
            onClick={() => navigate('media')}
          />
        </div>

        <div className="space-y-1">
          <div className="px-2 pb-1 type-caption text-[var(--ink-muted)]">Automation</div>
          <SidebarNavRow
            icon={<Globe size={16} strokeWidth={1.5} />}
            label="Batch URL queue"
            active={view === 'urllist'}
            onClick={() => navigate('urllist')}
          />
          <SidebarNavRow
            icon={<Smartphone size={16} strokeWidth={1.5} />}
            label="Responsive matrix"
            active={view === 'multisize'}
            onClick={() => navigate('multisize')}
          />
          <SidebarNavRow
            icon={<Layers size={16} strokeWidth={1.5} />}
            label="Capture all tabs"
            active={false}
            disabled={isCapturing}
            onClick={() => {
              onToggleSidebar(false);
              onCaptureAllTabs();
            }}
          />
        </div>

        <div className="space-y-1">
          <div className="px-2 pb-1 type-caption text-[var(--ink-muted)]">Provenance</div>
          <SidebarNavRow
            icon={<ShieldCheck size={16} strokeWidth={1.5} />}
            label="Proof Vault"
            active={view === 'verify'}
            onClick={() => navigate('verify')}
          />
          <SidebarNavRow
            icon={<Settings size={16} strokeWidth={1.5} />}
            label="Engine settings"
            active={view === 'options'}
            onClick={() => navigate('options')}
          />
        </div>
      </nav>

      {/* Bottom Engine & Cryptographic Identity Dock */}
      <div className="p-4 border-t border-[var(--border)] space-y-3 shrink-0">
        <div className="space-y-1">
          <div className="px-2 pb-1 type-caption text-[var(--ink-muted)]">Engine toggles</div>

          <button
            type="button"
            onClick={onToggleOptimalHD}
            className="w-full h-9 px-2 rounded-[8px] hover:bg-[var(--canvas)] flex items-center justify-between gap-2 cursor-pointer transition-colors studio-focus"
          >
            <span className="flex items-center gap-2 min-w-0 type-ui text-[var(--ink)]">
              <Sparkles size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              <span className="truncate">Optimal HD (2x)</span>
            </span>
            <span
              className={`type-mono shrink-0 ${
                settings.optimalQualityMode ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
              }`}
            >
              {settings.optimalQualityMode ? 'On' : 'Off'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleProof}
            className="w-full h-9 px-2 rounded-[8px] hover:bg-[var(--canvas)] flex items-center justify-between gap-2 cursor-pointer transition-colors studio-focus"
          >
            <span className="flex items-center gap-2 min-w-0 type-ui text-[var(--ink)]">
              <ShieldCheck size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              <span className="truncate">Proof signing</span>
            </span>
            <span
              className={`type-mono shrink-0 ${
                (settings.enableProof ?? true) ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
              }`}
            >
              {(settings.enableProof ?? true) ? 'On' : 'Off'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleReceiptStamp}
            className="w-full h-9 px-2 rounded-[8px] hover:bg-[var(--canvas)] flex items-center justify-between gap-2 cursor-pointer transition-colors studio-focus"
          >
            <span className="flex items-center gap-2 min-w-0 type-ui text-[var(--ink)]">
              <Stamp size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              <span className="truncate">Receipt footer</span>
            </span>
            <span
              className={`type-mono shrink-0 ${
                settings.proofVisualStamp ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
              }`}
            >
              {settings.proofVisualStamp ? 'On' : 'Off'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate('options')}
            className="w-full h-9 px-2 rounded-[8px] hover:bg-[var(--canvas)] flex items-center justify-between gap-2 cursor-pointer transition-colors studio-focus"
          >
            <span className="flex items-center gap-2 min-w-0 type-ui text-[var(--ink)]">
              <HardDrive size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              <span className="truncate">{saveSummary.label}</span>
            </span>
            <span className="type-mono text-[var(--ink-muted)] shrink-0">
              {settings.saveLocationMode === 'folder' && folderStatusState !== 'ready'
                ? 'Check'
                : 'Path'}
            </span>
          </button>
        </div>

        {/* Device ECDSA key & creator handle */}
        <div className="pt-3 border-t border-[var(--border)] space-y-2">
          <div className="px-2 space-y-1">
            <span className="flex items-center gap-2 type-caption text-[var(--ink-muted)]">
              <KeyRound size={16} strokeWidth={1.5} className="shrink-0" />
              <span>Device key</span>
            </span>
            <div className="type-mono text-[var(--ink)] truncate">{proofKeyId}</div>
          </div>
          <label className="block px-2 space-y-1">
            <span className="type-caption text-[var(--ink-muted)] block">Creator handle</span>
            <input
              type="text"
              value={settings.proofAuthor || ''}
              onChange={(e) => onSaveSettings({ ...settings, proofAuthor: e.target.value })}
              placeholder="@handle"
              maxLength={60}
              className="w-full h-8 px-2 rounded-[8px] bg-[var(--canvas)] border border-[var(--border)] type-mono text-[var(--ink)] placeholder:text-[var(--ink-muted)] select-text studio-focus"
            />
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-[var(--canvas)] text-[var(--ink)] overflow-x-clip">
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          if (files.length > 0) onImportFiles(files);
        }}
      />

      {/* 1440px viewport-filling shell */}
      <div className="w-full max-w-[1440px] mx-auto min-h-screen flex bg-[var(--canvas)] xl:border-x xl:border-[var(--border)]">
        {/* Desktop Left Sidebar (240px) */}
        <aside className="hidden md:block w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] sticky top-0 h-screen overflow-hidden">
          {sidebarContent}
        </aside>

        {/* Mobile / Narrow (< 768px) Slide-Over Sidebar Drawer */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-40 flex"
            role="dialog"
            aria-modal="true"
            aria-label="Studio navigation"
          >
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => onToggleSidebar(false)}
              className="absolute inset-0 bg-[var(--ink)] opacity-35 cursor-pointer"
            />
            <div
              data-sidebar-drawer="true"
              className="relative z-10 w-[240px] max-w-[85vw] h-full border-r border-[var(--border)] bg-[var(--surface)] overflow-hidden"
            >
              {sidebarContent}
            </div>
          </div>
        )}

        {/* Center Fluid Workspace Column */}
        <div className="flex-1 min-w-0 flex flex-col bg-[var(--canvas)]">
          {/* Top Bar */}
          <header className="h-[56px] sm:h-[64px] px-4 md:px-6 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => onToggleSidebar(true)}
                aria-label="Open navigation"
                className="md:hidden w-9 h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center shrink-0 cursor-pointer studio-focus"
              >
                <Menu size={16} strokeWidth={1.5} />
              </button>

              <div className="min-w-0">
                <h1 className="type-display-l text-[var(--ink)] truncate">{viewTitle}</h1>
                <p className="type-ui text-[var(--ink-muted)] truncate hidden sm:block">
                  {viewSummary}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {statusMessage && statusMessage !== 'Ready' && (
                <div
                  role="status"
                  className="hidden xl:flex items-center gap-2 px-3 h-9 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] type-mono text-[var(--ink-muted)] max-w-[260px]"
                >
                  {isCapturing && <Loader2 size={16} strokeWidth={1.5} className="animate-spin shrink-0 text-[var(--ink)]" />}
                  <span className="truncate">{statusMessage}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="h-9 px-2 sm:px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center gap-2 cursor-pointer transition-colors studio-focus"
                title="Import local image"
                aria-label="Import image"
              >
                <Upload size={16} strokeWidth={1.5} />
                <span className="hidden sm:inline">Import</span>
              </button>

              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="w-9 h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer transition-colors studio-focus"
              >
                {theme === 'dark' ? (
                  <Sun size={16} strokeWidth={1.5} />
                ) : (
                  <Moon size={16} strokeWidth={1.5} />
                )}
              </button>

              {showInspectorToggle && (
                <button
                  type="button"
                  onClick={onToggleInspector}
                  aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
                  aria-pressed={inspectorOpen}
                  title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
                  className={`hidden lg:flex w-9 h-9 rounded-[8px] border items-center justify-center cursor-pointer transition-colors studio-focus ${
                    inspectorOpen
                      ? 'border-[var(--ink)] bg-[var(--canvas)] text-[var(--ink)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  <PanelRight size={16} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </header>

          {/* Main Workspace Area + Drag-and-Drop Import */}
          <main
            className={`flex-1 min-w-0 flex flex-col relative ${
              isDraggingFiles ? 'outline-2 outline-dashed outline-[var(--accent)] -outline-offset-4' : ''
            }`}
            onDragOver={(e) => {
              if (view === 'verify') return;
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                onDragStateChange(true);
              }
            }}
            onDragLeave={() => onDragStateChange(false)}
            onDrop={(e) => {
              onDragStateChange(false);
              if (view === 'verify') return;
              if (e.dataTransfer.files.length > 0) {
                e.preventDefault();
                onImportFiles(Array.from(e.dataTransfer.files));
              }
            }}
          >
            {children}
          </main>
        </div>

        {/* Desktop Right Inspector Rail (300px, collapsible) */}
        {inspectorOpen && inspectorRail}
      </div>

      {/* Narrow / Phone (< 1024px) Bottom Sheet Inspector */}
      {inspectorSheet}
    </div>
  );
};
