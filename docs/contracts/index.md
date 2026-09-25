# Yoink Feature Contracts — Master Index

> Generated: 2026-09-25 | Codebase version: 1.1.0

---

## Build Order

Features must be implemented in this order. Each depends on predecessors passing
their acceptance criteria before the next begins.

| Order | Priority | Contract | File |
|-------|----------|----------|------|
| 1 | P0-1 | Annotation Toolkit | p0-1-annotation-toolkit.md |
| 2 | P0-2 | PDF Export | p0-2-pdf-export.md |
| 3 | P0-3 | Blur / Redaction Tool | p0-3-blur-redaction.md |
| 4 | P1-4 | Scrolling-Element Capture | p1-4-scroll-element-capture.md |
| 5 | P1-5 | Desktop / Full-Screen Capture | p1-5-desktop-capture.md |
| 6 | P1-6 | Delayed Capture Timer | p1-6-delayed-capture-timer.md |
| 7 | P1-7 | Upload and Edit | p1-7-upload-edit.md |
| 8 | P2-8 | Filename Templates and Export Presets | p2-8-filename-templates.md |
| 9 | P2-9 | OCR Text Extraction | p2-9-ocr-extraction.md |
| 10 | P2-10 | Opt-In Share Links | p2-10-share-links.md |

---

## Dependency Graph

    P0-1 Annotation Toolkit
    |  |---> P0-3 Blur/Redaction (uses annotation canvas + tool registry)
    |  |---> P1-7 Upload & Edit (feeds imported images into annotation editor)
    |  +---> P2-9 OCR (OCR panel lives inside annotation UI shell)
    |
    P0-2 PDF Export
    |  +---> standalone; reads yoink_full_{id} from storage.ts
    |        NOTE: PDF of annotated image requires P0-1 composited dataUrl first
    |
    P1-4 Scrolling-Element Capture
    |  +---> extends content.js + background.js; independent of annotation
    |
    P1-5 Desktop Capture
    |  +---> new background.js handler; requires desktopCapture permission
    |
    P1-6 Delayed Capture Timer
    |  +---> wraps existing capture handlers in background.js; no new deps
    |
    P2-8 Filename Templates
    |  +---> extends formatFilename() in capture.ts and background.js
    |
    P2-9 OCR Text Extraction
    |  +---> depends on P0-1 (UI) and storage.ts schema extension
    |
    P2-10 Opt-In Share Links
       +---> clean seam; no hard dep on other P2 features

### Critical Path

    P0-1 -> P0-3 -> P1-7 -> P2-9   (annotation line)
    P0-1 -> P0-2                   (annotated-image PDF export)

P0-1 is the root blocker. No annotation-dependent feature should begin
implementation until P0-1 acceptance criteria are fully met.

---

## Cross-Contract Conflict Register

| Conflict | Resolution |
|----------|-----------|
| P0-3 blur brush vs P0-1 tool registry | P0-1 owns the tool registry shape. P0-3 registers itself into it. |
| P2-8 {width}x{height} tokens vs existing formatFilename() | P2-8 extends both sites. No tokens removed. Backward compatible in same PR. |
| P1-7 upload entry vs P0-1 openAnnotationEditor() API | P0-1 must define and export openAnnotationEditor(historyItem). P1-7 calls it with mode:'upload' items. |
| P2-9 ocrText field vs existing HistoryItem in src/types.ts | P2-9 adds optional ocrText?: string. Must not rename or remove existing fields. |
| P2-10 share links vs offline-first constraint | P2-10 is strictly opt-in and default-OFF. Offline constraint governs all others unconditionally. |

---

## Global Non-Negotiables (apply to every contract)

1. Offline-first: Zero network calls except P2-10 opted-in sharing.
2. No new host permissions without explicit justification in Section 7 of the relevant contract.
3. MV3 compliant: No persistent background pages. Use existing setupOffscreenDocument() / 45s idle timer from background.js.
4. No analytics, telemetry, or tracking of any kind.
5. MIT-compatible dependencies only. Verify license before adding any npm package.
6. Non-destructive editing: The original yoink_full_{id} key in chrome.storage.local must never be overwritten by annotation. Annotated exports write to a new key or go directly to download/clipboard.
7. TypeScript: All new source files in src/ must be .ts or .tsx. background.js, content.js, and offscreen.js remain plain JS.
