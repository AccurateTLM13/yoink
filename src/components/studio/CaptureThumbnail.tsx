import React, { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { HistoryItem } from '../../types';
import { getFullResolutionImage } from '../../utils/storage';

interface CaptureThumbnailProps {
  item: HistoryItem;
  className?: string;
  onResolvedFullDataUrl?: (dataUrl: string) => void;
}

export const CaptureThumbnail: React.FC<CaptureThumbnailProps> = React.memo(
  ({ item, className = 'w-full h-full object-cover object-top', onResolvedFullDataUrl }) => {
    const initial =
      item.dataUrl && item.dataUrl.length > 50000
        ? item.dataUrl
        : item.thumbnailUrl || item.dataUrl || null;
    const [src, setSrc] = useState<string | null>(initial);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
      let mounted = true;
      if (item.dataUrl && item.dataUrl.length > 50000) {
        setSrc(item.dataUrl);
        setLoadFailed(false);
        return;
      }
      if (item.thumbnailUrl || item.dataUrl) {
        setSrc(item.thumbnailUrl || item.dataUrl);
        setLoadFailed(false);
        return;
      }

      getFullResolutionImage(item.id)
        .then((full) => {
          if (!mounted) return;
          if (full) {
            setSrc(full);
            setLoadFailed(false);
            onResolvedFullDataUrl?.(full);
          } else {
            setLoadFailed(true);
          }
        })
        .catch(() => {
          if (mounted) setLoadFailed(true);
        });

      return () => {
        mounted = false;
      };
    }, [item.id, item.dataUrl, item.thumbnailUrl, onResolvedFullDataUrl]);

    if (!src || loadFailed) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-[var(--canvas)] text-[var(--ink-muted)]">
          <ImageIcon size={16} strokeWidth={1.5} aria-hidden="true" />
        </div>
      );
    }

    return (
      <img
        src={src}
        alt={item.title || 'Captured screenshot'}
        loading="lazy"
        onError={() => {
          getFullResolutionImage(item.id)
            .then((full) => {
              if (full && full !== src) {
                setSrc(full);
                onResolvedFullDataUrl?.(full);
              } else {
                setLoadFailed(true);
              }
            })
            .catch(() => setLoadFailed(true));
        }}
        className={className}
      />
    );
  }
);
