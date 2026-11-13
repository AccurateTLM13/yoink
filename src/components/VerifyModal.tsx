import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Upload,
  Check,
  Copy,
  X,
  Key,
  Lock,
  FileCheck,
  Cpu,
  Globe,
  Clock,
  User,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { ProofVerificationResult } from '../types';
import {
  getOrCreateProofIdentity,
  verifyImageDataUrl,
  ProofIdentity,
} from '../utils/proof';

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
  const [fileName, setFileName] = useState<string>(initialTitle || 'Captured Screenshot');
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
    } catch (err: any) {
      setError(err?.message || 'Could not inspect image file.');
      setResult(null);
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (initialDataUrl) {
      void runVerification(initialDataUrl, initialTitle || 'Gallery Capture');
    }
  }, [initialDataUrl, initialTitle, runVerification]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid PNG, JPEG, or WebP image file.');
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

  // Support Ctrl+V clipboard paste inside the modal
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

  // Close on Escape
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

  return (
    <div
      role={inline ? 'region' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-label="Yoink Proof Verification Vault"
      className={
        inline
          ? 'flex-1 flex flex-col bg-[#fbfbfd] text-zinc-900 font-sans select-none overflow-hidden h-full'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-6 animate-in fade-in duration-150 font-sans select-none'
      }
    >
      <div
        className={
          inline
            ? 'w-full flex-1 flex flex-col overflow-hidden'
            : 'w-full max-w-2xl bg-[#fbfbfd] text-zinc-900 rounded-2xl border border-zinc-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]'
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
        {/* Hidden File Input */}
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

        {/* Header */}
        <div className="px-5 py-3.5 bg-white border-b border-zinc-200/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-600 flex items-center justify-center shrink-0 shadow-2xs">
              <ShieldCheck size={17} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs sm:text-sm font-bold text-zinc-900 leading-tight">
                  Yoink Proof™ Verification Vault
                </h3>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200/70">
                  ECDSA P-256
                </span>
              </div>
              <p className="text-[10.5px] text-zinc-500">
                Verify screenshot ownership, pixel integrity & IPTC anti-AI provenance
              </p>
            </div>
          </div>

          {!inline && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition cursor-pointer"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {/* Device Key Identity Bar */}
          {identity && (
            <div className="p-2.5 rounded-xl bg-zinc-900 text-zinc-100 flex items-center justify-between gap-2 border border-zinc-800">
              <div className="flex items-center gap-2 min-w-0">
                <Key size={13} className="text-emerald-400 shrink-0" />
                <span className="text-[11px] text-zinc-400 truncate">Your Browser Signing Key:</span>
                <code className="font-mono text-[11px] font-bold text-emerald-400 tracking-wider">
                  #{identity.keyFingerprint}
                </code>
              </div>
              <button
                onClick={handleCopyKey}
                className="px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[10px] flex items-center gap-1 transition cursor-pointer shrink-0 border border-zinc-700"
              >
                {copiedKey ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copiedKey ? 'Copied' : 'Copy ID'}</span>
              </button>
            </div>
          )}

          {/* Upload / Drop Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="p-3.5 rounded-xl border-2 border-dashed border-zinc-300 hover:border-emerald-500 bg-white hover:bg-emerald-50/30 transition cursor-pointer flex items-center justify-between gap-3 group"
          >
            <div className="flex items-center gap-3 min-w-0">
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt="Preview"
                  className="w-12 h-12 rounded-lg object-cover border border-zinc-200 shrink-0 bg-zinc-100"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-zinc-100 group-hover:bg-emerald-100 text-zinc-600 group-hover:text-emerald-700 flex items-center justify-center shrink-0 transition">
                  <Upload size={18} />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-semibold text-zinc-900 truncate text-xs">
                  {imageSrc ? fileName : 'Drop any screenshot here, click to browse, or press Ctrl+V'}
                </div>
                <div className="text-[10.5px] text-zinc-500 mt-0.5">
                  Decodes invisible LSB pixel DNA, ECDSA P-256 cryptographic seal & IPTC headers
                </div>
              </div>
            </div>

            <span className="px-2.5 py-1.5 rounded-lg bg-zinc-100 group-hover:bg-emerald-600 group-hover:text-white text-zinc-700 font-semibold text-[11px] transition shrink-0">
              {imageSrc ? 'Inspect Another' : 'Select Image'}
            </span>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Loading State */}
          {verifying && (
            <div className="p-6 rounded-xl bg-white border border-zinc-200 flex flex-col items-center justify-center gap-2 text-zinc-600">
              <RefreshCw size={20} className="animate-spin text-emerald-600" />
              <span className="text-xs font-medium">
                Scanning pixel LSB channels & verifying ECDSA P-256 signature…
              </span>
            </div>
          )}

          {/* Verification Result */}
          {!verifying && result && (
            <div className="space-y-3 animate-in fade-in duration-150">
              {/* Primary Verdict Banner */}
              <div
                className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                  result.status === 'authentic'
                    ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                    : result.status === 'tampered'
                    ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                    : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    result.status === 'authentic'
                      ? 'bg-emerald-600 text-white'
                      : result.status === 'tampered'
                      ? 'bg-amber-500 text-white'
                      : 'bg-zinc-600 text-white'
                  }`}
                >
                  {result.status === 'authentic' ? (
                    <ShieldCheck size={18} />
                  ) : result.status === 'tampered' ? (
                    <ShieldAlert size={18} />
                  ) : (
                    <ShieldQuestion size={18} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs sm:text-sm">
                      {result.status === 'authentic'
                        ? 'Verified Authentic Yoink Capture'
                        : result.status === 'tampered'
                        ? 'Signed by Yoink — Pixels Modified After Capture'
                        : result.status === 'invalid_signature'
                        ? 'Invalid Cryptographic Signature'
                        : 'No Yoink Proof Signature Found'}
                    </span>
                    {result.isOwnCapture && (
                      <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold uppercase bg-emerald-600 text-white">
                        ✓ YOUR CAPTURE
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-90 mt-0.5 leading-snug">{result.summary}</p>
                </div>
              </div>

              {/* 4-Layer Diagnostic Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-xl bg-white border border-zinc-200/90 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                    <span>ANTI-AI IPTC</span>
                    <Sparkles
                      size={12}
                      className={result.hasIptcScreenCapture ? 'text-emerald-600' : 'text-zinc-400'}
                    />
                  </div>
                  <div
                    className={`font-bold text-[11px] ${
                      result.hasIptcScreenCapture ? 'text-emerald-700' : 'text-zinc-500'
                    }`}
                  >
                    {result.hasIptcScreenCapture ? '✓ screenCapture' : 'Not Declared'}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-zinc-200/90 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                    <span>PIXEL DNA (LSB)</span>
                    <Cpu
                      size={12}
                      className={result.hasPixelWatermark ? 'text-emerald-600' : 'text-zinc-400'}
                    />
                  </div>
                  <div
                    className={`font-bold text-[11px] ${
                      result.hasPixelWatermark ? 'text-emerald-700' : 'text-zinc-500'
                    }`}
                  >
                    {result.hasPixelWatermark ? '✓ Embedded' : 'None / Lossy'}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-zinc-200/90 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                    <span>ECDSA SEAL</span>
                    <Lock
                      size={12}
                      className={result.signatureValid ? 'text-emerald-600' : 'text-zinc-400'}
                    />
                  </div>
                  <div
                    className={`font-bold text-[11px] ${
                      result.signatureValid ? 'text-emerald-700' : 'text-zinc-500'
                    }`}
                  >
                    {result.signatureValid ? '✓ Valid ES256' : 'Unsigned'}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-zinc-200/90 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                    <span>PIXEL INTEGRITY</span>
                    <FileCheck
                      size={12}
                      className={result.pixelsIntact ? 'text-emerald-600' : 'text-amber-500'}
                    />
                  </div>
                  <div
                    className={`font-bold text-[11px] ${
                      result.pixelsIntact
                        ? 'text-emerald-700'
                        : result.manifest
                        ? 'text-amber-700'
                        : 'text-zinc-500'
                    }`}
                  >
                    {result.pixelsIntact
                      ? '✓ 100% Intact'
                      : result.manifest
                      ? 'Altered / Re-saved'
                      : 'Unverified'}
                  </div>
                </div>
              </div>

              {/* Certificate Details Table */}
              {result.manifest && (
                <div className="bg-white rounded-xl border border-zinc-200/90 divide-y divide-zinc-100 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                      Decoded Capture Provenance Certificate
                    </span>
                    <span className="font-mono text-[10px] text-emerald-700 font-semibold">
                      IPTC: screenCapture (Non-AI)
                    </span>
                  </div>

                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                    <div className="flex items-start gap-2">
                      <Key size={13} className="text-zinc-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-zinc-500">Signer Key Fingerprint</div>
                        <div className="font-mono font-bold text-zinc-900">
                          #{result.manifest.kid}{' '}
                          {result.isOwnCapture && (
                            <span className="text-emerald-600 font-sans font-semibold">
                              (This Browser)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <User size={13} className="text-zinc-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-zinc-500">Declared Creator / Owner</div>
                        <div className="font-semibold text-zinc-900 truncate">
                          {result.manifest.a || 'Yoink Verified User'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Clock size={13} className="text-zinc-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-zinc-500">Capture Timestamp</div>
                        <div className="font-mono text-zinc-900">
                          {new Date(result.manifest.ts).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Globe size={13} className="text-zinc-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-zinc-500">
                          Original Dimensions & Source
                        </div>
                        <div className="font-mono text-zinc-900 truncate">
                          {result.manifest.w} × {result.manifest.h}px •{' '}
                          {result.manifest.u || 'local'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-3 py-2 bg-zinc-50/70 font-mono text-[10px] text-zinc-500 flex flex-col gap-0.5">
                    <div className="truncate">
                      <span className="text-zinc-700 font-semibold">SHA-256 Pixel Seal:</span>{' '}
                      {result.manifest.ph}
                    </div>
                    <div className="truncate">
                      <span className="text-zinc-700 font-semibold">ECDSA Signature:</span>{' '}
                      {result.manifest.sig}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

