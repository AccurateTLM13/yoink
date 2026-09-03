import { CaptureFormat, CaptureMode, CaptureSettings, HistoryItem, ResolutionConfig } from '../types';
import { addHistoryItem, downloadDataUrl } from './storage';

/**
 * Checks if running inside an actual Chrome Extension environment with permissions.
 */
export function isChromeExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.sendMessage && !!chrome.tabs;
}

/**
 * Format filename using user template tokens.
 */
export function formatFilename(
  template: string,
  title: string,
  url: string,
  mode: CaptureMode,
  format: CaptureFormat
): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
  
  let domain = 'page';
  try {
    if (url) domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
  } catch {
    // fallback
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

/**
 * Generates an SVG/Canvas mock screenshot for standalone browser preview mode.
 */
export function generateMockScreenshot(
  mode: CaptureMode,
  title: string,
  width: number = 1200,
  height: number = 800,
  format: CaptureFormat = 'png'
): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve('');

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Browser mock window frame
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(40, 40, width - 80, height - 80);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, width - 80, height - 80);

    // Window controls
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(70, 70, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.arc(95, 70, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(120, 70, 8, 0, Math.PI * 2);
    ctx.fill();

    // Title / URL bar
    ctx.fillStyle = '#27273a';
    ctx.fillRect(150, 56, width - 240, 28);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText(`Yoink Preview // ${title} [${mode.toUpperCase()}]`, 170, 75);

    // Content Mockup
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(`Captured: ${title}`, 80, 160);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px sans-serif';
    ctx.fillText(`Mode: ${mode.toUpperCase()}  |  Resolution: ${width} × ${height}px  |  Format: ${format.toUpperCase()}`, 80, 200);

    // Grid mock lines
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    for (let y = 240; y < height - 100; y += 40) {
      ctx.beginPath();
      ctx.moveTo(80, y);
      ctx.lineTo(width - 80, y);
      ctx.stroke();
    }

    // Badge
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(80, height - 100, 260, 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('OMNICAPTURE PRO VERIFIED', 100, height - 76);

    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    resolve(canvas.toDataURL(mime, 0.95));
  });
}

/**
 * Capture Visible Viewport
 */
export async function captureVisible(settings: CaptureSettings): Promise<HistoryItem> {
  const title = typeof document !== 'undefined' ? document.title : 'Page';
  const url = typeof window !== 'undefined' ? window.location.href : 'https://example.com';

  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
          return reject(new Error('No active tab found.'));
        }

        chrome.runtime.sendMessage(
          {
            action: 'CAPTURE_VISIBLE_PART',
            payload: {
              tabId: activeTab.id,
              windowId: activeTab.windowId,
              title: activeTab.title || 'Visible Viewport',
              url: activeTab.url || '',
              settings,
            },
          },
          async (response) => {
            if (response?.error) {
              return reject(new Error(response.error));
            }
            if (response?.item) {
              resolve(response.item);
            } else {
              reject(new Error('No capture data returned'));
            }
          }
        );
      });
    });
  }

  // Simulated fallback in dev/browser mode
  const width = 1440;
  const height = 900;
  const dataUrl = await generateMockScreenshot('visible', 'Active Tab Viewport', width, height, settings.format);
  const item: HistoryItem = {
    id: `sim_${Date.now()}`,
    title: 'Visible Viewport (Demo)',
    url: 'https://developer.chrome.com',
    dataUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: 'visible',
    format: settings.format,
  };
  await addHistoryItem(item);
  if (settings.autoDownload) {
    const fn = formatFilename(settings.filenameTemplate, item.title, item.url, 'visible', settings.format);
    downloadDataUrl(dataUrl, fn);
  }
  return item;
}

/**
 * Capture Selection
 */
export async function captureSelection(settings: CaptureSettings): Promise<HistoryItem> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
          return reject(new Error('No active tab found.'));
        }

        chrome.runtime.sendMessage(
          {
            action: 'CAPTURE_SELECTION_START',
            payload: {
              tabId: activeTab.id,
              settings,
            },
          },
          (response) => {
            if (response?.error) {
              return reject(new Error(response.error));
            }
            // Background will trigger selection overlay in content script and close popup if needed
            resolve({
              id: `sel_${Date.now()}`,
              title: activeTab.title || 'Selected Region',
              url: activeTab.url || '',
              dataUrl: '',
              timestamp: Date.now(),
              width: 0,
              height: 0,
              mode: 'selection',
              format: settings.format,
            });
          }
        );
      });
    });
  }

  // Simulated fallback
  const width = 640;
  const height = 480;
  const dataUrl = await generateMockScreenshot('selection', 'Crop Selection Region', width, height, settings.format);
  const item: HistoryItem = {
    id: `sim_sel_${Date.now()}`,
    title: 'Selected Region (Demo)',
    url: 'https://example.com/products',
    dataUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: 'selection',
    format: settings.format,
  };
  await addHistoryItem(item);
  if (settings.autoDownload) {
    const fn = formatFilename(settings.filenameTemplate, item.title, item.url, 'selection', settings.format);
    downloadDataUrl(dataUrl, fn);
  }
  return item;
}

/**
 * Capture Entire Page (Full Scroll & Stitch)
 */
export async function captureFullPage(settings: CaptureSettings): Promise<HistoryItem> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
          return reject(new Error('No active tab found.'));
        }

        chrome.runtime.sendMessage(
          {
            action: 'CAPTURE_FULL_PAGE',
            payload: {
              tabId: activeTab.id,
              title: activeTab.title,
              url: activeTab.url,
              settings,
            },
          },
          (response) => {
            if (response?.error) {
              return reject(new Error(response.error));
            }
            resolve({
              id: `full_${Date.now()}`,
              title: activeTab.title || 'Full Page',
              url: activeTab.url || '',
              dataUrl: '',
              timestamp: Date.now(),
              width: 0,
              height: 0,
              mode: 'full',
              format: settings.format,
            });
          }
        );
      });
    });
  }

  // Simulated fallback
  const width = 1440;
  const height = 3200;
  const dataUrl = await generateMockScreenshot('full', 'Full Page Scroll Stitch', width, height, settings.format);
  const item: HistoryItem = {
    id: `sim_full_${Date.now()}`,
    title: 'Full Page Stitch (Demo)',
    url: 'https://example.com/long-article',
    dataUrl,
    timestamp: Date.now(),
    width,
    height,
    mode: 'full',
    format: settings.format,
  };
  await addHistoryItem(item);
  if (settings.autoDownload) {
    const fn = formatFilename(settings.filenameTemplate, item.title, item.url, 'full', settings.format);
    downloadDataUrl(dataUrl, fn);
  }
  return item;
}

/**
 * Capture All Tabs in Window
 */
export async function captureAllTabs(
  settings: CaptureSettings,
  onProgress?: (current: number, total: number, tabTitle: string) => void
): Promise<HistoryItem[]> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'CAPTURE_ALL_TABS',
          payload: { settings },
        },
        (response) => {
          if (response?.error) return reject(new Error(response.error));
          resolve(response?.results || []);
        }
      );
    });
  }

  // Simulated fallback
  const simulatedTabs = [
    { title: 'GitHub - Project Repo', url: 'https://github.com/project' },
    { title: 'Google Search Results', url: 'https://google.com/search' },
    { title: 'Tech Documentation', url: 'https://docs.example.com' },
  ];

  const results: HistoryItem[] = [];
  for (let i = 0; i < simulatedTabs.length; i++) {
    const tab = simulatedTabs[i];
    if (onProgress) onProgress(i + 1, simulatedTabs.length, tab.title);
    await new Promise((r) => setTimeout(r, 600));

    const dataUrl = await generateMockScreenshot('alltabs', tab.title, 1280, 800, settings.format);
    const item: HistoryItem = {
      id: `sim_tab_${Date.now()}_${i}`,
      title: tab.title,
      url: tab.url,
      dataUrl,
      timestamp: Date.now(),
      width: 1280,
      height: 800,
      mode: 'alltabs',
      format: settings.format,
    };
    await addHistoryItem(item);
    if (settings.autoDownload) {
      const fn = formatFilename(settings.filenameTemplate, item.title, item.url, 'alltabs', settings.format);
      downloadDataUrl(dataUrl, fn);
    }
    results.push(item);
  }

  return results;
}

/**
 * Capture List of URLs
 */
export async function captureUrlList(
  urls: string[],
  settings: CaptureSettings,
  delayMs: number = 3000,
  onProgress?: (current: number, total: number, url: string) => void
): Promise<HistoryItem[]> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'CAPTURE_URL_LIST',
          payload: { urls, settings, delayMs },
        },
        (response) => {
          if (response?.error) return reject(new Error(response.error));
          resolve(response?.results || []);
        }
      );
    });
  }

  // Simulated fallback
  const results: HistoryItem[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (onProgress) onProgress(i + 1, urls.length, u);
    await new Promise((r) => setTimeout(r, 800));

    const dataUrl = await generateMockScreenshot('urllist', `Batch URL ${i + 1}`, 1440, 900, settings.format);
    const item: HistoryItem = {
      id: `sim_url_${Date.now()}_${i}`,
      title: `Batch Capture ${i + 1}`,
      url: u,
      dataUrl,
      timestamp: Date.now(),
      width: 1440,
      height: 900,
      mode: 'urllist',
      format: settings.format,
    };
    await addHistoryItem(item);
    if (settings.autoDownload) {
      const fn = formatFilename(settings.filenameTemplate, item.title, item.url, 'urllist', settings.format);
      downloadDataUrl(dataUrl, fn);
    }
    results.push(item);
  }

  return results;
}

/**
 * Multi-Size Responsive Capture (Mobile, Tablet, Desktop)
 */
export async function captureMultiSize(
  resolutions: ResolutionConfig[],
  settings: CaptureSettings,
  onProgress?: (current: number, total: number, resName: string) => void
): Promise<HistoryItem[]> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.url) return reject(new Error('No active tab URL.'));

        chrome.runtime.sendMessage(
          {
            action: 'CAPTURE_MULTI_SIZE',
            payload: {
              url: activeTab.url,
              resolutions,
              settings,
            },
          },
          (response) => {
            if (response?.error) return reject(new Error(response.error));
            resolve(response?.results || []);
          }
        );
      });
    });
  }

  // Simulated fallback
  const results: HistoryItem[] = [];
  for (let i = 0; i < resolutions.length; i++) {
    const res = resolutions[i];
    if (onProgress) onProgress(i + 1, resolutions.length, res.name);
    await new Promise((r) => setTimeout(r, 700));

    const dataUrl = await generateMockScreenshot('multisize', `${res.name} (${res.width}x${res.height})`, res.width, res.height, settings.format);
    const item: HistoryItem = {
      id: `sim_ms_${Date.now()}_${i}`,
      title: `Responsive - ${res.name}`,
      url: 'https://example.com/responsive',
      dataUrl,
      timestamp: Date.now(),
      width: res.width,
      height: res.height,
      mode: 'multisize',
      format: settings.format,
    };
    await addHistoryItem(item);
    if (settings.autoDownload) {
      const fn = formatFilename(settings.filenameTemplate, item.title, item.url, 'multisize', settings.format);
      downloadDataUrl(dataUrl, fn);
    }
    results.push(item);
  }

  return results;
}

/**
 * Get current open tabs in the active window
 */
export async function getOpenTabUrls(): Promise<{ title: string; url: string }[]> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const valid = (tabs || [])
          .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'))
          .map((t) => ({ title: t.title || 'Tab', url: t.url || '' }));
        resolve(valid);
      });
    });
  }

  return [
    { title: 'Yoink Documentation', url: 'https://omnicapture.pro/docs' },
    { title: 'Google Search', url: 'https://www.google.com' },
    { title: 'Tailwind CSS Modern Guide', url: 'https://tailwindcss.com' },
    { title: 'GitHub Repository', url: 'https://github.com/google/omnicapture' },
  ];
}
