import { Image as ImageIcon } from 'lucide-react';
import React, { useState } from 'react';

interface TrackArtworkProps {
  src: string;
  className?: string;
  eager?: boolean;
}

const NO_ART_SRC = '/noart.png';

export function TrackArtwork({ src, className, eager }: TrackArtworkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  const showingPlaceholder = !src || failedSrc === src;
  if (showingPlaceholder && !placeholderFailed) {
    return (
      <img
        src={NO_ART_SRC}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        draggable={false}
        onError={() => setPlaceholderFailed(true)}
        className={className}
      />
    );
  }
  if (showingPlaceholder) {
    return (
      <div className={`${className ?? ''} flex items-center justify-center`} aria-hidden="true">
        <ImageIcon className="h-1/2 w-1/2 opacity-60" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}
