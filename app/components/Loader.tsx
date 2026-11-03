'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface LoaderProps {
  /**
   * Size of the loader - 'sm' (16px), 'md' (24px), 'lg' (32px), 'xl' (40px)
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';

  /**
   * Color of the loader - uses Tailwind color classes
   * @default 'text-primary'
   */
  color?: string;

  /**
   * Custom className to merge with default styles
   */
  className?: string;

  /**
   * Optional text to display below/beside the loader
   */
  text?: string;

  /**
   * Position of text relative to loader: 'bottom' or 'inline'
   * @default 'bottom'
   */
  textPosition?: 'bottom' | 'inline';

  /**
   * Text color class
   */
  textColor?: string;
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-24 w-24',
};

/**
 * Unified Loader Component
 * 
 * Displays an animated loader GIF for loading states.
 * 
 * @example
 * // Basic usage
 * <Loader />
 * 
 * // With custom size and color
 * <Loader size="lg" color="text-blue-500" />
 * 
 * // With loading text
 * <Loader text="Loading..." textPosition="inline" />
 * 
 * // Full page loader
 * <div className="flex items-center justify-center min-h-screen">
 *   <Loader size="xl" text="Loading..." />
 * </div>
 */
export default function Loader({
  size = 'md',
  color = 'text-primary',
  className,
  text,
  textPosition = 'bottom',
  textColor = 'text-gray-500',
}: LoaderProps) {
  const sizeClass = sizeMap[size];
  const containerClass = textPosition === 'inline' ? 'flex items-center gap-2' : 'flex flex-col items-center gap-2';

  return (
    <div className={containerClass}>
      <img
        src="/loader.gif"
        alt="Loading"
        width={size === 'sm' ? 16 : size === 'md' ? 24 : size === 'lg' ? 32 : 96}
        height={size === 'sm' ? 16 : size === 'md' ? 24 : size === 'lg' ? 32 : 96}
        className={cn(sizeClass, className)}
        style={{ display: 'block' }}
        draggable={false}
        decoding="async"
      />

      {text && <span className={cn('text-sm font-medium', textColor)}>{text}</span>}
    </div>
  );
}

/**
 * Skeleton Loader Component
 * 
 * Displays a pulsing skeleton placeholder for content that is loading.
 * 
 * @example
 * // Single line skeleton
 * <SkeletonLoader />
 * 
 * // Custom dimensions
 * <SkeletonLoader width="w-32" height="h-10" />
 * 
 * // Multiple skeleton lines
 * <div className="space-y-2">
 *   <SkeletonLoader />
 *   <SkeletonLoader width="w-3/4" />
 * </div>
 */
export function SkeletonLoader({
  width = 'w-full',
  height = 'h-4',
  className,
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gray-200',
        width,
        height,
        className
      )}
    />
  );
}

/**
 * Inline Loader Component
 * 
 * Compact loader for inline use in buttons, links, or text.
 * Uses Loader2 icon from lucide-react for smooth spinning animation.
 * 
 * @example
 * <button>
 *   <InlineLoader /> Loading...
 * </button>
 */
export function InlineLoader({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin inline-block', className)} />;
}

/**
 * Full Page Loader Component
 *
 * Centered loader for full-viewport loading states (auth gates, route entry).
 * Do not use inside panels/tabs — use SectionLoader instead to avoid stacking
 * min-h-screen loaders over parent chrome.
 *
 * @example
 * <FullPageLoader text="Loading your content..." />
 */
export function FullPageLoader({
  text = 'Loading...',
  size = 'xl',
  color = 'text-primary',
}: {
  text?: string;
  size?: 'md' | 'lg' | 'xl';
  color?: string;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center">
      <Loader size={size} color={color} text={text} textPosition="bottom" />
    </div>
  );
}

/**
 * Section Loader Component
 *
 * Centered loader that fills its parent (panel, tab, modal body) without
 * forcing min-h-screen — use this to avoid overlapping full-page loaders.
 *
 * @example
 * <SectionLoader text="Loading connections..." />
 */
export function SectionLoader({
  text,
  size = 'lg',
  color = 'text-primary',
  className,
  minHeightClass = 'min-h-48',
}: {
  text?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
  className?: string;
  minHeightClass?: string;
}) {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center py-10',
        minHeightClass,
        className,
      )}
    >
      <Loader size={size} color={color} text={text} textPosition="bottom" />
    </div>
  );
}
