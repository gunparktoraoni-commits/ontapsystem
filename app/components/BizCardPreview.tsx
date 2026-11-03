'use client';

/**
 * BizCardPreview - thin wrapper around code-split theme components.
 *
 * Public API is intentionally preserved for existing imports:
 * - default export: BizCardPreview
 * - named exports: THEMES, getTheme, ThemeDef, BizCardPreviewProps
 */

import React from 'react';
import ThemeLoader from '../themes/ThemeLoader';
import { ThemePreviewModeProvider } from '../themes/components/PortfolioThemeContext';
import type { PortfolioData } from '../types';
import { withServablePortfolioMedia } from '../lib/portfolioDisplay';
import { SectionLoader } from './Loader';

export type { ThemeDef } from '../themes/shared';

export const THEMES = [
  {
    id: 'elegant-dark',
    name: 'Elegant Dark',
    bg: '#080912',
    cardBg: 'rgba(15,16,32,0.92)',
    glass: 'rgba(255,236,196,0.02)',
    text: '#f5ede0',
    textMuted: 'rgba(168,152,128,0.85)',
    accent: '#cc6a30',
    accentSoft: 'rgba(204,106,48,0.10)',
    gradient: 'linear-gradient(135deg,#080912 0%,#cc6a30 55%,#eaa05c 100%)',
    headerGradient: 'linear-gradient(160deg,#080912 0%,#0f1020 55%,#131425 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(204,106,48,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(192,136,40,0.08) 0%,transparent 50%)',
  },
  {
    id: 'elegant-dark-v2',
    name: 'Elegant Dark – Cool Slate',
    bg: '#0a0c14',
    cardBg: 'rgba(17,24,39,0.92)',
    glass: 'rgba(200,220,255,0.02)',
    text: '#e8edf8',
    textMuted: 'rgba(122,138,170,0.85)',
    accent: '#4f8ef7',
    accentSoft: 'rgba(79,142,247,0.10)',
    gradient: 'linear-gradient(135deg,#0a0c14 0%,#4f8ef7 55%,#7eb0ff 100%)',
    headerGradient: 'linear-gradient(165deg,#1a2035 0%,#0a0c14 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(79,142,247,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(126,176,255,0.08) 0%,transparent 50%)',
  },
  {
    id: 'elegant-dark-v3',
    name: 'Elegant Dark – Rose Noir',
    bg: '#0d080a',
    cardBg: 'rgba(26,13,16,0.92)',
    glass: 'rgba(255,210,210,0.02)',
    text: '#f8eded',
    textMuted: 'rgba(154,122,126,0.85)',
    accent: '#e85474',
    accentSoft: 'rgba(232,84,116,0.10)',
    gradient: 'linear-gradient(135deg,#0d080a 0%,#e85474 55%,#f4748e 100%)',
    headerGradient: 'linear-gradient(165deg,#251218 0%,#0d080a 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(232,84,116,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(244,116,142,0.08) 0%,transparent 50%)',
  },
  {
    id: 'ocean-gradient',
    name: 'Ocean Gradient',
    bg: '#030810',
    cardBg: 'rgba(8,18,32,0.88)',
    glass: 'rgba(45,212,184,0.06)',
    text: '#e8f4f0',
    textMuted: 'rgba(192,217,212,0.65)',
    accent: '#2dd4b8',
    accentSoft: 'rgba(45,212,184,0.12)',
    gradient: 'linear-gradient(135deg,#030810 0%,#0e7490 50%,#2dd4b8 100%)',
    headerGradient: 'linear-gradient(160deg,#0e7490 0%,#2dd4b8 55%,#a7f3d0 100%)',
    pattern:
      'radial-gradient(ellipse at 30% 70%,rgba(45,212,184,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 70% 30%,rgba(14,116,144,0.18) 0%,transparent 50%)',
  },
  {
    id: 'ocean-gradient-v2',
    name: 'Ocean Gradient – Verdant',
    bg: '#0a1209',
    cardBg: 'rgba(12,22,10,0.88)',
    glass: 'rgba(74,222,128,0.06)',
    text: '#e8f5e9',
    textMuted: 'rgba(180,210,185,0.65)',
    accent: '#4ade80',
    accentSoft: 'rgba(74,222,128,0.12)',
    gradient: 'linear-gradient(135deg,#0a1209 0%,#166534 50%,#4ade80 100%)',
    headerGradient: 'linear-gradient(160deg,#166534 0%,#4ade80 55%,#bbf7d0 100%)',
    pattern:
      'radial-gradient(ellipse at 30% 70%,rgba(74,222,128,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 70% 30%,rgba(22,101,52,0.16) 0%,transparent 50%)',
  },
  {
    id: 'ocean-gradient-v3',
    name: 'Ocean Gradient – Ember',
    bg: '#110508',
    cardBg: 'rgba(22,8,12,0.88)',
    glass: 'rgba(251,124,80,0.06)',
    text: '#f8ece8',
    textMuted: 'rgba(220,190,180,0.65)',
    accent: '#fb7c50',
    accentSoft: 'rgba(251,124,80,0.12)',
    gradient: 'linear-gradient(135deg,#110508 0%,#9a3412 50%,#fb7c50 100%)',
    headerGradient: 'linear-gradient(160deg,#9a3412 0%,#fb7c50 55%,#fed7aa 100%)',
    pattern:
      'radial-gradient(ellipse at 30% 70%,rgba(251,124,80,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 70% 30%,rgba(154,52,18,0.16) 0%,transparent 50%)',
  },
  {
    id: 'royal-purple',
    name: 'Royal Purple',
    bg: '#07020f',
    cardBg: 'rgba(17,7,31,0.88)',
    glass: 'rgba(192,132,252,0.06)',
    text: '#fdf8ff',
    textMuted: 'rgba(210,190,245,0.65)',
    accent: '#c084fc',
    accentSoft: 'rgba(192,132,252,0.12)',
    gradient: 'linear-gradient(135deg,#07020f 0%,#c084fc 50%,#f1b82d 100%)',
    headerGradient: 'linear-gradient(160deg,#1e003a 0%,#0f0022 100%)',
    pattern:
      'radial-gradient(ellipse at 25% 60%,rgba(192,132,252,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 75% 25%,rgba(241,184,45,0.10) 0%,transparent 50%)',
  },
  {
    id: 'royal-purple-v2',
    name: 'Royal Purple – Teal',
    bg: '#07100f',
    cardBg: 'rgba(15,30,28,0.88)',
    glass: 'rgba(52,216,192,0.06)',
    text: '#e8fffa',
    textMuted: 'rgba(180,220,210,0.65)',
    accent: '#34d8c0',
    accentSoft: 'rgba(52,216,192,0.12)',
    gradient: 'linear-gradient(135deg,#07100f 0%,#34d8c0 55%,#5eead4 100%)',
    headerGradient: 'linear-gradient(160deg,#003a32 0%,#002200 100%)',
    pattern:
      'radial-gradient(ellipse at 25% 60%,rgba(52,216,192,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 75% 25%,rgba(94,234,212,0.08) 0%,transparent 50%)',
  },
  {
    id: 'royal-purple-v3',
    name: 'Royal Purple – Amber',
    bg: '#100a07',
    cardBg: 'rgba(30,18,8,0.88)',
    glass: 'rgba(245,158,11,0.06)',
    text: '#fff8eb',
    textMuted: 'rgba(220,190,150,0.65)',
    accent: '#f59e0b',
    accentSoft: 'rgba(245,158,11,0.12)',
    gradient: 'linear-gradient(135deg,#100a07 0%,#f59e0b 55%,#fbbf24 100%)',
    headerGradient: 'linear-gradient(160deg,#3a1a00 0%,#220f00 100%)',
    pattern:
      'radial-gradient(ellipse at 25% 60%,rgba(245,158,11,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 75% 25%,rgba(251,191,36,0.08) 0%,transparent 50%)',
  },
  {
    id: 'green-gold',
    name: 'Green Gold',
    bg: '#f7f9f9',
    cardBg: 'rgba(255,255,255,0.86)',
    glass: 'rgba(13,148,136,0.10)',
    text: '#0f172a',
    textMuted: 'rgba(15,23,42,0.62)',
    accent: '#0d9488',
    accentSoft: 'rgba(13,148,136,0.18)',
    gradient: 'linear-gradient(135deg,#0d9488 0%,#14b8a6 50%,#f59e0b 100%)',
    headerGradient: 'linear-gradient(160deg,#f0fdfa 0%,#fffbeb 55%,#f0fdfa 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(13,148,136,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(245,158,11,0.10) 0%,transparent 50%)',
  },
  {
    id: 'blue-red',
    name: 'Blue Red',
    bg: '#f7f9fc',
    cardBg: 'rgba(255,255,255,0.88)',
    glass: 'rgba(59,130,246,0.10)',
    text: '#0f172a',
    textMuted: 'rgba(15,23,42,0.62)',
    accent: '#3b82f6',
    accentSoft: 'rgba(59,130,246,0.18)',
    gradient: 'linear-gradient(135deg,#3b82f6 0%,#60a5fa 45%,#ef4444 100%)',
    headerGradient: 'linear-gradient(160deg,#eff6ff 0%,#fff5f5 55%,#f8fbff 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(59,130,246,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(239,68,68,0.10) 0%,transparent 50%)',
  },
  {
    id: 'charcoal-yellow',
    name: 'Charcoal Yellow',
    bg: '#09090B',
    cardBg: 'rgba(28,28,30,0.92)',
    glass: 'rgba(250,204,21,0.12)',
    text: '#f4f4f5',
    textMuted: 'rgba(228,228,231,0.62)',
    accent: '#facc15',
    accentSoft: 'rgba(250,204,21,0.18)',
    gradient: 'linear-gradient(135deg,#09090B 0%,#27272a 45%,#facc15 100%)',
    headerGradient: 'linear-gradient(160deg,#0f0f12 0%,#1c1c1e 55%,#2a2a2e 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(250,204,21,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(245,158,11,0.08) 0%,transparent 50%)',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    bg: '#07111F',
    cardBg: 'rgba(15,23,42,0.92)',
    glass: 'rgba(125,211,252,0.10)',
    text: '#f8fafc',
    textMuted: 'rgba(226,232,240,0.62)',
    accent: '#38bdf8',
    accentSoft: 'rgba(56,189,248,0.18)',
    gradient: 'linear-gradient(135deg,#07111F 0%,#0F172A 45%,#38bdf8 100%)',
    headerGradient: 'linear-gradient(160deg,#07111F 0%,#0f172a 55%,#1e293b 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(56,189,248,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(125,211,252,0.10) 0%,transparent 50%)',
  },
  {
    id: 'light-blue',
    name: 'Light Blue',
    bg: '#f8fbff',
    cardBg: 'rgba(255,255,255,0.92)',
    glass: 'rgba(96,165,250,0.10)',
    text: '#0f172a',
    textMuted: 'rgba(15,23,42,0.62)',
    accent: '#2563eb',
    accentSoft: 'rgba(37,99,235,0.16)',
    gradient: 'linear-gradient(135deg,#eff6ff 0%,#2563eb 55%,#0284c7 100%)',
    headerGradient: 'linear-gradient(160deg,#ffffff 0%,#eff6ff 55%,#dbeafe 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(96,165,250,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(219,234,254,0.08) 0%,transparent 50%)',
  },
  {
    id: 'carbon-diamond',
    name: 'Carbon Diamond',
    bg: '#0B0C0D',
    cardBg: 'rgba(26,29,32,0.92)',
    glass: 'rgba(230,247,255,0.08)',
    text: '#eef6fb',
    textMuted: 'rgba(201,214,221,0.62)',
    accent: '#E6F7FF',
    accentSoft: 'rgba(230,247,255,0.18)',
    gradient: 'linear-gradient(135deg,#0B0C0D 0%,#1A1D20 45%,#E6F7FF 100%)',
    headerGradient: 'linear-gradient(160deg,#0b0c0d 0%,#1a1d20 55%,#111315 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(230,247,255,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(201,214,221,0.08) 0%,transparent 50%)',
  },
  {
    id: 'void-purple',
    name: 'Void Purple',
    bg: '#0B0C0D',
    cardBg: 'rgba(26,29,32,0.92)',
    glass: 'rgba(109,40,217,0.10)',
    text: '#f5f0ff',
    textMuted: 'rgba(201,201,209,0.62)',
    accent: '#6D28D9',
    accentSoft: 'rgba(109,40,217,0.18)',
    gradient: 'linear-gradient(135deg,#0B0C0D 0%,#6D28D9 55%,#C4B5FD 100%)',
    headerGradient: 'linear-gradient(160deg,#0b0c0d 0%,#1a1d20 55%,#111315 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(109,40,217,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(196,181,253,0.08) 0%,transparent 50%)',
  },
  {
    id: 'timeless-gold',
    name: 'Timeless Gold',
    bg: '#09090B',
    cardBg: 'rgba(26,29,32,0.92)',
    glass: 'rgba(214,176,109,0.10)',
    text: '#f4efe6',
    textMuted: 'rgba(180,174,164,0.62)',
    accent: '#D6B06D',
    accentSoft: 'rgba(214,176,109,0.18)',
    gradient: 'linear-gradient(135deg,#09090b 0%,#D6B06D 55%,#d4af37 100%)',
    headerGradient: 'linear-gradient(160deg,#09090b 0%,#111827 55%,#0f1112 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(214,176,109,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(181,157,103,0.08) 0%,transparent 50%)',
  },
  {
    id: 'hibiscus-dusk',
    name: 'Hibiscus Dusk',
    bg: '#ffecf8',
    cardBg: 'rgba(255,255,255,0.72)',
    glass: 'rgba(244,114,182,0.10)',
    text: '#831843',
    textMuted: 'rgba(131,24,67,0.65)',
    accent: '#f472b6',
    accentSoft: 'rgba(244,114,182,0.16)',
    gradient: 'linear-gradient(135deg,#831843 0%,#f472b6 55%,#ffecf8 100%)',
    headerGradient: 'linear-gradient(160deg,#831843 0%,#f472b6 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(244,114,182,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(255,236,248,0.20) 0%,transparent 50%)',
  },
  {
    id: 'classic-gold',
    name: 'Classic Gold',
    bg: '#fefae0',
    cardBg: '#fffcf2',
    glass: 'rgba(255,255,255,0.98)',
    text: '#000000',
    textMuted: '#6B5A44',
    accent: '#6f4518',
    accentSoft: 'rgba(111,69,24,0.08)',
    gradient: 'linear-gradient(135deg,#fefae0 0%,#6f4518 55%,#f3d5b5 100%)',
    headerGradient: 'linear-gradient(135deg,#6f4518 0%,#f3d5b5 50%,#6f4518 100%)',
    pattern: 'radial-gradient(circle, rgba(111,69,24,0.02) 1px, transparent 1px)',
  },
  {
    id: 'ocean-blue-gold',
    name: 'Ocean Blue Gold',
    bg: '#e8f1f7',
    cardBg: '#f0f7ff',
    glass: 'rgba(255,255,255,0.72)',
    text: '#0f2944',
    textMuted: '#4a6fa5',
    accent: '#0d5a7d',
    accentSoft: 'rgba(13,90,125,0.10)',
    gradient: 'linear-gradient(135deg,#0d5a7d 0%,#0a3d5a 45%,#d4af37 100%)',
    headerGradient: 'linear-gradient(160deg,#0d5a7d 0%,#0a3d5a 55%,#d4af37 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(13,90,125,0.08) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(212,175,55,0.10) 0%,transparent 50%)',
  },
  {
    id: 'pristine-gold',
    name: 'Pristine Gold',
    bg: '#0B0A08',
    cardBg: '#131210',
    glass: 'rgba(255,255,255,0.04)',
    text: '#F2EBD9',
    textMuted: '#9A8E7C',
    accent: '#C9A84C',
    accentSoft: 'rgba(201,168,76,0.12)',
    gradient: 'linear-gradient(135deg,#0B0A08 0%,#C9A84C 55%,#E8C97A 100%)',
    headerGradient: 'linear-gradient(135deg,#C9A84C 0%,#E8C97A 50%,#C9A84C 100%)',
    pattern: 'radial-gradient(circle, rgba(201,168,76,0.03) 1px, transparent 1px)',
  },
  {
    id: 'blood-rose',
    name: 'Blood Rose',
    bg: '#100507',
    cardBg: 'rgba(26,6,9,0.92)',
    glass: 'rgba(255,255,255,0.05)',
    text: '#F7EAF0',
    textMuted: 'rgba(184,146,156,0.8)',
    accent: '#FF4B78',
    accentSoft: 'rgba(255,75,120,0.18)',
    gradient: 'linear-gradient(135deg,#100507 0%,#FF4B78 55%,#FF7A9E 100%)',
    headerGradient: 'linear-gradient(160deg,#100507 0%,#241013 55%,#4f1b26 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(255,75,120,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(255,255,255,0.08) 0%,transparent 50%)',
  },
  {
    id: 'minty-green',
    name: 'Minty Green',
    bg: '#F7F8F4',
    cardBg: 'rgba(255,255,255,0.92)',
    glass: 'rgba(94,126,63,0.08)',
    text: '#1a2a12',
    textMuted: 'rgba(26,42,18,0.6)',
    accent: '#5E7E3F',
    accentSoft: 'rgba(94,126,63,0.14)',
    gradient: 'linear-gradient(135deg,#F7F8F4 0%,#5E7E3F 55%,#7D9D59 100%)',
    headerGradient: 'linear-gradient(135deg,#5E7E3F 0%,#7D9D59 50%,#5E7E3F 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(94,126,63,0.12) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(125,157,89,0.08) 0%,transparent 50%)',
  },
  {
    id: 'ice-variant',
    name: 'Ice Variant',
    bg: '#d7dce4',
    cardBg: 'rgba(241,244,248,0.95)',
    glass: 'rgba(255,255,255,0.7)',
    text: '#111318',
    textMuted: 'rgba(64,72,86,0.7)',
    accent: '#404856',
    accentSoft: 'rgba(64,72,86,0.12)',
    gradient: 'linear-gradient(135deg,#d7dce4 0%,#e8edf4 45%,#404856 100%)',
    headerGradient: 'linear-gradient(145deg,#ffffff 0%,#e8edf4 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(64,72,86,0.08) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(255,255,255,0.30) 0%,transparent 50%)',
  },
  {
    id: 'warm-pastel',
    name: 'Warm Pastel',
    bg: '#ECE7E1',
    cardBg: 'rgba(243,238,232,0.92)',
    glass: 'rgba(255,255,255,0.72)',
    text: '#111318',
    textMuted: '#525866',
    accent: '#404856',
    accentSoft: 'rgba(64,72,86,0.12)',
    gradient: 'linear-gradient(135deg,#ECE7E1 0%,#f6f0e8 45%,#404856 100%)',
    headerGradient: 'linear-gradient(145deg,#ffffff 0%,#f6f0e8 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(196,138,90,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(255,255,255,0.08) 0%,transparent 50%)',
  },
  {
    id: 'midnight-moon',
    name: 'Midnight Moon',
    bg: '#1E2028',
    cardBg: 'rgba(37,40,54,0.92)',
    glass: 'rgba(20,21,27,0.6)',
    text: '#E6EEF9',
    textMuted: '#98A6C8',
    accent: '#7AA2FF',
    accentSoft: 'rgba(122,162,255,0.12)',
    gradient: 'linear-gradient(135deg,#1E2028 0%,#2F3345 45%,#7AA2FF 100%)',
    headerGradient: 'linear-gradient(145deg,#2F3345 0%,#1a1d27 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 50%,rgba(122,162,255,0.08) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(47,51,69,0.06) 0%,transparent 50%)',
  },
  {
    id: 'violet-pink',
    name: 'Violet Pink',
    bg: '#f5f0ff',
    cardBg: '#faf5ff',
    glass: 'rgba(255,255,255,0.72)',
    text: '#2d1b4e',
    textMuted: '#8b5cf6',
    accent: '#6b46c1',
    accentSoft: 'rgba(107,70,193,0.10)',
    gradient: 'linear-gradient(135deg,#6b46c1 0%,#4c1d95 45%,#ec4899 100%)',
    headerGradient: 'linear-gradient(160deg,#6b46c1 0%,#4c1d95 55%,#ec4899 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(107,70,193,0.10) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(236,72,153,0.10) 0%,transparent 50%)',
  },
  {
    id: 'jasmine-mist',
    name: 'Jasmine Mist',
    bg: '#fff7ed',
    cardBg: 'rgba(255,255,255,0.98)',
    glass: 'rgba(255,255,255,0.9)',
    text: '#0f172a',
    textMuted: 'rgba(15,23,42,0.65)',
    accent: '#fbc4ab',
    accentSoft: 'rgba(251,196,171,0.22)',
    gradient: 'linear-gradient(135deg,#fff7ed 0%,#fbc4ab 50%,#ff85e9 100%)',
    headerGradient: 'linear-gradient(160deg,#fff 0%,#fff7ed 55%,#ffe4f3 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(251,196,171,0.18) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(255,133,233,0.12) 0%,transparent 50%)',
  },
  {
    id: 'rose-bloom',
    name: 'Rose Bloom',
    bg: '#1a0a2e',
    cardBg: 'rgba(255,255,255,0.14)',
    glass: 'rgba(255,255,255,0.14)',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.65)',
    accent: '#ec4899',
    accentSoft: 'rgba(236,72,153,0.18)',
    gradient: 'linear-gradient(135deg,#1a0a2e 0%,#ec4899 55%,#f472b6 100%)',
    headerGradient: 'linear-gradient(160deg,#1a0a2e 0%,#ec4899 50%,#f472b6 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(236,72,153,0.16) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(244,114,182,0.12) 0%,transparent 50%)',
  },
  {
    id: 'hot-orange',
    name: 'Hot Orange',
    bg: '#f8f7f2',
    cardBg: 'rgba(255,255,255,0.88)',
    glass: 'rgba(249,115,22,0.10)',
    text: '#0f172a',
    textMuted: 'rgba(15,23,42,0.62)',
    accent: '#f97316',
    accentSoft: 'rgba(249,115,22,0.18)',
    gradient: 'linear-gradient(135deg,#ea580c 0%,#f97316 50%,#ef4444 100%)',
    headerGradient: 'linear-gradient(160deg,#fffbf4 0%,#f8f7f2 55%,#fff1f2 100%)',
    pattern:
      'radial-gradient(ellipse at 20% 30%,rgba(249,115,22,0.14) 0%,transparent 60%),' +
      'radial-gradient(ellipse at 80% 20%,rgba(239,68,68,0.12) 0%,transparent 50%)',
  },
  {
    id: 'hitachi-solutions',
    name: 'Hitachi Solutions',
    bg: '#f8f9fa',
    cardBg: '#ffffff',
    glass: 'rgba(180,14,35,0.12)',
    text: '#2c3e50',
    textMuted: '#6c757d',
    accent: '#b10e23',
    accentSoft: 'rgba(177,14,35,0.18)',
    gradient: 'linear-gradient(135deg,#b10e23 0%,#b40810 50%,#f52614 100%)',
    headerGradient: 'linear-gradient(135deg,#b40810 0%,#f52614 100%)',
    pattern: 'linear-gradient(135deg,#b10e23 0%,#b40810 50%,#f52614 100%)',
  },
  {
    id: 'bubble-gem',
    name: 'BubbleGem',
    bg: '#060912',
    cardBg: 'rgba(255,255,255,0.08)',
    glass: 'rgba(255,255,255,0.08)',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.62)',
    accent: '#3B82F6',
    accentSoft: 'rgba(59,130,246,0.2)',
    gradient: 'linear-gradient(135deg,#060912 0%,#3B82F6 50%,#A5B4FC 100%)',
    headerGradient: 'linear-gradient(160deg,#0b1224 0%,#151a3a 45%,#1e1b4b 100%)',
    pattern:
      'radial-gradient(ellipse at 85% 8%,rgba(79,70,229,0.45) 0%,transparent 55%),' +
      'radial-gradient(ellipse at 10% 70%,rgba(59,130,246,0.28) 0%,transparent 58%)',
  },
  {
    id: 'frosted-crystal',
    name: 'Frosted Crystal',
    bg: '#070B18',
    cardBg: 'rgba(18,28,52,0.52)',
    glass: 'rgba(18,28,52,0.52)',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.62)',
    accent: '#00D4FF',
    accentSoft: 'rgba(0,212,255,0.12)',
    gradient: 'linear-gradient(135deg,#070B18 0%,#3B82F6 50%,#00D4FF 100%)',
    headerGradient: 'linear-gradient(165deg,#050814 0%,#070B18 42%,#0B1530 100%)',
    pattern:
      'radial-gradient(ellipse at 78% 12%,rgba(0,212,255,0.18) 0%,transparent 55%),' +
      'radial-gradient(ellipse at 12% 78%,rgba(59,130,246,0.2) 0%,transparent 58%)',
  },
  {
    id: 'dark-cinematic',
    name: 'Velvet Noir',
    bg: '#080808',
    cardBg: 'rgba(22,28,24,0.55)',
    glass: 'rgba(22,28,24,0.55)',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.62)',
    accent: '#DFFF4F',
    accentSoft: 'rgba(223,255,79,0.14)',
    gradient: 'linear-gradient(135deg,#080808 0%,#0E1410 45%,#DFFF4F 100%)',
    headerGradient: 'linear-gradient(180deg,#080808 0%,#0E1410 50%,#080808 100%)',
    pattern:
      'radial-gradient(ellipse at 50% 18%,rgba(40,70,48,0.45) 0%,transparent 58%),' +
      'radial-gradient(ellipse at 85% 75%,rgba(223,255,79,0.08) 0%,transparent 50%)',
  },
] as const;

export function getTheme(id?: string) {
  const normalizedId =
    id === 'candy-flush'
      ? 'rose-bloom'
      : id === 'fiery-sunset'
        ? 'hibiscus-dusk'
        : id === 'snow-contrast'
          ? 'jasmine-mist'
          : id;
  return THEMES.find((t) => t.id === normalizedId) ?? THEMES[0];
}

export type { ThemeFamilyDef } from "@/lib/constants/theme-families";
export {
  THEME_FAMILIES,
  getThemeFamily,
  getThemeFamilyById,
} from "@/lib/constants/theme-families";

export interface BizCardPreviewProps {
  themeId?: string;
  data?: PortfolioData;
  mini?: boolean;
  showFAB?: boolean;
  isMobile?: boolean;
  /** True when this mount is a theme picker / editor preview, not a live portfolio page. */
  isThemePreview?: boolean;
}

const BizCardPreview: React.FC<BizCardPreviewProps> = ({
  themeId,
  data,
  mini = false,
  showFAB = false,
  isMobile = false,
  isThemePreview = false,
}) => {
  const normalizedData = React.useMemo<PortfolioData | undefined>(() => {
    if (!data) return data;

    const services = Array.isArray((data as unknown as { services?: unknown }).services)
      ? (data as unknown as { services: PortfolioData['services'] }).services
      : [];

    const galleryRaw = Array.isArray((data as unknown as { gallery?: unknown }).gallery)
      ? (data as unknown as { gallery: NonNullable<PortfolioData['gallery']> }).gallery
      : [];

    const videosRaw = Array.isArray((data as unknown as { videos?: unknown }).videos)
      ? (data as unknown as { videos: NonNullable<PortfolioData['videos']> }).videos
      : [];

    // Keep real gallery entries only — do not invent gallery items from service
    // featured_image (that caused themes to strip service thumbnails as "duplicates").
    const derivedVideos = videosRaw.length > 0
      ? videosRaw
      : services
          .filter((service) => typeof service?.videoUrl === 'string' && Boolean(service.videoUrl?.trim()))
          .map((service, index) => ({
            id: Number(service.id ?? index + 1),
            title: String(service.title ?? '').trim() || `Video ${index + 1}`,
            description: String(service.description ?? '').trim(),
            fileName: String(service.videoUrl).trim(),
            fileSize: 0,
            mimeType: null,
            videoDataUrl: null,
          }));

    return withServablePortfolioMedia({
      ...data,
      services,
      gallery: galleryRaw.length > 0 ? galleryRaw : data.gallery,
      videos: derivedVideos.length > 0 ? derivedVideos : data.videos,
    });
  }, [data]);

  if (!normalizedData) {
    return <SectionLoader text="Loading preview..." />;
  }

  return (
    <ThemePreviewModeProvider enabled={isThemePreview}>
      <ThemeLoader themeId={themeId} data={normalizedData} mini={mini} showFAB={showFAB} isMobile={isMobile} />
    </ThemePreviewModeProvider>
  );
};

export default BizCardPreview;
