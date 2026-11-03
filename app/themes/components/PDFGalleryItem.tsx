'use client';

import React, { useState } from 'react';
import { FileText, Download, Eye } from 'lucide-react';
import { PDFViewerModal } from './PDFViewerModal';

interface PDFGalleryItemProps {
  id: number;
  url: string;
  title?: string;
  description?: string;
  cardRadius?: string;
  glass?: string;
  textMuted?: string;
  accent?: string;
  mini?: boolean;
  variant?: string;
}

export function PDFGalleryItem({
  id,
  url,
  title,
  description,
  cardRadius = 'rounded-2xl',
  glass = 'rgba(255, 255, 255, 0.05)',
  textMuted = '#999999',
  accent = '#3b82f6',
  mini = false,
  variant = 'default'
}: PDFGalleryItemProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = url;
    link.download = title || `document-${id}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsModalOpen(true);
  };

  // Per-theme sizing
  const cardWidth = mini
    ? '92px'
    : variant === 'ocean-gradient'
      ? 'min(72vw, 240px)'
      : variant === 'royal-purple'
        ? 'min(60vw, 200px)'
        : 'min(70vw, 220px)';

  const cardAspect = variant === 'royal-purple'
    ? 'aspect-3/4'
    : variant === 'ocean-gradient'
      ? 'aspect-4/3'
      : 'aspect-square';

  const pdfThumbnailGradient = `linear-gradient(135deg, ${accent}55, ${accent}18)`;

  return (
    <>
      <button
        type="button"
        onClick={handleView}
        className={`group relative overflow-hidden ${cardRadius} border border-white/10 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          mini ? '' : 'focus:ring-offset-black'
        }`}
        style={{
          backgroundColor: glass,
          width: mini ? 'auto' : cardWidth,
          aspectRatio: mini ? undefined : cardAspect.replace('aspect-', '').replace('/', ' / ')
        }}
        title={`View ${title || 'PDF document'}`}
      >
        {/* PDF Icon Background */}
        <div
          className={`${mini ? 'aspect-square' : cardAspect} w-full h-full flex flex-col items-center justify-center gap-2 p-3`}
          style={{ background: pdfThumbnailGradient }}
        >
          <FileText className={`${mini ? 'h-6 w-6' : 'h-10 w-10'} text-white opacity-80`} />
          {!mini && (
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">PDF</span>
          )}
        </div>

        {/* Overlay on Hover */}
        {!mini && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/75 via-black/15 to-transparent opacity-0 group-hover:opacity-90 transition-opacity" />

            {/* Title and Description */}
            {(title || description) && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                {title && (
                  <p className="text-sm font-bold leading-tight drop-shadow truncate">
                    {title}
                  </p>
                )}
                {description && (
                  <p className="text-[11px] mt-0.5 opacity-90 line-clamp-2">
                    {description}
                  </p>
                )}
              </div>
            )}

            {/* Action Icons */}
            <div className="pointer-events-none absolute right-2.5 top-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={handleView}
                className="pointer-events-auto rounded-lg bg-black/55 p-1.5 text-white hover:bg-black/75 transition-colors"
                title="View PDF"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="pointer-events-auto rounded-lg bg-black/55 p-1.5 text-white hover:bg-black/75 transition-colors"
                title="Download PDF"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}

        {/* Mini Mode Actions */}
        {mini && (
          <div className="pointer-events-auto absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded">
            <button
              type="button"
              onClick={handleView}
              className="p-1 hover:bg-white/20 rounded transition-colors"
              title="View"
            >
              <Eye className="h-3 w-3 text-white" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="p-1 hover:bg-white/20 rounded transition-colors"
              title="Download"
            >
              <Download className="h-3 w-3 text-white" />
            </button>
          </div>
        )}
      </button>

      {/* PDF Viewer Modal */}
      <PDFViewerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        pdfUrl={url}
        title={title}
        description={description}
      />
    </>
  );
}
