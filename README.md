# Yoink 📸

**Professional Full Page, Visible Viewport, Selection, and Multi-Tab Screenshot Extension for Google Chrome (Manifest V3).**

Yoink is a fast, local-first screen capture tool designed for designers, developers, researchers, and everyday power users. It performs image stitching and processing in the browser using Chrome's Offscreen Document API—no external servers and no tracking.

---

## ✨ Features

- **📜 Full Page Scrolling Capture:** Automatically scrolls through complex or tall web pages, hides floating/sticky headers after the first viewport, and automatically segments oversized captures into multi-part outputs up to browser safety limits.
- **👁️ Visible Viewport Capture:** Instant one-click capture of what is currently on screen.
- **✂️ Interactive Region Selection:** Drag-and-drop crop box with real-time pixel dimension counters, 8-point resize handles, and quick keyboard triggers.
- **📑 Multi-Tab Window Capture:** Captures eligible open website tabs in your current browser window or across all open windows in sequence, with a per-tab completion report.
- **📱 Responsive Multi-Resolution Capture:** Automatically captures target pages across mobile, tablet, and desktop viewports (e.g. iPhone, iPad, Desktop).
- **🔗 Batch URL Capture:** Input a list of URLs to capture automated full-page or viewport snapshots in batch.
- **🖼️ Built-in Gallery Hub:** Full-tab gallery to review, zoom, redact (pixelate or solid blackout), verify cryptographic Proof integrity, copy directly to clipboard as PNG, or batch-download your captures.
- **🔒 100% Private & Local:** All stitching, cropping, annotations, encoding, OCR, and settings stay locally on your device. No screenshots or URLs leave your computer.

---

## ⌨️ Default Keyboard Shortcuts

| Action | Windows / Linux | macOS |
| :--- | :--- | :--- |
| **Capture Entire Page** | `Alt + Shift + 1` | `Option + Shift + 1` |
| **Capture Visible Viewport** | `Alt + Shift + 3` | `Option + Shift + 3` |
| **Capture Selection Area** | `Alt + Shift + 4` | `Option + Shift + 4` |

*(Shortcuts can also be customized at `chrome://extensions/shortcuts`)*

---

## 🚀 Installation (Load Unpacked in Chrome)

You can load Yoink directly into Google Chrome or any Chromium-based browser (Brave, Edge, Arc, Opera):

1. Clone or download this repository:
   ```bash
   git clone https://github.com/AccurateTLM13/yoink.git
   cd yoink
   ```
2. Install dependencies and build the extension:
   ```bash
   npm install
   npm run build
   ```
3. Open your browser and navigate to:
   ```text
   chrome://extensions
   ```
4. Enable **Developer mode** using the toggle switch in the top-right corner.
5. Click the **Load unpacked** button in the top-left corner.
6. Select the **`dist`** folder inside the `yoink` project directory.
7. Click the extension puzzle icon in your Chrome toolbar and pin **Yoink** for quick access!

---

## 🛠️ Development & Building

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Scripts

- **`npm run dev`** - Starts Vite development server with Hot Module Replacement (HMR) for testing UI components.
- **`npm run build`** - Builds the production extension into the `dist/` directory.
- **`npm run lint`** - Runs TypeScript compiler check (`tsc --noEmit`).
- **`npm test`** - Runs unit and reliability test suites.
- **`npm run pack`** - Builds the extension and packages the `dist/` folder into an upload-ready `yoink.zip` archive.

---

## 🏗️ Architecture & Tech Stack

- **Framework:** React 19 + TypeScript
- **Styling:** Tailwind CSS + Lucide Icons
- **Bundler:** Vite
- **Extension Standard:** Manifest V3 (MV3)
  - **Service Worker (`background.js`):** Coordinates messaging, active tab capture, and window cycling.
  - **Content Script (`content.js`):** Injected on-demand for scroll orchestration and selection overlay.
  - **Offscreen Document (`offscreen.js` / `offscreen.html`):** Offloads multi-megabyte canvas stitching, format conversion (PNG, JPEG, WebP), and cropping off the main thread.
  - **Storage (`chrome.storage.local` with `unlimitedStorage`):** Safely persists capture history and custom templates without hitting browser storage quotas.

---

## 🛡️ Privacy Policy

Yoink does **not** collect, store, or transmit any personal data, browsing history, or captured images. All screenshots are generated and stored locally in your browser's extension storage and your local Downloads directory.

---

## 📄 License

No license file is currently included in this repository.
