import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Pencil,
  ScanText,
  Shield,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { CaptureSettings, FolderAccessState, HistoryItem } from '../../types';
import {
  buildProvenanceTimeline,
  computeLibrarySummary,
  formatDimensions,
  formatFileSize,
  formatSaveDestinationSummary,
  formatTimestamp,
  getModeLabel,
  safeHostname,
} from '../../utils/studioFormat';
import { copyImageToClipboard, downloadDataUrl, getFullResolutionImage } from '../../utils/storage';
import { CropReticleFrame } from './CropReticleFrame';

interface CaptureInspectorProps {
  variant: 'rail' | 'sheet';
  item: HistoryItem | null;
  history: HistoryItem[];
  settings: CaptureSettings;
  folderStatusState: FolderAccessState;
  proofKeyId: string;
  useAccentPrimaryCta: boolean;
  showReticleInPreview: boolean;
  onClose: () => void;
  onSelectPreview: (item: HistoryItem) => void;
  onSelectAnnotate: (item: HistoryItem) => void;
  onSelectOcr: (item: HistoryItem) => void;
  onSelectVerify: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void | Promise<void>;
}

export const CaptureInspector: React.FC<CaptureInspectorProps> = ({
  variant,
  item,
  history,
  settings,
  folderStatusState,
  proofKeyId,
  useAccentPrimaryCta,
  showReticleInPreview,
  onClose,
  onSelectPreview,
  onSelectAnnotate,
  onSelectOcr,
  onSelectVerify,
  onDeleteItem,
}) => {
  const [resolvedFullUrl, setResolvedFullUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setFeedback(null);
    setResolvedFullUrl(null);
    if (!item) return;

    let active = true;
    if (!item.fileSizeBytes && !item.dataUrl) {
      getFullResolutionImage(item.id)
        .then((full) => {
          if (active && full) setResolvedFullUrl(full);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    if (variant !== 'sheet' || !item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [variant, item, onClose]);

  const resolveOriginal = async (target: HistoryItem): Promise<string | null> => {
    const full = resolvedFullUrl || (await getFullResolutionImage(target.id)) || target.dataUrl;
    if (!full) {
      setFeedback('Original image unavailable in local storage.');
      return null;
    }
    return full;
  };

  const handleCopy = async () => {
    if (!item) return;
    const src = await resolveOriginal(item);
    if (!src) return;
    const ok = await copyImageToClipboard(src);
    if (ok) {
      setCopiedId(item.id);
      setFeedback('Copied PNG to clipboard.');
      setTimeout(() => setCopiedId(null), 1800);
    } else {
      setFeedback('Clipboard write was blocked.');
    }
  };

  const handleDownload = async () => {
    if (!item) return;
    const src = await resolveOriginal(item);
    if (!src) return;
    const ext = item.format || 'png';
    const cleanTitle = (item.title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    try {
      await downloadDataUrl(src, `${cleanTitle}_${Date.now()}.${ext}`, { settings });
      setFeedback('Saved capture to destination.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not save capture.');
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    try {
      await onDeleteItem(item.id);
      setConfirmDelete(false);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not delete capture.');
    }
  };

  const summary = computeLibrarySummary(history);
  const saveSummary = formatSaveDestinationSummary(settings, folderStatusState);
  const totalBytesLabel = summary.totalBytes > 0 ? formatFileSize(summary.totalBytes) : null;

  const bodyContent = !item ? (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="type-display-s text-[var(--ink)]">Library summary</h2>
        <p className="type-ui text-[var(--ink-muted)]">
          Select any capture to inspect dimensions, Proof signature, and provenance.
        </p>
      </div>

      <dl className="divide-y divide-[var(--border)] border-t border-b border-[var(--border)]">
        <div className="py-2 flex items-center justify-between gap-2">
          <dt className="type-ui text-[var(--ink-muted)]">Saved captures</dt>
          <dd className="type-mono text-[var(--ink)]">{summary.totalCount}</dd>
        </div>
        <div className="py-2 flex items-center justify-between gap-2">
          <dt className="type-ui text-[var(--ink-muted)]">Proof signed</dt>
          <dd className="type-mono text-[var(--ink)]">{summary.signedCount}</dd>
        </div>
        {totalBytesLabel && (
          <div className="py-2 flex items-center justify-between gap-2">
            <dt className="type-ui text-[var(--ink-muted)]">Indexed size</dt>
            <dd className="type-mono text-[var(--ink)]">{totalBytesLabel}</dd>
          </div>
        )}
        <div className="py-2 flex items-center justify-between gap-2">
          <dt className="type-ui text-[var(--ink-muted)]">Device key</dt>
          <dd className="type-mono text-[var(--ink)] truncate">{proofKeyId}</dd>
        </div>
        <div className="py-2 flex items-center justify-between gap-2">
          <dt className="type-ui text-[var(--ink-muted)]">Save target</dt>
          <dd className="type-mono text-[var(--ink)] truncate">{saveSummary.label}</dd>
        </div>
      </dl>
    </div>
  ) : (
    (() => {
      const dims = formatDimensions(item.width, item.height);
      const sizeLabel = formatFileSize(item.fileSizeBytes, resolvedFullUrl || item.dataUrl);
      const ts = formatTimestamp(item.timestamp);
      const host = safeHostname(item.url);
      const hasWebOrigin = Boolean(item.url && /^https?:\/\//i.test(item.url));
      const timeline = buildProvenanceTimeline(item);

      const attributes: string[] = [
        getModeLabel(item.mode),
        (item.format || 'png').toUpperCase(),
      ];
      if (item.proofSigned) attributes.push('ECDSA signed');
      if (item.ocrText && item.ocrText.trim().length > 0) attributes.push('OCR indexed');
      if (item.warning) attributes.push('Notice');

      return (
        <div className="divide-y divide-[var(--border)]">
          {/* Summary: Preview + Primary Action */}
          <div className="p-4 space-y-3">
            <CropReticleFrame
              item={item}
              selected={showReticleInPreview}
              resolvedFullDataUrl={resolvedFullUrl}
              onResolvedFullDataUrl={setResolvedFullUrl}
              showProofStamp={true}
            />

            <div className="space-y-1 min-w-0">
              <h2 className="type-body-medium text-[var(--ink)] break-words">
                {item.title || 'Untitled capture'}
              </h2>
              <div className="flex items-center gap-2 min-w-0">
                <span className="type-mono text-[var(--ink-muted)] truncate">{host}</span>
                {hasWebOrigin && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--ink-muted)] hover:text-[var(--ink)] shrink-0 studio-focus rounded-[4px]"
                    title="Open source page"
                    aria-label="Open source page"
                  >
                    <ExternalLink size={16} strokeWidth={1.5} />
                  </a>
                )}
              </div>
            </div>

            {/* Single Primary CTA */}
            <button
              type="button"
              onClick={() => onSelectAnnotate(item)}
              className={`w-full h-9 px-3 rounded-[8px] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus ${
                useAccentPrimaryCta
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'bg-[var(--ink)] text-[var(--surface)]'
              }`}
            >
              <Pencil size={16} strokeWidth={1.5} />
              <span>Annotate</span>
            </button>

            {/* Secondary action grid */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onSelectOcr(item)}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                <ScanText size={16} strokeWidth={1.5} />
                <span>OCR text</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectVerify(item)}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                <ShieldCheck size={16} strokeWidth={1.5} />
                <span>Verify</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                {copiedId === item.id ? (
                  <Check size={16} strokeWidth={1.5} />
                ) : (
                  <Copy size={16} strokeWidth={1.5} />
                )}
                <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium flex items-center justify-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                <Download size={16} strokeWidth={1.5} />
                <span>Save</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => onSelectPreview(item)}
                className="h-8 px-2 rounded-[6px] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] type-caption flex items-center gap-2 cursor-pointer transition-colors studio-focus"
              >
                <Maximize2 size={16} strokeWidth={1.5} />
                <span>Full preview</span>
              </button>

              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="h-8 px-2 rounded-[6px] bg-[var(--ink)] text-[var(--surface)] type-caption cursor-pointer studio-focus"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-8 px-2 rounded-[6px] text-[var(--ink-muted)] hover:text-[var(--ink)] type-caption cursor-pointer studio-focus"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="h-8 px-2 rounded-[6px] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] type-caption flex items-center gap-2 cursor-pointer transition-colors studio-focus"
                >
                  <Trash2 size={16} strokeWidth={1.5} />
                  <span>Delete</span>
                </button>
              )}
            </div>

            {feedback && (
              <p role="status" className="type-mono text-[var(--ink-muted)] bg-[var(--canvas)] border border-[var(--border)] rounded-[8px] px-3 py-2">
                {feedback}
              </p>
            )}
          </div>

          {/* File details */}
          <div className="p-4 space-y-2">
            <h3 className="type-caption text-[var(--ink-muted)]">File details</h3>
            <dl className="divide-y divide-[var(--border)]">
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="type-ui text-[var(--ink-muted)]">Dimensions</dt>
                <dd className="type-mono text-[var(--ink)]">{dims ? `${dims} px` : '—'}</dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="type-ui text-[var(--ink-muted)]">Format</dt>
                <dd className="type-mono text-[var(--ink)]">{(item.format || 'png').toUpperCase()}</dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="type-ui text-[var(--ink-muted)]">File size</dt>
                <dd className="type-mono text-[var(--ink)]">{sizeLabel || '—'}</dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="type-ui text-[var(--ink-muted)]">Mode</dt>
                <dd className="type-mono text-[var(--ink)]">{getModeLabel(item.mode)}</dd>
              </div>
              {item.viewport && (
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="type-ui text-[var(--ink-muted)]">Viewport</dt>
                  <dd className="type-mono text-[var(--ink)]">
                    {item.viewport.width}×{item.viewport.height} · {item.viewport.dpr}x
                  </dd>
                </div>
              )}
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="type-ui text-[var(--ink-muted)]">Captured</dt>
                <dd className="type-mono text-[var(--ink)] text-right">{ts.full}</dd>
              </div>
            </dl>
          </div>

          {/* Tags / derived attributes */}
          <div className="p-4 space-y-2">
            <h3 className="type-caption text-[var(--ink-muted)]">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {attributes.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-mono text-[var(--ink-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Proof signature verdict */}
          <div className="p-4 space-y-3">
            <h3 className="type-caption text-[var(--ink-muted)]">Proof signature</h3>
            <div className="flex items-start gap-2">
              {item.proofSigned ? (
                <ShieldCheck
                  size={16}
                  strokeWidth={1.5}
                  className="text-[var(--semantic-valid)] shrink-0 mt-0.5"
                />
              ) : (
                <Shield
                  size={16}
                  strokeWidth={1.5}
                  className="text-[var(--ink-muted)] shrink-0 mt-0.5"
                />
              )}
              <div className="min-w-0 space-y-1">
                <p className="type-body-medium text-[var(--ink)]">
                  {item.proofSigned ? 'Signed locally' : 'Unsigned'}
                </p>
                <p className="type-mono text-[var(--ink-muted)] break-all">
                  {item.proofSigned
                    ? `ECDSA P-256 · ${item.proofKeyId || proofKeyId}`
                    : 'No ECDSA proof signature recorded'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectVerify(item)}
              className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] type-ui-medium cursor-pointer transition-colors studio-focus"
            >
              Inspect in Proof Vault
            </button>
          </div>

          {/* OCR preview when indexed */}
          {item.ocrText && item.ocrText.trim().length > 0 && (
            <div className="p-4 space-y-2">
              <h3 className="type-caption text-[var(--ink-muted)]">Offline OCR text</h3>
              <p className="p-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] type-mono text-[var(--ink)] line-clamp-4 break-words select-text">
                {item.ocrText}
              </p>
            </div>
          )}

          {/* Provenance timeline */}
          <div className="p-4 space-y-3">
            <h3 className="type-caption text-[var(--ink-muted)]">Provenance timeline</h3>
            <ol className="border-l border-[var(--border)] pl-3 space-y-3">
              {timeline.map((event) => (
                <li key={event.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="type-ui-medium text-[var(--ink)]">{event.label}</span>
                    {event.timestamp && (
                      <span className="type-mono text-[var(--ink-muted)] shrink-0">
                        {formatTimestamp(event.timestamp).short}
                      </span>
                    )}
                  </div>
                  <p className="type-mono text-[var(--ink-muted)] break-words">{event.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      );
    })()
  );

  if (variant === 'sheet') {
    if (!item) return null;
    return (
      <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Capture inspector">
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="absolute inset-0 bg-[var(--ink)] opacity-35 cursor-pointer"
        />
        <div
          data-inspector-sheet="true"
          className="relative z-10 max-h-[84vh] w-full bg-[var(--surface)] border-t border-[var(--border)] rounded-t-[12px] flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-2 shrink-0">
            <span className="type-caption text-[var(--ink-muted)]">Inspector</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{bodyContent}</div>
        </div>
      </div>
    );
  }

  return (
    <aside
      data-inspector-rail="true"
      aria-label="Capture inspector"
      className="hidden lg:flex w-[300px] shrink-0 bg-[var(--surface)] border-l border-[var(--border)] flex-col sticky top-0 h-screen overflow-hidden"
    >
      <div className="h-[56px] sm:h-[64px] px-4 border-b border-[var(--border)] flex items-center justify-between gap-2 shrink-0">
        <span className="type-caption text-[var(--ink-muted)]">Inspector</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse inspector"
          title="Collapse inspector"
          className="w-8 h-8 rounded-[8px] hover:bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{bodyContent}</div>
    </aside>
  );
};
