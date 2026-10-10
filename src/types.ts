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
  fileSizeBytes?: number;
  ocrText?: string;
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
