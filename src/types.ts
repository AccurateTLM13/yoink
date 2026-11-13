/**
 * Yoink Type Definitions
 */
export type CaptureFormat = 'png' | 'jpeg' | 'webp';
export type CaptureMode =
  | 'visible'
  | 'full'
  | 'selection'
  | 'multisize'
  | 'alltabs'
  | 'urllist'
  | 'annotated'
  | 'upload'
  | 'element'
  | 'desktop';

export interface CaptureSettings {
  format: CaptureFormat;
  quality: number; // 0.1 to 1.0 (for jpeg/webp)
  scrollDelayMs: number; // ms to pause per scroll step (for full page)
  hideStickyElements: boolean;
  autoDownload: boolean;
  copyToClipboard: boolean;
  filenameTemplate: string; // e.g. "omnicapture_{title}_{date}_{time}"
  captureDelaySec: number; // P1-6: countdown before visible / full page capture (0 = off)
  optimalQualityMode?: boolean; // P2-10: Master toggle for maximum quality configuration
  scaleFactor?: number; // 1, 1.5, or 2 (High-DPI / Retina capture)
  autoSliceLongPages?: boolean; // Split tall captures into anti-squish chunks on download
  maxSliceHeight?: number; // Max slice height in px (e.g. 4000)
  losslessWebp?: boolean; // Lossless encoding for WebP
  enableProof?: boolean; // Yoink Proof: Embed IPTC screenCapture + ECDSA signature + LSB pixel watermark
  proofAuthor?: string; // Creator handle / name embedded in proof manifest
  proofVisualStamp?: boolean; // Optional "Receipt Mode" provenance footer bar rendered on screenshot
}

export interface YoinkProofManifest {
  v: number;
  src: string; // IPTC digitalSourceType URI (screenCapture)
  alg: 'ES256';
  kid: string; // 12-char key fingerprint (e.g. 8F3A-9C21-B40E)
  pub: string; // base64url of 65-byte raw P-256 public key
  ph: string; // base64url of SHA-256 masked pixel digest
  bh?: string; // base64url of SHA-256 encoded visual bitstream digest (invariant to metadata chunks & display color profiles)
  ts: number; // capture timestamp (ms)
  w: number; // width in px
  h: number; // height in px
  u: string; // source URL
  t: string; // page title
  a: string; // author / creator handle
  sig: string; // base64url of 64-byte ECDSA P-256 signature
}

export interface ProofVerificationResult {
  verified: boolean;
  status: 'authentic' | 'tampered' | 'unsigned' | 'invalid_signature';
  summary: string;
  hasMetadataProof: boolean;
  hasPixelWatermark: boolean;
  hasIptcScreenCapture: boolean;
  signatureValid: boolean;
  pixelsIntact: boolean;
  isOwnCapture: boolean;
  localKeyFingerprint?: string;
  manifest?: YoinkProofManifest;
}

export interface HistoryItem {
  id: string;
  title: string;
  url: string;
  dataUrl: string;
  thumbnailUrl?: string;
  timestamp: number;
  width: number;
  height: number;
  mode: CaptureMode;
  format: CaptureFormat;
  viewport?: { width: number; height: number; dpr: number; requestedWidth: number; requestedHeight: number };
  fileSizeBytes?: number;
  ocrText?: string;
  proofKeyId?: string;
  proofSigned?: boolean;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

export interface ResolutionConfig {
  name: string;
  width: number;
  height: number;
}

export interface BatchUrlItem {
  url: string;
  status: 'pending' | 'capturing' | 'completed' | 'failed';
  error?: string;
  dataUrl?: string;
}

export interface CaptureProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  message: string;
  percent?: number;
  currentStep?: number;
  totalSteps?: number;
}

export type AnnotationTool =
  | 'select'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'blur';

export interface AnnotationItem {
  id: string;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  points?: { x: number; y: number }[];
  text?: string;
  fontSize?: number;
  fill?: boolean;
}

export interface BatchIssue { target: string; reason: string; tabId?: number }
export interface BatchOutcome { failures: BatchIssue[]; skipped: BatchIssue[] }
