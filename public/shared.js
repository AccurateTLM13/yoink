// shared.js — Yoink Shared Utilities
// Imported by background.js (ES module service worker).
// The TypeScript counterparts in src/utils/ mirror this intentionally,
// since Vite does not process public/ files.

// ---------------------------------------------------------------------------
// Default Settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  format: 'png',
  quality: 0.92,
  scrollDelayMs: 600,
  hideStickyElements: true,
  autoDownload: true,
  copyToClipboard: false,
  filenameTemplate: '{title}_{date}_{time}',
};

// ---------------------------------------------------------------------------
// Filename Formatting
// ---------------------------------------------------------------------------

/**
 * Formats a download filename from a user-defined template.
 * Tokens: {title}, {date}, {time}, {domain}, {type}
 * @param {string} template
 * @param {string} title
 * @param {string} url
 * @param {string} mode
 * @param {string} format  - file extension (png | jpeg | webp)
 * @returns {string}
 */
export function formatFilename(template, title, url, mode, format) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0'),
  ].join('');

  let domain = 'page';
  try {
    if (url) domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
  } catch {
    // keep fallback
  }

  const cleanTitle = (title || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

  let filename = template
    .replace('{title}', cleanTitle)
    .replace('{date}', dateStr)
    .replace('{time}', timeStr)
    .replace('{domain}', domain)
    .replace('{type}', mode);

  if (!filename.toLowerCase().endsWith(`.${format}`)) {
    filename += `.${format}`;
  }

  return filename;
}

// ---------------------------------------------------------------------------
// Settings Helpers
// ---------------------------------------------------------------------------

/**
 * Loads user settings from chrome.storage.sync with DEFAULT_SETTINGS fallback.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  try {
    const res = await chrome.storage.sync.get(['omnicapture_settings']);
    return { ...DEFAULT_SETTINGS, ...(res?.omnicapture_settings || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
