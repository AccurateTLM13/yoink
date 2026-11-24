import React from 'react';
import type { HistoryItem } from '../../types';
import {
  computeAspectRatio,
  formatCaptureReadout,
  formatProofStamp,
} from '../../utils/studioFormat';
import { CaptureThumbnail } from './CaptureThumbnail';

interface CropReticleFrameProps {
  item: HistoryItem;
  selected: boolean;
  resolvedFullDataUrl?: string | null;
  onResolvedFullDataUrl?: (dataUrl: string) => void;
  showProofStamp?: boolean;
  fixedAspect?: number;
}

/**
 * Signature Detail (DESIGN.md):
 * The Open-Corner Crop Reticle + Flush Pixel Stamp.
 *
 * When selected, renders a 1px accent open-corner bracket with a detached 4x4px
 * square at the top-right corner cleanly outside the screenshot area, paired with
 * a flush JetBrains Mono readout bar underneath. Nothing ever floats over the image.
 */
export const CropReticleFrame: React.FC<CropReticleFrameProps> = React.memo(
  ({
    item,
    selected,
    resolvedFullDataUrl,
    onResolvedFullDataUrl,
    showProofStamp = true,
    fixedAspect,
  }) => {
    const aspectRatio = fixedAspect ?? computeAspectRatio(item.width, item.height);
    const readout = formatCaptureReadout(item, resolvedFullDataUrl);
    const proofStamp = showProofStamp ? formatProofStamp(item) : null;

    return (
      <div
        data-reticle-active={selected ? 'true' : 'false'}
        className={`relative p-2 bg-[var(--surface)] transition-colors ${
          selected
            ? 'rounded-tl-[12px] rounded-bl-[12px] rounded-br-[12px]'
            : 'rounded-[12px] border border-[var(--border)]'
        }`}
      >
        {selected && (
          <>
            {/* 1px accent open-corner bracket leaving a clean 12px notch at top-right */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-[var(--accent)]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 bottom-0 h-px bg-[var(--accent)]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 h-px bg-[var(--accent)]"
              style={{ right: '12px' }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0 bottom-0 w-px bg-[var(--accent)]"
              style={{ top: '12px' }}
            />
            {/* Detached 4x4px top-right corner pixel matching yoink-brand-logo.png */}
            <span
              aria-hidden="true"
              data-reticle-pixel="true"
              className="pointer-events-none absolute top-0 right-0 w-1 h-1 bg-[var(--accent)]"
            />
          </>
        )}

        {/* Inner screenshot + flush readout container (nested radius: 12px - 8px = 4px) */}
        <div className="rounded-[4px] overflow-hidden border border-[var(--border)] bg-[var(--canvas)]">
          <div className="w-full overflow-hidden bg-[var(--canvas)]" style={{ aspectRatio }}>
            <CaptureThumbnail
              item={item}
              onResolvedFullDataUrl={onResolvedFullDataUrl}
              className="w-full h-full object-cover object-top block"
            />
          </div>

          {/* Flush JetBrains Mono pixel stamp — printed plainly, never hidden on hover */}
          <div className="px-2 py-1 border-t border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-2">
            <span className="type-mono text-[var(--ink)] truncate">{readout}</span>
            {proofStamp && (
              <span
                className={`type-mono shrink-0 ${
                  selected ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'
                }`}
              >
                {proofStamp}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
);
