import type {
  CaptureMode,
  CaptureSettings,
  FolderAccessState,
  HistoryItem,
  ProofVerificationResult,
  ResolutionConfig,
  SaveLocationMode,
  YoinkedMediaItem,
  YoinkMediaCategory,
} from '../types';

export type GalleryFilter = 'all' | 'signed' | CaptureMode;

export interface LibrarySummary {
  totalCount: number;
  signedCount: number;
  totalBytes: number;
  latestTimestamp: number | null;
  modeCounts: Partial<Record<CaptureMode, number>>;
}

export interface ProvenanceEvent {
  id: string;
  kind: 'capture' | 'origin' | 'proof' | 'ocr' | 'warning';
  label: string;
  detail: string;
  timestamp?: number;
}

const MODE_LABELS: Record<CaptureMode, string> = {
  full: 'Full page',
  visible: 'Visible viewport',
  selection: 'Region selection',
  element: 'Scrollable element',
  alltabs: 'Tab batch',
  urllist: 'Batch URL',
  multisize: 'Responsive',
  annotated: 'Annotated',
  upload: 'Imported',
  desktop: 'Screen',
  media: 'Media',
};

const MIN_THUMBNAIL_ASPECT = 0.75; // 3:4 clamp so tall stitched pages stay scannable in grid
const MAX_THUMBNAIL_ASPECT = 2.5; // 5:2 clamp for narrow banner strips
const DEFAULT_THUMBNAIL_ASPECT = 16 / 10;

export function estimateBase64Bytes(dataUrl?: string): number | undefined {
  if (!dataUrl) return undefined;
  const marker = ';base64,';
  const idx = dataUrl.indexOf(marker);
  if (idx === -1) return undefined;
  const payload = dataUrl.slice(idx + marker.length).trim();
  if (!payload) return undefined;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function formatFileSize(bytes?: number, fallbackDataUrl?: string): string | null {
  const resolved = typeof bytes === 'number' && bytes > 0 ? bytes : estimateBase64Bytes(fallbackDataUrl);
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved <= 0) {
    return null;
  }

  if (resolved < 1024) {
    return `${Math.round(resolved)} B`;
  }

  const kb = resolved / 1024;
  if (kb < 100) {
    const formatted = kb.toFixed(1).replace(/\.0$/, '');
    return `${formatted} KB`;
  }

  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }

  const mb = kb / 1024;
  const formatted = mb.toFixed(1).replace(/\.0$/, '');
  return `${formatted} MB`;
}

export function formatDimensions(width?: number, height?: number): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return `${Math.round(width)}×${Math.round(height)}`;
}

export function formatCaptureReadout(item: HistoryItem, resolvedFullDataUrl?: string | null): string {
  const parts: string[] = [];
  const dims = formatDimensions(item.width, item.height);
  if (dims) parts.push(dims);
  parts.push((item.format || 'png').toUpperCase());
  const size = formatFileSize(item.fileSizeBytes, resolvedFullDataUrl || item.dataUrl);
  if (size) parts.push(size);
  return parts.join(' · ');
}

export function formatProofStamp(item: HistoryItem): string | null {
  return item.proofSigned ? 'ECDSA · VERIFIED' : null;
}

export function safeHostname(url?: string): string {
  if (!url) return 'Local file';
  try {
    const parsed = new URL(url);
    return parsed.hostname || 'Local file';
  } catch {
    return 'Local file';
  }
}

export function getModeLabel(mode: CaptureMode): string {
  return MODE_LABELS[mode] || mode;
}

export function computeAspectRatio(width?: number, height?: number): number {
  if (!width || !height || width <= 0 || height <= 0) {
    return DEFAULT_THUMBNAIL_ASPECT;
  }
  const raw = width / height;
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_THUMBNAIL_ASPECT;
  return Math.min(MAX_THUMBNAIL_ASPECT, Math.max(MIN_THUMBNAIL_ASPECT, raw));
}

export function formatTimestamp(ts: number, now: number = Date.now()): { short: string; full: string } {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return { short: '—', full: '—' };
  }
  const nowDate = new Date(now);
  const sameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const full = `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} · ${time}`;
  return {
    short: sameDay ? time : `${day} · ${time}`,
    full,
  };
}

export function computeLibrarySummary(history: HistoryItem[]): LibrarySummary {
  const modeCounts: Partial<Record<CaptureMode, number>> = {};
  let signedCount = 0;
  let totalBytes = 0;
  let latestTimestamp: number | null = null;

  for (const item of history) {
    modeCounts[item.mode] = (modeCounts[item.mode] || 0) + 1;
    if (item.proofSigned) signedCount += 1;
    const itemBytes = item.fileSizeBytes ?? estimateBase64Bytes(item.dataUrl) ?? 0;
    if (itemBytes > 0) totalBytes += itemBytes;
    if (latestTimestamp === null || item.timestamp > latestTimestamp) {
      latestTimestamp = item.timestamp;
    }
  }

  return {
    totalCount: history.length,
    signedCount,
    totalBytes,
    latestTimestamp,
    modeCounts,
  };
}

export function filterHistoryItems(
  history: HistoryItem[],
  query: string,
  filter: GalleryFilter
): HistoryItem[] {
  let list = history;

  if (filter === 'signed') {
    list = list.filter((item) => Boolean(item.proofSigned));
  } else if (filter !== 'all') {
    list = list.filter((item) => item.mode === filter);
  }

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return list;

  return list.filter((item) => {
    const modeLabel = getModeLabel(item.mode).toLowerCase();
    return (
      (item.title && item.title.toLowerCase().includes(trimmed)) ||
      (item.url && item.url.toLowerCase().includes(trimmed)) ||
      item.mode.toLowerCase().includes(trimmed) ||
      modeLabel.includes(trimmed) ||
      (item.proofKeyId && item.proofKeyId.toLowerCase().includes(trimmed)) ||
      (item.ocrText && item.ocrText.toLowerCase().includes(trimmed))
    );
  });
}

export function buildProvenanceTimeline(item: HistoryItem): ProvenanceEvent[] {
  const events: ProvenanceEvent[] = [
    {
      id: `${item.id}-capture`,
      kind: 'capture',
      label: item.mode === 'upload' ? 'Imported locally' : 'Captured',
      detail: `${getModeLabel(item.mode)} · ${(item.format || 'png').toUpperCase()}${
        item.viewport ? ` · ${item.viewport.width}×${item.viewport.height} @ ${item.viewport.dpr}x` : ''
      }`,
      timestamp: item.timestamp,
    },
  ];

  const host = safeHostname(item.url);
  if (item.url && host !== 'Local file') {
    events.push({
      id: `${item.id}-origin`,
      kind: 'origin',
      label: 'Source origin',
      detail: host,
    });
  }

  if (item.proofSigned) {
    events.push({
      id: `${item.id}-proof`,
      kind: 'proof',
      label: 'ECDSA P-256 signature',
      detail: item.proofKeyId ? `Signed by ${item.proofKeyId}` : 'Signed with local device key',
      timestamp: item.timestamp,
    });
  }

  if (item.ocrText && item.ocrText.trim().length > 0) {
    events.push({
      id: `${item.id}-ocr`,
      kind: 'ocr',
      label: 'Offline OCR index',
      detail: `${item.ocrText.length} chars indexed locally`,
    });
  }

  if (item.warning) {
    events.push({
      id: `${item.id}-warning`,
      kind: 'warning',
      label: 'Capture notice',
      detail: item.warning,
    });
  }

  return events;
}

export function formatSaveDestinationSummary(
  settings: CaptureSettings,
  folderStatusState: FolderAccessState
): { label: string; detail: string } {
  if (settings.saveLocationMode === 'folder') {
    const folderName = settings.customSaveFolderName || 'Custom folder';
    const detail =
      folderStatusState === 'ready'
        ? 'Connected and writable'
        : folderStatusState === 'needs_permission'
        ? 'Permission check required'
        : folderStatusState === 'not_found'
        ? 'Drive or folder offline'
        : 'Select folder in settings';
    return { label: folderName, detail };
  }
  if (settings.saveLocationMode === 'ask') {
    return { label: 'Ask each save', detail: 'System save dialog on capture' };
  }
  return { label: 'Downloads', detail: 'Default Chrome downloads folder' };
}

export const POPUP_CAPTURE_DELAYS = [0, 3, 5, 10] as const;

export function formatDelayLabel(sec: number): string {
  return sec === 0 ? 'Off' : `${sec}s`;
}

export function formatPopupSaveDestination(
  mode: SaveLocationMode = 'downloads',
  customFolderName: string = '',
  folderStatus: FolderAccessState = 'unset'
): { label: string; needsAttention: boolean } {
  if (mode === 'ask') {
    return { label: 'Ask each save', needsAttention: false };
  }
  if (mode === 'folder') {
    const name = customFolderName.trim();
    if (!name && folderStatus === 'unset') {
      return { label: 'Select folder', needsAttention: true };
    }
    const base = name || 'Custom folder';
    if (folderStatus === 'needs_permission') {
      return { label: `${base} · Grant access`, needsAttention: true };
    }
    if (folderStatus === 'not_found') {
      return { label: `${base} · Offline`, needsAttention: true };
    }
    return { label: base, needsAttention: false };
  }
  return { label: 'Downloads', needsAttention: false };
}

export function formatPopupProofStatus(
  enableProof: boolean = true,
  proofKeyId?: string
): { active: boolean; label: string; detail: string } {
  if (enableProof) {
    return {
      active: true,
      label: 'Proof on',
      detail: proofKeyId || 'ECDSA P-256',
    };
  }
  return {
    active: false,
    label: 'Proof off',
    detail: 'Signing paused',
  };
}

export function formatProofVerdict(result: ProofVerificationResult): {
  tone: 'valid' | 'error' | 'neutral';
  headline: string;
  stamp: string;
} {
  if (result.status === 'authentic') {
    if (result.isDerivative) {
      return { tone: 'valid', headline: 'Verified derivative', stamp: 'ECDSA · DERIVATIVE' };
    }
    return { tone: 'valid', headline: 'Verified', stamp: 'ECDSA · VERIFIED' };
  }
  if (result.status === 'tampered') {
    return { tone: 'error', headline: 'Altered after signing', stamp: 'ECDSA · ALTERED' };
  }
  if (result.status === 'invalid_signature') {
    return { tone: 'error', headline: 'Invalid signature', stamp: 'ECDSA · INVALID' };
  }
  return { tone: 'neutral', headline: 'Unverified', stamp: 'UNSIGNED' };
}

const MEDIA_CATEGORY_LABELS: Record<YoinkMediaCategory, string> = {
  img: 'Image',
  svg: 'Vector',
  bg: 'CSS BG',
  video: 'Video frame',
  og: 'Social',
  canvas: 'Canvas',
};

export function formatMediaStamp(item: YoinkedMediaItem): string {
  const parts: string[] = [];
  if (item.width > 0 && item.height > 0) {
    parts.push(`${Math.round(item.width)}×${Math.round(item.height)}`);
  }
  if (item.format && item.format !== 'unknown') {
    parts.push(item.format.toUpperCase());
  }
  parts.push(MEDIA_CATEGORY_LABELS[item.category] || item.category);
  return parts.join(' · ');
}

export function formatViewportFrameHeader(res: ResolutionConfig, zoomPercent: number = 100): string {
  return `(${Math.round(res.width)} × ${Math.round(res.height)}) ${Math.round(zoomPercent)}%`;
}

export type SettingsTabId = 'capture' | 'files' | 'proof' | 'shortcuts';

export interface SettingsTabMeta {
  id: SettingsTabId;
  label: string;
  summary: string;
}

export const SETTINGS_TABS: readonly SettingsTabMeta[] = [
  { id: 'capture', label: 'Capture', summary: 'Format, scale, timing, and page handling' },
  { id: 'files', label: 'Files', summary: 'Save destination, automation, and filename pattern' },
  { id: 'proof', label: 'Proof', summary: 'ECDSA signing, creator handle, and device key' },
  { id: 'shortcuts', label: 'Shortcuts', summary: 'Keyboard bindings and local OCR engine' },
] as const;

export function resolveInitialSettingsTab(highlightFolderPicker?: boolean): SettingsTabId {
  return highlightFolderPicker ? 'files' : 'capture';
}

export function getNextSettingsTab(current: SettingsTabId, key: string): SettingsTabId | null {
  const index = SETTINGS_TABS.findIndex((tab) => tab.id === current);
  if (index === -1) return null;

  if (key === 'ArrowRight') {
    return SETTINGS_TABS[(index + 1) % SETTINGS_TABS.length].id;
  }
  if (key === 'ArrowLeft') {
    return SETTINGS_TABS[(index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length].id;
  }
  if (key === 'Home') {
    return SETTINGS_TABS[0].id;
  }
  if (key === 'End') {
    return SETTINGS_TABS[SETTINGS_TABS.length - 1].id;
  }
  return null;
}
