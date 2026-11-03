
import React from 'react';
import { ChevronDown } from 'lucide-react';

export {
  SOCIAL_PLATFORM_CATALOG,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_CATEGORY_LABELS,
  resolveSocialPlatformDef,
  getUnusedSocialPlatforms,
  socialPlatformDisplayLabel,
} from '@/app/lib/socialPlatforms';

/* ── Image compression helper ── */
export async function compressImage(
  file: File,
  maxPx = 900,
  q = 0.78,
): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ratio  = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width  = img.width  * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', q));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Subtle client-side polish for profile photos (brightness / contrast / saturation). */
export async function enhanceProfileImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.filter = 'brightness(1.03) contrast(1.08) saturate(1.05)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image for enhancement'));
    img.src = dataUrl;
  });
}

export async function createCroppedImageDataUrl(
  sourceDataUrl: string,
  options: {
    aspectRatio: number;
    frameWidth: number;
    frameHeight: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
    outputWidth: number;
    outputHeight: number;
    mimeType?: string;
    quality?: number;
  },
): Promise<string> {
  const {
    aspectRatio,
    frameWidth,
    frameHeight,
    zoom,
    offsetX,
    offsetY,
    outputWidth,
    outputHeight,
    mimeType = 'image/jpeg',
    quality = 0.88,
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }

      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;
      const sourceAspect = naturalWidth / naturalHeight;

      let drawWidth: number;
      let drawHeight: number;

      if (sourceAspect > aspectRatio) {
        drawHeight = Math.max(outputHeight * zoom, 1);
        drawWidth = drawHeight * sourceAspect;
      } else {
        drawWidth = Math.max(outputWidth * zoom, 1);
        drawHeight = drawWidth / sourceAspect;
      }

      const panScaleX = outputWidth / frameWidth;
      const panScaleY = outputHeight / frameHeight;
      const targetOffsetX = ((outputWidth - drawWidth) / 2) + offsetX * panScaleX;
      const targetOffsetY = ((outputHeight - drawHeight) / 2) + offsetY * panScaleY;

      ctx.clearRect(0, 0, outputWidth, outputHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outputWidth, outputHeight);
      ctx.drawImage(img, targetOffsetX, targetOffsetY, drawWidth, drawHeight);
      resolve(canvas.toDataURL(mimeType, quality));
    };
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
    img.src = sourceDataUrl;
  });
}

export function getCropPreviewDimensions(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
) {
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header = '', base64 = ''] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}



/* ── Constants ── */
export const TITLE_OPTIONS  = ['', 'Engr.', 'Dr.', 'Atty.', 'Prof.', 'Arch.', 'CPA', 'RN', 'MD', 'Ret.'];
export const SUFFIX_OPTIONS = ['N/A', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];



export const THEMES = [
  { id: 'elegant-dark',   name: 'Elegant Dark',   grad: 'linear-gradient(135deg,#141832,#2A4792)', accent: '#4785B8' },
  { id: 'ocean-gradient', name: 'Ocean Gradient', grad: 'linear-gradient(135deg,#0f2027,#2CB5A0)', accent: '#2CB5A0' },
  { id: 'royal-purple',   name: 'Royal Purple',   grad: 'linear-gradient(135deg,#1a0533,#a855f7)', accent: '#a855f7' },
];



/* ── Shared UI primitives ── */

export function Label({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean; 
}) {
  return (
    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary pr-9 bg-white transition-colors"
      >
        {options.map(o => (
          <option key={o} value={o}>{o || '— Select —'}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
    </div>
  );
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
    />
  );
}

export function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
      <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-4 pb-3 border-b border-gray-100">
        {title}
      </h3>
      {children}
    </div>
  );
}
//
