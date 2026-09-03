/**
 * Yoink Type Definitions
 */

export type CaptureFormat = 'png' | 'jpeg' | 'webp';
export type CaptureMode = 'visible' | 'full' | 'selection' | 'multisize' | 'alltabs' | 'urllist';

export interface CaptureSettings {
  format: CaptureFormat;
  quality: number; // 0.1 to 1.0 (for jpeg/webp)
  scrollDelayMs: number; // ms to pause per scroll step (for full page)
  hideStickyElements: boolean;
  autoDownload: boolean;
  copyToClipboard: boolean;
  filenameTemplate: string; // e.g. "omnicapture_{title}_{date}_{time}"
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
