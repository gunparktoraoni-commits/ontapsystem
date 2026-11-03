'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import { useIsThemePreview, useThemePreviewPortal } from './PortfolioThemeContext';

interface PDFViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string;
  title?: string;
  description?: string;
}

export function PDFViewerModal({
  isOpen,
  onClose,
  pdfUrl,
  title,
  description
}: PDFViewerModalProps) {
  const [mounted, setMounted] = useState(false);
  const isThemePreview = useIsThemePreview();
  const previewPortal = useThemePreviewPortal();
  const contained = Boolean(isThemePreview && previewPortal);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted || typeof document === 'undefined') return null;
  if (contained && !previewPortal) return null;

  const portalTarget = contained && previewPortal ? previewPortal : document.body;
  const positionClass = contained ? 'absolute inset-0' : 'fixed inset-0';

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = title || 'document.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return createPortal(
    <div
      className={`${positionClass} flex items-center justify-center bg-black/95 p-4 z-50`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'PDF viewer'}
    >
      <div
        className="relative w-full max-w-4xl max-h-96 flex flex-col bg-gray-900 rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
          <div className="flex-1">
            {title && <h3 className="text-lg font-semibold text-white truncate">{title}</h3>}
            {description && (
              <p className="text-sm text-gray-400 truncate mt-1">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-2 hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-950">
          <div className="flex items-center justify-center h-full">
            <iframe
              src={`${pdfUrl}#toolbar=1&navpanes=0`}
              className="w-full h-full border-0"
              title={title || 'PDF Viewer'}
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-gray-700 bg-gray-800">
          <div className="flex-1">
            <p className="text-xs text-gray-400">
              Use browser controls to navigate pages. Iframe displays native PDF toolbar.
            </p>
          </div>

          <button
            onClick={handleDownload}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors ml-auto"
            aria-label="Download PDF"
            title="Download PDF"
          >
            <Download className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
