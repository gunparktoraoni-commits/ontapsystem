'use client';

import React from 'react';
import { CheckCircle } from 'lucide-react';
import BizCardPreview from './BizCardPreview';
import { ThemePreviewPortalHost } from '../themes/components/PortfolioThemeContext';
import type { PortfolioData } from '../types';


interface PortfolioPreviewFrameProps {
  data?: PortfolioData;
  themeId?: string;
  className?: string;
  scrollClassName?: string;
  height?: number | string;
  scale?: number;
  scaleOrigin?: 'top left' | 'top center';
  scrollRef?: React.Ref<HTMLDivElement>;
  placeholder?: React.ReactNode;
  isMobile?: boolean;
}

const DEFAULT_PLACEHOLDER = (
  <div className="min-h-75 flex items-center justify-center bg-gray-50">
    <div className="text-center">
      <div className="w-20 h-20 bg-blue-100 rounded-full mx-auto mb-4 flex items-center justify-center">
        <CheckCircle className="h-10 w-10 text-[#2D3A8C]" />
      </div>
      <p className="text-sm text-gray-400">Your BizCard preview will appear here</p>
    </div>
  </div>
);


export default function PortfolioPreviewFrame({
  data,
  themeId,
  className = '',
  scrollClassName = '',
  height,
  scale = 1,
  scaleOrigin = 'top left',
  scrollRef,
  placeholder,
  isMobile,
}: PortfolioPreviewFrameProps) {
  const resolvedTheme = themeId ?? data?.selectedTheme ?? '';
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [scaledHeight, setScaledHeight] = React.useState<number | undefined>();


  const previewData = React.useMemo(() => {
    if (!data) return undefined;
    if (!resolvedTheme || data.selectedTheme === resolvedTheme) return data;
    return { ...data, selectedTheme: resolvedTheme };
  }, [data, resolvedTheme]);


  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const scaleStyle = safeScale === 1
    ? undefined
    : {
      transform: `scale(${safeScale})`,
      transformOrigin: scaleOrigin,
      width: scaleOrigin === 'top center' ? '400px' : `${(100 / safeScale).toFixed(3)}%`,
    };
  const scrollClasses = height
    ? `overflow-y-auto overflow-x-hidden scrollbar-thin ${scrollClassName}`.trim()
    : `max-h-105 overflow-y-auto overflow-x-hidden scrollbar-thin ${scrollClassName}`.trim();
  const scrollStyle: React.CSSProperties = {
    scrollBehavior: 'auto',
    overflowX: 'hidden',
    overscrollBehaviorX: 'none',
  };
  if (height !== undefined) scrollStyle.height = height;

  // CSS transform scale does not shrink layout size, so the scroll container
  // would otherwise allow scrolling through the unscaled (invisible) remainder.
  // Constrain the wrapper to the visual height so max scroll matches content end.
  React.useLayoutEffect(() => {
    if (safeScale === 1) {
      setScaledHeight(undefined);
      return;
    }

    const el = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      const next = el.offsetHeight * safeScale;
      setScaledHeight((prev) =>
        prev !== undefined && Math.abs(prev - next) < 0.5 ? prev : next
      );
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [safeScale, previewData, resolvedTheme]);

  return (
    <div className={`rounded-2xl overflow-hidden border border-gray-200 shadow-sm ${className}`.trim()}>
      {previewData ? (
        <ThemePreviewPortalHost className="h-full">
          <div ref={scrollRef} className={scrollClasses} style={scrollStyle}>
            <div
              style={
                safeScale === 1 || scaledHeight === undefined
                  ? undefined
                  : { height: scaledHeight, overflow: 'hidden' }
              }
            >
              <div ref={contentRef} style={scaleStyle}>
                <BizCardPreview
                  themeId={resolvedTheme || undefined}
                  data={previewData}
                  mini={false}
                  showFAB={false}
                  isMobile={isMobile ?? false}
                  isThemePreview
                />
              </div>
            </div>
          </div>
        </ThemePreviewPortalHost>
      ) : (
        placeholder ?? DEFAULT_PLACEHOLDER
      )}

    </div>
  );
}



export function ScaledThemePreview({
  data,
  themeId,
  className = '',
  viewportHeight,
}: {
  data?: PortfolioData;
  themeId?: string;
  className?: string;
  viewportHeight?: number;
}) {
  const resolvedTheme = themeId ?? data?.selectedTheme ?? '';
  return (
    <div
      className={`overflow-hidden pointer-events-none flex justify-center items-start bg-slate-100/80 rounded-2xl border border-slate-100 ${className}`.trim()}
      style={viewportHeight !== undefined ? { height: viewportHeight } : undefined}
    >
      <div
        className="shrink-0"
        style={{
          transform: 'scale(0.43)',
          width: '400px',
          transformOrigin: 'top center',
        }}
      >
        <PortfolioPreviewFrame
          data={data}
          themeId={resolvedTheme || undefined}
          height={480}
          scale={0.65}
          scaleOrigin="top center"
          className="rounded-[26px] border-0 shadow-none"
          scrollClassName="bg-transparent"
          isMobile
        />
      </div>
    </div>
  );
}
