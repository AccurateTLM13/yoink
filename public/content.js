/* jshint esversion: 11, expr: true */
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
  let captureInProgress = false;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_SCROLL_CAPTURE') {
      if (captureInProgress) {
        sendResponse({ started: false, error: 'Capture already running' });
        return false;
      }
      startScrollCapture(message.payload?.scrollDelay || 600, message.payload?.hideSticky !== false);
      sendResponse({ started: true });
      return false;
    }

    if (message.action === 'START_SELECTION_CAPTURE') {
      initSelectionOverlay();
      sendResponse({ started: true });
      return true;
    }

    if (message.action === 'START_ELEMENT_SCROLL_CAPTURE') {
      initElementInspector(message.payload?.scrollDelay || 600);
      sendResponse({ started: true });
      return true;
    }
  });

  /**
   * Detect the primary inner scrollable container on modern SPAs (e.g., Notion, Linear, Slack, dashboards)
   * when the document root itself does not scroll.
   */
  function findPrimaryScrollContainer() {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const candidates = new Set();

    // 1. Check ancestor chain from center of viewport
    if (typeof document.elementFromPoint === 'function') {
      try {
        let centerEl = document.elementFromPoint(Math.floor(vw / 2), Math.floor(vh / 2));
        while (centerEl && centerEl !== document.body && centerEl !== document.documentElement) {
          candidates.add(centerEl);
          centerEl = centerEl.parentElement;
        }
      } catch { }
    }

    // 2. Query common SPA scroll containers
    try {
      const queried = document.querySelectorAll(
        'main, [role="main"], article, [class*="scroll" i], [class*="content" i], [class*="container" i], [class*="workspace" i], div, section'
      );
      for (const el of Array.from(queried)) {
        if (el && el !== document.body && el !== document.documentElement) {
          candidates.add(el);
        }
      }
    } catch { }

    let bestEl = null;
    let bestScore = 0;

    for (const el of candidates) {
      try {
        const sh = Number(el.scrollHeight) || 0;
        const ch = Number(el.clientHeight) || 0;
        if (sh <= ch + 15) continue;

        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style) {
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const oy = style.overflowY;
          if (oy && oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
        }

        const rect = el.getBoundingClientRect
          ? el.getBoundingClientRect()
          : { width: vw, height: vh, left: 0, top: 0 };
        if (rect.width < vw * 0.4 || rect.height < vh * 0.4) continue;

        const areaScore = rect.width * rect.height * (sh / Math.max(1, ch));
        if (areaScore > bestScore) {
          bestScore = areaScore;
          bestEl = el;
        }
      } catch { }
    }

    return bestEl;
  }

  /**
   * 1. Full Page Scroll & Stitch Capture Engine
   */
  async function startScrollCapture(scrollDelay = 600, hideSticky = true) {
    captureInProgress = true;
    const origScrollX = window.scrollX;
    const origScrollY = window.scrollY;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // Hide scrollbars

    const candidateSelector =
      'header, nav, aside, [class*="header" i], [class*="nav" i], [class*="sticky" i], [class*="fixed" i], [style*="fixed"], [style*="sticky"], [data-sticky], [data-fixed]';
    const hiddenStickyEls = new Map();

    function suppressStickyElements() {
      if (!hideSticky) return;
      const candidates = new Set([
        ...Array.from(document.querySelectorAll(candidateSelector)),
        ...Array.from(document.body.children || []),
      ]);

      for (const el of candidates) {
        if (!el || el === document.body || el === document.documentElement || hiddenStickyEls.has(el)) {
          continue;
        }
        try {
          const pos = window.getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'sticky') {
            hiddenStickyEls.set(el, {
              visVal: el.style.getPropertyValue ? el.style.getPropertyValue('visibility') : el.style.visibility || '',
              visPrio: el.style.getPropertyPriority ? el.style.getPropertyPriority('visibility') : '',
              peVal: el.style.getPropertyValue ? el.style.getPropertyValue('pointer-events') : '',
              pePrio: el.style.getPropertyPriority ? el.style.getPropertyPriority('pointer-events') : '',
            });
            if (el.style.setProperty) {
              el.style.setProperty('visibility', 'hidden', 'important');
              el.style.setProperty('pointer-events', 'none', 'important');
            } else {
              el.style.visibility = 'hidden';
            }
          }
        } catch {
          // Ignore inaccessible nodes
        }
      }
    }

    function restoreStickyElements() {
      for (const [el, orig] of hiddenStickyEls.entries()) {
        try {
          if (el.style.setProperty && el.style.removeProperty) {
            if (orig.visVal) el.style.setProperty('visibility', orig.visVal, orig.visPrio);
            else el.style.removeProperty('visibility');

            if (orig.peVal) el.style.setProperty('pointer-events', orig.peVal, orig.pePrio);
            else el.style.removeProperty('pointer-events');
          } else {
            el.style.visibility = orig.visVal;
          }
        } catch {
          // Ignore detached nodes
        }
      }
      hiddenStickyEls.clear();
    }

    const viewportHeight = window.innerHeight;
    const rootHeight = Math.max(
      document.body.scrollHeight || 0,
      document.documentElement.scrollHeight || 0,
      document.body.offsetHeight || 0,
      document.documentElement.offsetHeight || 0
    );

    // Auto-detect inner scroll container on SPAs where root window does not scroll
    const innerContainer = rootHeight <= viewportHeight + 10 ? findPrimaryScrollContainer() : null;
    const origInnerScrollTop = innerContainer ? innerContainer.scrollTop : 0;
    const origInnerOverflow = innerContainer && innerContainer.style ? innerContainer.style.overflow : '';

    const stepHeight = innerContainer ? innerContainer.clientHeight || viewportHeight : viewportHeight;
    let totalHeight = innerContainer ? Math.max(innerContainer.scrollHeight, stepHeight) : rootHeight;
    let maxScroll = Math.max(0, totalHeight - stepHeight);
    let currentTop = 0;
    const chunks = [];

    const getScrollY = () =>
      innerContainer ? innerContainer.scrollTop || 0 : window.scrollY || document.documentElement.scrollTop || 0;

    const setScrollY = (y) => {
      if (innerContainer) {
        innerContainer.scrollTop = y;
      } else {
        window.scrollTo(0, y);
      }
    };

    // Scroll to top to begin
    setScrollY(0);
    await new Promise((r) => setTimeout(r, 400));

    try {
      while (true) {
        const actualY = getScrollY();

        // After chunk 0 is captured at the top of the page, hide fixed/sticky elements
        // via visibility:hidden so they render naturally on chunk 0 without layout breakage
        // and never duplicate on chunks 1..N.
        if (chunks.length > 0 && hideSticky) {
          suppressStickyElements();
        }

        // Request background script to capture the visible tab and stream chunk to offscreen canvas
        const response = await chrome.runtime
          .sendMessage({
            action: 'CAPTURE_VISIBLE_TAB',
            payload: {
              index: chunks.length,
              yOffset: actualY,
              kind: 'full',
              totalWidth: window.innerWidth,
              totalHeight,
              dpr: window.devicePixelRatio || 1,
            },
          })
          .catch(() => null);
        if (response && response.ok) {
          chunks.push({
            index: response.index,
            yOffset: actualY,
          });
        }

        // Refresh totalHeight & maxScroll in case lazy-loaded content expanded the page
        totalHeight = innerContainer
          ? Math.max(totalHeight, innerContainer.scrollHeight || 0, stepHeight)
          : Math.max(
            totalHeight,
            document.body.scrollHeight || 0,
            document.documentElement.scrollHeight || 0,
            document.body.offsetHeight || 0,
            document.documentElement.offsetHeight || 0
          );
        maxScroll = Math.max(0, totalHeight - stepHeight);

        // Notify progress to popup/hub
        const pct = Math.min(99, Math.round(((actualY + stepHeight) / totalHeight) * 100));
        chrome.runtime
          .sendMessage({
            action: 'CAPTURE_PROGRESS',
            payload: { message: `Scanning page... (${pct}%)`, percent: pct },
          })
          .catch(() => { });

        if (actualY >= maxScroll || chunks.length >= 80) {
          break;
        }

        // Hide fixed/sticky headers before scrolling to the next viewport
        if (hideSticky) {
          suppressStickyElements();
        }

        currentTop = Math.min(maxScroll, currentTop + stepHeight);
        setScrollY(currentTop);

        // Pause for lazy-loading to catch up
        await new Promise((r) => setTimeout(r, scrollDelay));

        const nextY = getScrollY();
        if (nextY === actualY && actualY > 0) {
          // Bottom reached
          break;
        }
      }
    } finally {
      // Restore original styles and scroll positions
      document.body.style.overflow = originalOverflow;
      if (innerContainer) {
        if (innerContainer.style) innerContainer.style.overflow = origInnerOverflow;
        innerContainer.scrollTop = origInnerScrollTop;
      }
      restoreStickyElements();
      window.scrollTo(origScrollX, origScrollY);
      captureInProgress = false;
    }

    // Finalize stitching in Offscreen document
    await chrome.runtime.sendMessage({
      action: 'FINALIZE_STITCHING',
      payload: {
        chunks,
        totalWidth: window.innerWidth,
        totalHeight: Math.max(totalHeight, getScrollY() + stepHeight),
        dpr: window.devicePixelRatio || 1,
        title: document.title,
        url: window.location.href,
      },
    });
  }

  /**
   * 2. Interactive Area Selection Overlay (Isolated inside closed Shadow DOM)
   */
  function initSelectionOverlay() {
    removeSelectionOverlay();

    // Host element attached to documentElement
    overlayEl = document.createElement('div');
    overlayEl.id = 'omnicapture-selection-overlay';
    Object.assign(overlayEl.style, {
      position: 'fixed',
      inset: '0px',
      top: '0px',
      left: '0px',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483647',
      pointerEvents: 'auto',
    });

    const shadowRoot =
      typeof overlayEl.attachShadow === 'function' ? overlayEl.attachShadow({ mode: 'closed' }) : overlayEl;

    // Surface container inside Shadow Root
    const surfaceEl = document.createElement('div');
    Object.assign(surfaceEl.style, {
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
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: '#3b82f6',
    });
    const kbdEnter = document.createElement('kbd');
    Object.assign(kbdEnter.style, {
      backgroundColor: '#3f3f46',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '11px',
    });
    kbdEnter.textContent = 'Enter';
    const kbdEsc = document.createElement('kbd');
    Object.assign(kbdEsc.style, {
      backgroundColor: '#3f3f46',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '11px',
    });
    kbdEsc.textContent = 'Esc';

    banner.append(
      dot,
      document.createTextNode(' Drag to select capture area • Press '),
      kbdEnter,
      document.createTextNode(' to capture • '),
      kbdEsc,
      document.createTextNode(' to cancel')
    );
    surfaceEl.appendChild(banner);

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
    const scrollBtn = createButton('↕ Scroll Element', '#0284c7', '#ffffff', () => finalizeElementCaptureFromSelection());
    const cancelBtn = createButton('✕ Cancel', '#3f3f46', '#e4e4e7', () => removeSelectionOverlay());

    toolbarEl.appendChild(captureBtn);
    toolbarEl.appendChild(scrollBtn);
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

    surfaceEl.appendChild(cropBoxEl);
    shadowRoot.appendChild(surfaceEl);
    document.documentElement.appendChild(overlayEl);

    // Mouse & Keyboard Event Listeners
    surfaceEl.addEventListener('mousedown', onOverlayMouseDown);
    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
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
    const target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('#omnicapture-crop-box')) {
      // Clicked inside crop box -> start dragging box
      if (!target.classList?.contains('omnicapture-handle') && !target.closest('button')) {
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
      chrome.runtime.sendMessage({ action: 'CAPTURE_CANCELLED' }).catch(() => { });
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
    window.removeEventListener('keydown', onKeyDown, true);

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

  /**
   * 3. Interactive Scrolling-Element Inspector & Capture Engine (P1-4, Isolated inside closed Shadow DOM)
   */
  let inspectorOverlayEl = null;
  let inspectorHighlightEl = null;
  let inspectorBadgeEl = null;
  let hoveredTargetEl = null;

  function initElementInspector(scrollDelay = 600) {
    removeElementInspector();

    inspectorOverlayEl = document.createElement('div');
    inspectorOverlayEl.id = 'omnicapture-inspector-overlay';
    Object.assign(inspectorOverlayEl.style, {
      position: 'fixed',
      inset: '0px',
      zIndex: '2147483647',
      cursor: 'pointer',
      backgroundColor: 'transparent',
      pointerEvents: 'auto',
    });

    const shadowRoot =
      typeof inspectorOverlayEl.attachShadow === 'function'
        ? inspectorOverlayEl.attachShadow({ mode: 'closed' })
        : inspectorOverlayEl;

    const inspectorSurfaceEl = document.createElement('div');
    Object.assign(inspectorSurfaceEl.style, {
      position: 'fixed',
      inset: '0px',
      zIndex: '2147483647',
      cursor: 'pointer',
      backgroundColor: 'transparent',
      pointerEvents: 'auto',
    });

    const banner = document.createElement('div');
    Object.assign(banner.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: '#09090b',
      color: '#f4f4f5',
      padding: '8px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
      zIndex: '2147483648',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: '#0284c7',
    });
    const kbdEsc = document.createElement('kbd');
    Object.assign(kbdEsc.style, {
      backgroundColor: '#27272a',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '11px',
    });
    kbdEsc.textContent = 'Esc';

    banner.append(
      dot,
      document.createTextNode(' Hover & click any scrollable element to capture • Press '),
      kbdEsc,
      document.createTextNode(' to cancel')
    );
    inspectorSurfaceEl.appendChild(banner);

    inspectorHighlightEl = document.createElement('div');
    Object.assign(inspectorHighlightEl.style, {
      position: 'fixed',
      display: 'none',
      border: '2px solid #0284c7',
      backgroundColor: 'rgba(2, 132, 199, 0.12)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '2147483648',
      boxSizing: 'border-box',
      transition: 'top 0.05s ease, left 0.05s ease, width 0.05s ease, height 0.05s ease',
    });

    inspectorBadgeEl = document.createElement('div');
    Object.assign(inspectorBadgeEl.style, {
      position: 'absolute',
      top: '-26px',
      left: '0px',
      backgroundColor: '#0284c7',
      color: '#ffffff',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      whiteSpace: 'nowrap',
    });
    inspectorHighlightEl.appendChild(inspectorBadgeEl);
    inspectorSurfaceEl.appendChild(inspectorHighlightEl);

    shadowRoot.appendChild(inspectorSurfaceEl);
    document.documentElement.appendChild(inspectorOverlayEl);

    const onInspectorMouseMove = (e) => {
      inspectorOverlayEl.style.pointerEvents = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      inspectorOverlayEl.style.pointerEvents = 'auto';

      if (
        !el ||
        el === document.body ||
        el === document.documentElement ||
        el === inspectorOverlayEl ||
        (typeof el.closest === 'function' && el.closest('#omnicapture-inspector-overlay'))
      ) {
        inspectorHighlightEl.style.display = 'none';
        hoveredTargetEl = null;
        return;
      }

      // Check if element or any ancestor is scrollable
      let candidate = el;
      let foundScrollable = null;
      while (candidate && candidate !== document.body && candidate !== document.documentElement) {
        if (candidate.scrollHeight > candidate.clientHeight + 10) {
          foundScrollable = candidate;
          break;
        }
        candidate = candidate.parentElement;
      }

      hoveredTargetEl = foundScrollable || el;
      const rect = hoveredTargetEl.getBoundingClientRect();
      const isScrollable = hoveredTargetEl.scrollHeight > hoveredTargetEl.clientHeight + 10;

      inspectorHighlightEl.style.display = 'block';
      inspectorHighlightEl.style.left = `${rect.left}px`;
      inspectorHighlightEl.style.top = `${rect.top}px`;
      inspectorHighlightEl.style.width = `${rect.width}px`;
      inspectorHighlightEl.style.height = `${rect.height}px`;

      const tag = hoveredTargetEl.tagName.toLowerCase();
      const scrollInfo = isScrollable ? ` • Scrollable (H: ${hoveredTargetEl.scrollHeight}px)` : '';
      inspectorBadgeEl.innerText = `<${tag}> ${Math.round(rect.width)} × ${Math.round(rect.height)}px${scrollInfo}`;
      if (rect.top < 30) {
        inspectorBadgeEl.style.top = '4px';
        inspectorBadgeEl.style.left = '4px';
      } else {
        inspectorBadgeEl.style.top = '-26px';
        inspectorBadgeEl.style.left = '0px';
      }
    };

    const onInspectorClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = hoveredTargetEl;
      removeElementInspector();
      if (target) {
        captureScrollableElement(target, scrollDelay);
      }
    };

    const onInspectorKeyDown = (e) => {
      if (e.key === 'Escape') {
        removeElementInspector();
        chrome.runtime.sendMessage({ action: 'CAPTURE_CANCELLED' }).catch(() => { });
      }
    };

    inspectorSurfaceEl.addEventListener('mousemove', onInspectorMouseMove);
    inspectorSurfaceEl.addEventListener('click', onInspectorClick);
    window.addEventListener('keydown', onInspectorKeyDown, true);

    inspectorOverlayEl._cleanup = () => {
      inspectorSurfaceEl.removeEventListener('mousemove', onInspectorMouseMove);
      inspectorSurfaceEl.removeEventListener('click', onInspectorClick);
      window.removeEventListener('keydown', onInspectorKeyDown, true);
    };
  }

  function removeElementInspector() {
    if (inspectorOverlayEl) {
      if (inspectorOverlayEl._cleanup) inspectorOverlayEl._cleanup();
      if (inspectorOverlayEl.parentNode) inspectorOverlayEl.parentNode.removeChild(inspectorOverlayEl);
      inspectorOverlayEl = null;
      inspectorHighlightEl = null;
      inspectorBadgeEl = null;
      hoveredTargetEl = null;
    }
  }

  async function finalizeElementCaptureFromSelection() {
    if (!cropBoxEl || cropBoxEl.style.display === 'none') {
      removeSelectionOverlay();
      return;
    }
    const rect = cropBoxEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    removeSelectionOverlay();

    const targetEl = document.elementFromPoint(centerX, centerY);
    if (!targetEl) return;

    // Search for closest scrollable container
    let candidate = targetEl;
    let foundScrollable = null;
    while (candidate && candidate !== document.body && candidate !== document.documentElement) {
      if (candidate.scrollHeight > candidate.clientHeight + 10) {
        foundScrollable = candidate;
        break;
      }
      candidate = candidate.parentElement;
    }

    captureScrollableElement(foundScrollable || targetEl, 600);
  }

  async function captureScrollableElement(targetEl, scrollDelay = 600) {
    if (!targetEl) return;

    // Scroll element into view first
    targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await new Promise((r) => setTimeout(r, 200));

    const initialRect = targetEl.getBoundingClientRect();
    const origOverflow = targetEl.style.overflow;
    const origScrollTop = targetEl.scrollTop;

    // Suppress internal scrollbars
    targetEl.style.overflow = 'hidden';
    targetEl.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 200));

    const clientHeight = targetEl.clientHeight || initialRect.height;
    let totalHeight = Math.max(targetEl.scrollHeight, clientHeight);
    let maxScroll = Math.max(0, totalHeight - clientHeight);

    const cropRect = {
      x: initialRect.left,
      y: initialRect.top,
      width: initialRect.width,
      height: initialRect.height,
    };

    const chunks = [];
    const maxChunks = 80;

    try {
      while (true) {
        const actualScroll = targetEl.scrollTop;

        // Capture visible tab and stream chunk to offscreen canvas
        const response = await chrome.runtime
          .sendMessage({
            action: 'CAPTURE_VISIBLE_TAB',
            payload: {
              index: chunks.length,
              yOffset: actualScroll,
              kind: 'element',
              totalWidth: window.innerWidth,
              totalHeight,
              dpr: window.devicePixelRatio || 1,
              cropRect,
            },
          })
          .catch(() => null);
        if (response && response.ok) {
          chunks.push({
            index: response.index,
            yOffset: actualScroll,
          });
        }

        totalHeight = Math.max(totalHeight, targetEl.scrollHeight, clientHeight);
        maxScroll = Math.max(0, totalHeight - clientHeight);

        const pct = Math.min(99, Math.round(((actualScroll + clientHeight) / totalHeight) * 100));
        chrome.runtime
          .sendMessage({
            action: 'CAPTURE_PROGRESS',
            payload: { message: `Scanning element... (${pct}%)`, percent: pct },
          })
          .catch(() => { });

        if (actualScroll >= maxScroll || chunks.length >= maxChunks) {
          break;
        }

        const nextScroll = Math.min(maxScroll, actualScroll + clientHeight);
        targetEl.scrollTop = nextScroll;
        await new Promise((r) => setTimeout(r, scrollDelay));

        if (targetEl.scrollTop === actualScroll && actualScroll > 0) {
          break;
        }
      }
    } finally {
      targetEl.style.overflow = origOverflow;
      targetEl.scrollTop = origScrollTop;
    }

    if (chunks.length === 0) return;

    // Finalize element stitching in offscreen document
    chrome.runtime.sendMessage({
      action: 'FINALIZE_ELEMENT_STITCHING',
      payload: {
        chunks,
        cropRect,
        totalWidth: window.innerWidth,
        totalHeight,
        dpr: window.devicePixelRatio || 1,
        title: document.title ? `${document.title} - Element` : 'Element Capture',
        url: window.location.href,
      },
    });
  }
})();
