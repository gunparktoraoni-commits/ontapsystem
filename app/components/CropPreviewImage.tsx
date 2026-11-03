'use client';

import { useState } from 'react';
import { getCropPreviewDimensions } from './BizCardShared';

export function CropPreviewImage({
  src,
  zoom,
  offsetX,
  offsetY,
  frameWidth,
  frameHeight,
}: {
  src: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
  frameWidth: number;
  frameHeight: number;
}) {
  const [loadedImage, setLoadedImage] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const dimensions = loadedImage?.src === src
    ? getCropPreviewDimensions(loadedImage.width, loadedImage.height, frameWidth, frameHeight)
    : null;

  return (
    <img
      src={src}
      alt="Crop preview"
      className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
      style={{
        width: dimensions?.width,
        height: dimensions?.height,
        transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${zoom})`,
        transformOrigin: 'center center',
        visibility: dimensions ? 'visible' : 'hidden',
      }}
      onLoad={(event) => {
        const image = event.currentTarget;
        setLoadedImage({
          src,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      }}
      draggable={false}
    />
  );
}
