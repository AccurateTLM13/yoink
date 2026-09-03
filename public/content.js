// content.js - Yoink Content Script

(function () {
  if (window.__YOINK_CONTENT_INITIALIZED__) return;
  window.__YOINK_CONTENT_INITIALIZED__ = true;

  let isSelecting = false;
  let startX = 0;
  let startY = 0;
  let overlayEl = null;
  let cropBoxEl = null;
  let sizeBadgeEl = null;
  let toolbarEl = null;
  let isDraggingBox = false;
  let isResizing = false;
  let currentHandle = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialRect = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_SCROLL_CAPTURE') {
      startScrollCapture(message.payload?.scrollDelay || 600, message.payload?.hideSticky !== false);
      sendResponse({ started: true });
      return true;
    }

    if (message.action === 'START_SELECTION_CAPTURE') {
      initSelectionOverlay();
      sendResponse({ started: true });
      return true;
    }
  });

  /**
   * 1. Full Page Scroll & Stitch Capture Engine
   */
  async function startScrollCapture(scrollDelay = 600, hideSticky = true) {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // Hide scrollbars

    // Suppress fixed/sticky headers during scrolling to prevent visual artifacts
    let originalStyles = [];
    if (hideSticky) {
      const fixedElements = Array.from(document.querySelectorAll('*')).filter((el) => {
        const style = window.getComputedStyle(el);
        return style.position === 'fixed' || style.position === 'sticky';
      });

      originalStyles = fixedElements.map((el) => {
        const orig = el.style.position;
        el.style.position = 'absolute';
        return { el, orig };
      });
    }

    const viewportHeight = window.innerHeight;
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );
    let currentTop = 0;
    const chunks = [];

    // Scroll to top to begin
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));

    while (currentTop < totalHeight) {
      // Request background script to capture the visible tab
      const response = await chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' });
      if (response && response.dataUrl) {
        chunks.push({
          dataUrl: response.dataUrl,
          yOffset: currentTop,
        });
      }

      currentTop += viewportHeight;
      if (currentTop >= totalHeight) break;

      window.scrollTo(0, currentTop);

      // Pause for lazy-loading to catch up
      await new Promise((r) => setTimeout(r, scrollDelay));
    }

    // Restore original styles
    document.body.style.overflow = originalOverflow;
    originalStyles.forEach(({ el, orig }) => {
      el.style.position = orig;
    });

    // Send chunks to Offscreen document for stitching
    await chrome.runtime.sendMessage({
      action: 'FINALIZE_STITCHING',
      payload: {
        chunks,
        totalWidth: window.innerWidth,
        totalHeight,
        title: document.title,
        url: window.location.href,
      },
    });
  }

  /**
   * 2. Interactive Area Selection Overlay
   */
  function initSelectionOverlay() {
    removeSelectionOverlay();

    // Root overlay container
    overlayEl = document.createElement('div');
    overlayEl.id = 'omnicapture-selection-overlay';
    Object.assign(overlayEl.style, {
      position: 'fixed',
      top: '0px',
      left: '0px',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483647',
      cursor: 'crosshair',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
      boxSizing: 'border-box',
    });

    // Instruction banner at top
    const banner = document.createElement('div');
    Object.assign(banner.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: '#18181b',
      color: '#f4f4f5',
      padding: '8px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
      zIndex: '2147483648',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });
    banner.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;"></span>
      Drag to select capture area • Press <kbd style="background:#3f3f46;padding:2px 6px;border-radius:4px;font-size:11px;">Enter</kbd> to capture • <kbd style="background:#3f3f46;padding:2px 6px;border-radius:4px;font-size:11px;">Esc</kbd> to cancel
    `;
    overlayEl.appendChild(banner);

    // Crop Box
    cropBoxEl = document.createElement('div');
    cropBoxEl.id = 'omnicapture-crop-box';
    Object.assign(cropBoxEl.style, {
      position: 'fixed',
      display: 'none',
      border: '2px solid #3b82f6',
      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
      cursor: 'move',
      boxSizing: 'border-box',
      zIndex: '2147483648',
    });

    // Size Badge
    sizeBadgeEl = document.createElement('div');
    Object.assign(sizeBadgeEl.style, {
      position: 'absolute',
      top: '-28px',
      left: '0px',
      backgroundColor: '#3b82f6',
      color: '#ffffff',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    cropBoxEl.appendChild(sizeBadgeEl);

    // Floating Action Toolbar
    toolbarEl = document.createElement('div');
    Object.assign(toolbarEl.style, {
      position: 'absolute',
      bottom: '-42px',
      right: '0px',
      display: 'flex',
      gap: '6px',
      backgroundColor: '#18181b',
      padding: '4px 6px',
      borderRadius: '6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      zIndex: '2147483649',
    });

    const captureBtn = createButton('✓ Capture', '#3b82f6', '#ffffff', () => finalizeSelectionCapture());
    const cancelBtn = createButton('✕ Cancel', '#3f3f46', '#e4e4e7', () => removeSelectionOverlay());

    toolbarEl.appendChild(captureBtn);
    toolbarEl.appendChild(cancelBtn);
    cropBoxEl.appendChild(toolbarEl);

    // Add 8 resize handles
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    handles.forEach((h) => {
      const handleEl = document.createElement('div');
      handleEl.className = `omnicapture-handle omnicapture-handle-${h}`;
      Object.assign(handleEl.style, {
        position: 'absolute',
        width: '10px',
        height: '10px',
        backgroundColor: '#ffffff',
        border: '2px solid #3b82f6',
        borderRadius: '2px',
        zIndex: '2147483649',
        cursor: `${h}-resize`,
      });

      if (h.includes('n')) handleEl.style.top = '-6px';
      if (h.includes('s')) handleEl.style.bottom = '-6px';
      if (h.includes('w')) handleEl.style.left = '-6px';
      if (h.includes('e')) handleEl.style.right = '-6px';
      if (h === 'n' || h === 's') handleEl.style.left = 'calc(50% - 5px)';
      if (h === 'w' || h === 'e') handleEl.style.top = 'calc(50% - 5px)';

      handleEl.addEventListener('mousedown', (e) => onHandleMouseDown(e, h));
      cropBoxEl.appendChild(handleEl);
    });

    overlayEl.appendChild(cropBoxEl);
    document.documentElement.appendChild(overlayEl);

    // Mouse & Keyboard Event Listeners
    overlayEl.addEventListener('mousedown', onOverlayMouseDown);
    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('keydown', onKeyDown);
  }

  function createButton(text, bg, color, onClick) {
    const btn = document.createElement('button');
    btn.innerText = text;
    Object.assign(btn.style, {
      backgroundColor: bg,
      color: color,
      border: 'none',
      padding: '4px 10px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '600',
      fontFamily: 'system-ui, sans-serif',
      cursor: 'pointer',
      outline: 'none',
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function onOverlayMouseDown(e) {
    if (e.target.closest('#omnicapture-crop-box')) {
      // Clicked inside crop box -> start dragging box
      if (!e.target.classList.contains('omnicapture-handle') && !e.target.closest('button')) {
        isDraggingBox = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = cropBoxEl.getBoundingClientRect();
        initialRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }
      return;
    }

    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    cropBoxEl.style.display = 'block';
    updateCropBox(startX, startY, 0, 0);
  }

  function onHandleMouseDown(e, handle) {
    e.stopPropagation();
    isResizing = true;
    currentHandle = handle;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = cropBoxEl.getBoundingClientRect();
    initialRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function onGlobalMouseMove(e) {
    if (isSelecting) {
      const currentX = e.clientX;
      const currentY = e.clientY;
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      updateCropBox(x, y, width, height);
    } else if (isDraggingBox && initialRect) {
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      const newLeft = Math.max(0, Math.min(window.innerWidth - initialRect.width, initialRect.left + deltaX));
      const newTop = Math.max(0, Math.min(window.innerHeight - initialRect.height, initialRect.top + deltaY));
      updateCropBox(newLeft, newTop, initialRect.width, initialRect.height);
    } else if (isResizing && initialRect) {
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      let { left, top, width, height } = initialRect;

      if (currentHandle.includes('e')) width += deltaX;
      if (currentHandle.includes('s')) height += deltaY;
      if (currentHandle.includes('w')) {
        left += deltaX;
        width -= deltaX;
      }
      if (currentHandle.includes('n')) {
        top += deltaY;
        height -= deltaY;
      }

      if (width > 20 && height > 20) {
        updateCropBox(left, top, width, height);
      }
    }
  }

  function onGlobalMouseUp() {
    if (isSelecting) {
      isSelecting = false;
      const rect = cropBoxEl.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        cropBoxEl.style.display = 'none';
      }
    }
    isDraggingBox = false;
    isResizing = false;
    currentHandle = null;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      removeSelectionOverlay();
    } else if (e.key === 'Enter') {
      finalizeSelectionCapture();
    }
  }

  function updateCropBox(x, y, width, height) {
    if (!cropBoxEl) return;
    cropBoxEl.style.left = `${x}px`;
    cropBoxEl.style.top = `${y}px`;
    cropBoxEl.style.width = `${width}px`;
    cropBoxEl.style.height = `${height}px`;

    if (sizeBadgeEl) {
      const dpr = window.devicePixelRatio || 1;
      sizeBadgeEl.innerText = `${Math.round(width * dpr)} × ${Math.round(height * dpr)} px`;
      if (y < 35) {
        sizeBadgeEl.style.top = '4px';
        sizeBadgeEl.style.left = '4px';
      } else {
        sizeBadgeEl.style.top = '-28px';
        sizeBadgeEl.style.left = '0px';
      }
    }

    if (toolbarEl) {
      if (y + height + 50 > window.innerHeight) {
        toolbarEl.style.bottom = '8px';
        toolbarEl.style.right = '8px';
      } else {
        toolbarEl.style.bottom = '-42px';
        toolbarEl.style.right = '0px';
      }
    }
  }

  async function finalizeSelectionCapture() {
    if (!cropBoxEl || cropBoxEl.style.display === 'none') {
      removeSelectionOverlay();
      return;
    }

    const rect = cropBoxEl.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      removeSelectionOverlay();
      return;
    }

    const bounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      dpr: window.devicePixelRatio || 1,
      title: document.title,
      url: window.location.href,
    };

    // Remove overlay before capture so it's not visible in screenshot
    removeSelectionOverlay();

    // Wait 100ms for overlay repaint
    await new Promise((r) => setTimeout(r, 100));

    // Request background to capture visible tab and crop to bounds
    chrome.runtime.sendMessage({
      action: 'CAPTURE_SELECTION_FINISH',
      payload: bounds,
    });
  }

  function removeSelectionOverlay() {
    window.removeEventListener('mousemove', onGlobalMouseMove);
    window.removeEventListener('mouseup', onGlobalMouseUp);
    window.removeEventListener('keydown', onKeyDown);

    const existing = document.getElementById('omnicapture-selection-overlay');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    overlayEl = null;
    cropBoxEl = null;
    sizeBadgeEl = null;
    toolbarEl = null;
    isSelecting = false;
    isDraggingBox = false;
    isResizing = false;
  }
})();
