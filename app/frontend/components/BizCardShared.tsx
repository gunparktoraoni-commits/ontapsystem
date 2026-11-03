
import React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Globe, Linkedin, Facebook, Instagram, Youtube, Twitter, Music2,
} from 'lucide-react';

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

export const SOCIAL_PLATFORMS = [
  { key: 'LinkedIn',  Icon: Linkedin,  color: '#0A66C2' },
  { key: 'Facebook',  Icon: Facebook,  color: '#1877F2' },
  { key: 'Instagram', Icon: Instagram, color: '#E4405F' },
  { key: 'YouTube',   Icon: Youtube,   color: '#FF0000' },
  { key: 'Twitter',   Icon: Twitter,   color: '#1DA1F2' },
  { key: 'TikTok',    Icon: Music2,    color: '#69C9D0' },
  { key: 'Website',   Icon: Globe,     color: '#6366f1' },
];



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
