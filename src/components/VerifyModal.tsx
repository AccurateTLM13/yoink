import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Check,
  Clock,
  Copy,
  Cpu,
  FileCheck,
  Globe,
  Key,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Upload,
  User,
  X,
} from 'lucide-react';
import type { ProofVerificationResult } from '../types';
import {
  getOrCreateProofIdentity,
  verifyImageDataUrl,
  type ProofIdentity,
} from '../utils/proof';
import { formatDimensions, formatProofVerdict } from '../utils/studioFormat';

interface Props {
  initialDataUrl?: string | null;
  initialTitle?: string;
  onClose?: () => void;
  inline?: boolean;
}

export const VerifyModal: React.FC<Props> = ({
  initialDataUrl = null,
  initialTitle = '',
  onClose,
  inline = false,
}) => {
  const [identity, setIdentity] = useState<ProofIdentity | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(initialDataUrl);
  const [fileName, setFileName] = useState<string>(initialTitle || 'Captured screenshot');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<ProofVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getOrCreateProofIdentity()
      .then(setIdentity)
      .catch(() => {});
  }, []);

  const runVerification = useCallback(async (dataUrl: string, label?: string) => {
    setImageSrc(dataUrl);
    if (label) setFileName(label);
    setVerifying(true);
    setError(null);
    try {
      const res = await verifyImageDataUrl(dataUrl);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not inspect image file.');
      setResult(null);
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (initialDataUrl) {
      void runVerification(initialDataUrl, initialTitle || 'Gallery capture');
    }
  }, [initialDataUrl, initialTitle, runVerification]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Select a PNG, JPEG, or WebP image file.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          void runVerification(reader.result, file.name);
        }
      };
      reader.onerror = () => setError('Failed to read image file.');
      reader.readAsDataURL(file);
    },
    [runVerification]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length > 0) {
        e.preventDefault();
        handleFileSelect(files[0]);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFileSelect]);

  useEffect(() => {
    if (inline || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inline, onClose]);

  const handleCopyKey = () => {
    if (!identity) return;
    void navigator.clipboard?.writeText(identity.keyFingerprint);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  };

  const verdict = result ? formatProofVerdict(result) : null;
  const manifestDims = result?.manifest ? formatDimensions(result.manifest.w, result.manifest.h) : null;

  const content = (
    <div
      className={
        inline
          ? 'w-full flex-1 flex flex-col bg-[var(--canvas)] text-[var(--ink)] overflow-hidden'
          : 'relative z-10 w-full max-w-[720px] max-h-[92vh] bg-[var(--canvas)] text-[var(--ink)] rounded-[12px] border border-[var(--border)] overflow-hidden flex flex-col'
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          handleFileSelect(e.dataTransfer.files[0]);
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handleFileSelect(file);
        }}
      />

      {/* Modal-only header (inline Studio uses StudioShell top bar) */}
      {!inline && (
        <header className="h-[56px] px-4 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck size={16} strokeWidth={1.5} className="text-[var(--ink)] shrink-0" />
            <h2 className="type-display-s text-[var(--ink)] truncate">Proof Vault</h2>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Proof Vault"
              className="w-8 h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center cursor-pointer studio-focus"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          )}
        </header>
      )}

      {/* Scrollable Body — 32px major bands (C2PA Verify) */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8">
        {/* Band 1: Verdict First + Inspected Asset Reticle (or Dropzone) */}
        <section aria-label="Verification verdict" className="space-y-4">
          {verifying ? (
            <div className="p-8 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-[var(--ink)]" />
              <p className="type-body-medium text-[var(--ink)]">Verifying signature and pixel integrity…</p>
              <p className="type-mono text-[var(--ink-muted)]">
                Scanning LSB channels, XMP/IPTC metadata, and ECDSA P-256 key
              </p>
            </div>
          ) : result && verdict ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 md:p-6 space-y-5">
              {/* Verdict Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {verdict.tone === 'valid' ? (
                      <ShieldCheck
                        size={16}
                        strokeWidth={1.5}
                        className="text-[var(--semantic-valid)] shrink-0"
                      />
                    ) : verdict.tone === 'error' ? (
                      <ShieldAlert
                        size={16}
                        strokeWidth={1.5}
                        className="text-[var(--semantic-error)] shrink-0"
                      />
                    ) : (
                      <ShieldQuestion
                        size={16}
                        strokeWidth={1.5}
                        className="text-[var(--ink-muted)] shrink-0"
                      />
                    )}
                    <h2
                      className={`type-display-l ${
                        verdict.tone === 'valid'
                          ? 'text-[var(--semantic-valid)]'
                          : verdict.tone === 'error'
                          ? 'text-[var(--semantic-error)]'
                          : 'text-[var(--ink)]'
                      }`}
                    >
                      {verdict.headline}
                    </h2>
                  </div>

                  <p className="type-body text-[var(--ink)]">{result.summary}</p>

                  {result.signatureValid && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-mono text-[var(--ink)]">
                        {!result.verified || !result.pixelsIntact
                          ? 'Pixels altered after signing'
                          : result.isDerivative
                          ? 'Edited derivative'
                          : result.captureKind === 'imported'
                          ? 'Signed import'
                          : 'Original capture'}
                      </span>
                      <span className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] type-mono text-[var(--ink-muted)]">
                        {result.isOwnCapture ? 'This browser key' : 'External browser key'}
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 shrink-0 cursor-pointer transition-colors studio-focus"
                >
                  <Upload size={16} strokeWidth={1.5} />
                  <span>Inspect another</span>
                </button>
              </div>

              {/* Inspected capture framed with Open-Corner Crop Reticle + Flush Pixel Stamp */}
              {imageSrc && (
                <div
                  data-reticle-active="true"
                  className="relative p-2 bg-[var(--surface)] rounded-tl-[12px] rounded-bl-[12px] rounded-br-[12px]"
                >
                  <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-[var(--accent)]" />
                  <span aria-hidden="true" className="pointer-events-none absolute left-0 right-0 bottom-0 h-px bg-[var(--accent)]" />
                  <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px bg-[var(--accent)]" style={{ right: '12px' }} />
                  <span aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 w-px bg-[var(--accent)]" style={{ top: '12px' }} />
                  <span aria-hidden="true" data-reticle-pixel="true" className="pointer-events-none absolute top-0 right-0 w-1 h-1 bg-[var(--accent)]" />

                  <div className="rounded-[4px] overflow-hidden border border-[var(--border)] bg-[var(--canvas)]">
                    <div className="w-full max-h-[260px] overflow-hidden flex items-center justify-center bg-[var(--canvas)]">
                      <img
                        src={imageSrc}
                        alt={fileName}
                        className="max-w-full max-h-[260px] object-contain block"
                      />
                    </div>
                    <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-2">
                      <span className="type-mono text-[var(--ink)] truncate">
                        {fileName}
                        {manifestDims ? ` · ${manifestDims}` : ''}
                      </span>
                      <span
                        className={`type-mono shrink-0 ${
                          verdict.tone === 'valid'
                            ? 'text-[var(--semantic-valid)]'
                            : verdict.tone === 'error'
                            ? 'text-[var(--semantic-error)]'
                            : 'text-[var(--ink-muted)]'
                        }`}
                      >
                        {verdict.stamp}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {result.signatureValid && (
                <p className="type-ui text-[var(--ink-muted)] pt-3 border-t border-[var(--border)]">
                  Integrity scope: Proof confirms pixels and metadata match this signature since signing. Website content, URL, and creator handle are self-declared.
                </p>
              )}
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="type-display-l text-[var(--ink)]">Inspect capture provenance</h2>
                <p className="type-body text-[var(--ink-muted)]">
                  Drop a PNG, JPEG, or WebP screenshot, paste with Ctrl+V, or select a local file to verify ECDSA P-256 signatures and pixel integrity offline.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] type-ui-medium inline-flex items-center gap-2 cursor-pointer studio-focus"
                >
                  <Upload size={16} strokeWidth={1.5} />
                  <span>Select image</span>
                </button>
                <span className="type-mono text-[var(--ink-muted)]">
                  PNG · JPEG · WebP · 100% local verification
                </span>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-4 rounded-[12px] bg-[var(--surface)] border border-[var(--border)] flex items-center gap-2"
            >
              <ShieldAlert size={16} strokeWidth={1.5} className="text-[var(--semantic-error)] shrink-0" />
              <span className="type-ui text-[var(--ink)]">{error}</span>
            </div>
          )}
        </section>

        {/* Band 2: Four-Layer Cryptographic Checks */}
        {!verifying && result && (
          <section aria-label="Verification checks" className="space-y-3">
            <h3 className="type-caption text-[var(--ink-muted)]">Verification checks</h3>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-caption text-[var(--ink-muted)]">Declared source</span>
                  <Globe
                    size={16}
                    strokeWidth={1.5}
                    className={
                      result.hasIptcScreenCapture
                        ? 'text-[var(--semantic-valid)]'
                        : 'text-[var(--ink-muted)]'
                    }
                  />
                </div>
                <div className="type-mono text-[var(--ink)]">
                  {result.hasIptcScreenCapture ? 'screenCapture' : 'Not declared'}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-caption text-[var(--ink-muted)]">Pixel DNA (LSB)</span>
                  <Cpu
                    size={16}
                    strokeWidth={1.5}
                    className={
                      result.hasPixelWatermark
                        ? 'text-[var(--semantic-valid)]'
                        : 'text-[var(--ink-muted)]'
                    }
                  />
                </div>
                <div className="type-mono text-[var(--ink)]">
                  {result.hasPixelWatermark ? 'Embedded' : 'None / lossy'}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-caption text-[var(--ink-muted)]">ECDSA seal</span>
                  <Lock
                    size={16}
                    strokeWidth={1.5}
                    className={
                      result.signatureValid
                        ? 'text-[var(--semantic-valid)]'
                        : result.status === 'invalid_signature'
                        ? 'text-[var(--semantic-error)]'
                        : 'text-[var(--ink-muted)]'
                    }
                  />
                </div>
                <div className="type-mono text-[var(--ink)]">
                  {result.signatureValid ? 'Valid ES256' : 'Unsigned'}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-caption text-[var(--ink-muted)]">Pixel integrity</span>
                  <FileCheck
                    size={16}
                    strokeWidth={1.5}
                    className={
                      result.pixelsIntact
                        ? 'text-[var(--semantic-valid)]'
                        : result.manifest
                        ? 'text-[var(--semantic-error)]'
                        : 'text-[var(--ink-muted)]'
                    }
                  />
                </div>
                <div className="type-mono text-[var(--ink)]">
                  {result.pixelsIntact
                    ? 'Intact'
                    : result.manifest
                    ? 'Altered'
                    : 'Unverified'}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Band 3: Provenance Certificate Table & Parent Lineage */}
        {!verifying && result?.manifest && (
          <section aria-label="Provenance certificate" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="type-caption text-[var(--ink-muted)]">Provenance certificate</h3>
              <span className="type-mono text-[var(--ink-muted)]">
                {result.hasIptcScreenCapture ? 'IPTC: screenCapture' : 'Source type not declared'}
              </span>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] divide-y divide-[var(--border)] overflow-hidden">
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-2 min-w-0">
                  <Key size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <div className="type-caption text-[var(--ink-muted)]">Signer key fingerprint</div>
                    <div className="type-mono text-[var(--ink)] break-all">
                      #{result.manifest.kid}
                      {result.isOwnCapture ? ' · This browser' : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 min-w-0">
                  <User size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <div className="type-caption text-[var(--ink-muted)]">Declared creator</div>
                    <div className="type-body-medium text-[var(--ink)] truncate">
                      {result.manifest.a || 'Not provided'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 min-w-0">
                  <Clock size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <div className="type-caption text-[var(--ink-muted)]">Capture timestamp</div>
                    <div className="type-mono text-[var(--ink)]">
                      {new Date(result.manifest.ts).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 min-w-0">
                  <Globe size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <div className="type-caption text-[var(--ink-muted)]">Original dimensions &amp; origin</div>
                    <div className="type-mono text-[var(--ink)] break-all">
                      {result.manifest.w}×{result.manifest.h} · {result.manifest.u || 'Local file'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[var(--canvas)] space-y-2">
                <div className="space-y-1">
                  <div className="type-caption text-[var(--ink-muted)]">SHA-256 pixel seal</div>
                  <div className="type-mono text-[var(--ink)] break-all select-text">
                    {result.manifest.ph}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="type-caption text-[var(--ink-muted)]">ECDSA P-256 signature</div>
                  <div className="type-mono text-[var(--ink)] break-all select-text">
                    {result.manifest.sig}
                  </div>
                </div>
              </div>

              {result.manifest.parent && (
                <div className="p-4 space-y-3">
                  <h4 className="type-caption text-[var(--ink-muted)]">
                    Original capture lineage (parent signature)
                  </h4>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <dt className="type-caption text-[var(--ink-muted)]">Original key</dt>
                      <dd className="type-mono text-[var(--ink)]">#{result.manifest.parent.kid}</dd>
                    </div>
                    <div>
                      <dt className="type-caption text-[var(--ink-muted)]">Original time</dt>
                      <dd className="type-mono text-[var(--ink)]">
                        {new Date(result.manifest.parent.ts).toLocaleString()}
                      </dd>
                    </div>
                    {result.manifest.parent.u && (
                      <div className="sm:col-span-2">
                        <dt className="type-caption text-[var(--ink-muted)]">Original origin</dt>
                        <dd className="type-mono text-[var(--ink)] break-all">
                          {result.manifest.parent.u}
                        </dd>
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <dt className="type-caption text-[var(--ink-muted)]">Original pixel seal</dt>
                      <dd className="type-mono text-[var(--ink)] break-all select-text">
                        {result.manifest.parent.ph}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="type-caption text-[var(--ink-muted)]">Original signature</dt>
                      <dd className="type-mono text-[var(--ink)] break-all select-text">
                        {result.manifest.parent.sig}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Band 4: Local Browser Signing Identity */}
        {identity && (
          <section aria-label="Browser signing key" className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Key size={16} strokeWidth={1.5} className="text-[var(--ink-muted)] shrink-0" />
              <div className="min-w-0">
                <div className="type-caption text-[var(--ink-muted)]">Local browser signing key</div>
                <code className="type-mono text-[var(--ink)] break-all">#{identity.keyFingerprint}</code>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyKey}
              className="h-8 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] hover:bg-[var(--surface)] text-[var(--ink)] type-ui-medium inline-flex items-center gap-2 shrink-0 cursor-pointer studio-focus"
            >
              {copiedKey ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
              <span>{copiedKey ? 'Copied' : 'Copy key ID'}</span>
            </button>
          </section>
        )}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div
        role="region"
        aria-label="Yoink Proof Verification Vault"
        className="flex-1 flex flex-col bg-[var(--canvas)] text-[var(--ink)] select-none overflow-hidden"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Yoink Proof Verification Vault"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none"
    >
      <button
        type="button"
        aria-label="Close Proof Vault"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--ink)] opacity-35 cursor-pointer"
      />
      {content}
    </div>
  );
};
