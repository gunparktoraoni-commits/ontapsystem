'use client';

import { CheckCircle } from 'lucide-react';
import React from 'react';
import StepIndicator from './StepIndicator';
import { ScaledThemePreview } from './PortfolioPreviewFrame';
import { InlineLoader } from './Loader';
import type { PortfolioData } from '../types';

interface CompletedSetupProps {
  onFinish: (serialId?: string) => void;
  onBack: () => void;
  currentStep: number;
  totalSteps: number;
  portfolioData?: PortfolioData;
  portfolioUrl?: string;
  qrCode?: string;
  finishing?: boolean;
  finishError?: string;
  bizcardSerialId?: string;
}
const CompletedSetup: React.FC<CompletedSetupProps> = ({
  onFinish,
  onBack,
  currentStep,
  totalSteps,
  portfolioData,
  portfolioUrl = '',
  qrCode = '',
  finishing = false,
  finishError = '',
  bizcardSerialId = '',
}) => {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'error'>('idle');

  const hasPortfolioUrl = Boolean(portfolioUrl.trim());
  const qrPreview = qrCode.trim();

  const services = React.useMemo(() => {
    const rows = portfolioData?.services;
    if (!Array.isArray(rows)) return [];
    return rows.filter((service) => Boolean(service?.title?.trim()));
  }, [portfolioData]);

  const gallery = React.useMemo(() => {
    const deduped = new Map<string, { src: string; title?: string }>();
    const direct = Array.isArray(portfolioData?.gallery) ? portfolioData!.gallery : [];
    for (const item of direct) {
      const src = String(item?.url || item?.imageDataUrl || '').trim();
      if (!src) continue;
      const key = src.toLowerCase();
      if (deduped.has(key)) continue;
      deduped.set(key, { src, title: String(item?.title ?? '').trim() || undefined });
    }

    const fromServices = Array.isArray(portfolioData?.services) ? portfolioData!.services : [];
    for (const service of fromServices) {
      const src = String(service?.featured_image ?? '').trim();
      if (!src) continue;
      const key = src.toLowerCase();
      if (deduped.has(key)) continue;
      deduped.set(key, { src, title: String(service?.title ?? '').trim() || undefined });
    }

    return Array.from(deduped.values());
  }, [portfolioData]);

  const videos = React.useMemo(() => {
    const deduped = new Map<string, { src: string; title: string }>();
    const direct = Array.isArray(portfolioData?.videos) ? portfolioData!.videos : [];
    for (const item of direct) {
      const src = String(item?.fileName || item?.videoDataUrl || '').trim();
      if (!src) continue;
      const key = src.toLowerCase();
      if (deduped.has(key)) continue;
      deduped.set(key, {
        src,
        title: String(item?.title ?? '').trim() || 'Video',
      });
    }

    const fromServices = Array.isArray(portfolioData?.services) ? portfolioData!.services : [];
    for (const service of fromServices) {
      const src = String(service?.videoUrl ?? '').trim();
      if (!src) continue;
      const key = src.toLowerCase();
      if (deduped.has(key)) continue;
      deduped.set(key, {
        src,
        title: String(service?.title ?? '').trim() || 'Video',
      });
    }

    return Array.from(deduped.values());
  }, [portfolioData]);

  const handleCopyPortfolioUrl = async () => {
    if (!hasPortfolioUrl) return;
    try {
      await navigator.clipboard.writeText(portfolioUrl.trim());
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1600);
    }
  };

  const handleDownloadQr = async () => {
    if (!qrPreview) return;
    try {
      const response = await fetch(qrPreview);
      const blob = await response.blob();
      const fileUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = fileUrl;
      anchor.download = 'ontap-portfolio-qr.png';
      anchor.click();
      URL.revokeObjectURL(fileUrl);
    } catch {
      window.open(qrPreview, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8">
      <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
      <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Completed Set-up</h1>
      <p className="text-gray-400 text-sm text-center mb-6">This is the preview of your virtual card</p>
    
      {/* Card Preview */}
      <ScaledThemePreview data={portfolioData} viewportHeight={280} className="mb-6 bg-gray-50 border-gray-200" />
      {/* Portfolio Link + QR Code */}
      {/* Services / Products, Videos, Gallery preview */}
    

     
      {/* Success Badge */}
      <div className="flex items-center justify-center gap-2 mb-6 py-3 bg-green-50 rounded-xl">
        <CheckCircle className="h-5 w-5 text-green-500" />
        <span className="text-sm font-medium text-green-700">Your portfolio is ready!</span>
      </div>
      {/* Buttons */}
      {finishError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">
          {finishError}
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={finishing}
          className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onFinish(bizcardSerialId || undefined)}
          disabled={finishing}
          className="flex-1 bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer inline-flex items-center justify-center gap-2"
        >
          {finishing ? (
            <>
              <InlineLoader />
              Finishing...
            </>
          ) : (
            'Finish setup'
          )}
        </button>
      </div>
    </div>
  );
};

export default CompletedSetup;