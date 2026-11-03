"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, ImageOff } from 'lucide-react';
import { toServableMediaSrc } from '../lib/portfolioDisplay';

export { toServableMediaSrc };

type MediaItem = {
  id: string | number;
  src: string;
  type: 'image' | 'video';
  title?: string;
};

interface Props {
  items: MediaItem[];
  intervalMs?: number; // Auto-advance interval for images (ms)
  className?: string;
  onVideoEnd?: () => void; // Callback when video finishes
  autoPlayVideo?: boolean; // Auto-play video on display
}

export default function ServiceMediaSlider({
  items,
  intervalMs = 3000,
  className = '',
  onVideoEnd,
  autoPlayVideo = false,
}: Props) {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const timerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Advance to next media
  const advance = useCallback(() => {
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  // Navigate to previous media
  const goToPrevious = useCallback(() => {
    setIndex((i) => (i - 1 + items.length) % items.length);
    setIsPlaying(false);
  }, [items.length]);

  // Navigate to next media
  const goToNext = useCallback(() => {
    setIndex((i) => (i + 1) % items.length);
    setIsPlaying(false);
  }, [items.length]);

  // Handle video play
  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
    // Clear any pending auto-advance timers
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Handle video pause
  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Handle video end - auto-advance to next media
  const handleVideoEnd = useCallback(() => {
    setIsPlaying(false);
    onVideoEnd?.();
    // Auto-advance after video ends
    timerRef.current = window.setTimeout(() => {
      advance();
    }, 500); // 500ms delay before auto-advance
  }, [advance, onVideoEnd]);

  // Handle video error
  const handleVideoError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const mediaSrc = e.currentTarget?.currentSrc || e.currentTarget?.src || '';
      console.error('[ServiceMediaSlider] Video playback error:', mediaSrc);
      setIsPlaying(false);
      // Auto-advance on error to allow viewing other media
      if (items.length > 1) {
        timerRef.current = window.setTimeout(() => {
          advance();
        }, 1000);
      }
    },
    [advance, items.length],
  );

  const handleImageError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const mediaSrc = e.currentTarget?.currentSrc || e.currentTarget?.src || '';
      console.error('[ServiceMediaSlider] Image load error:', mediaSrc);
      setImageFailed(true);
      if (items.length > 1) {
        timerRef.current = window.setTimeout(() => {
          advance();
        }, 1000);
      }
    },
    [advance, items.length],
  );

  // Reset failure state when the active slide changes
  useEffect(() => {
    setImageFailed(false);
  }, [index, items]);

  // Handle image auto-advance
  useEffect(() => {
    const active = items[index];

    // If no items or current is video, don't auto-advance
    if (!active || active.type === 'video' || isPlaying || imageFailed) {
      return;
    }

    // Set auto-advance timer for images
    timerRef.current = window.setTimeout(() => {
      advance();
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [index, items, intervalMs, isPlaying, advance, imageFailed]);

  // Auto-play video on mount/change if enabled
  useEffect(() => {
    const active = items[index];

    if (active?.type === 'video' && autoPlayVideo && videoRef.current) {
      // Reset video to start
      videoRef.current.currentTime = 0;
      // Attempt autoplay (will respect browser autoplay policies)
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          // Autoplay was prevented, user will click play
          console.debug('[ServiceMediaSlider] Autoplay prevented:', error);
        });
      }
    }
  }, [index, items, autoPlayVideo]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!items || items.length === 0) return null;

  const active = items[index];
  const isVideo = active.type === 'video';
  const mediaSrc = toServableMediaSrc(active.src);

  return (
    <div className={`relative group ${className}`}>
      {/* Main media display */}
      <div className="w-full bg-gray-100 overflow-hidden rounded-lg relative flex items-center justify-center min-h-0">
        {isVideo ? (
          <video
            ref={videoRef}
            src={mediaSrc}
            className="w-full h-full max-h-80 object-contain object-center"
            controls
            playsInline
            muted={isMuted}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onPlay={handleVideoPlay}
            onPause={handleVideoPause}
            onEnded={handleVideoEnd}
            onError={handleVideoError}
            controlsList="nodownload"
            style={{ backgroundColor: '#000' }}
          />
        ) : imageFailed ? (
          <div className="w-full min-h-36 flex flex-col items-center justify-center gap-2 bg-gray-800 text-gray-400">
            <ImageOff className="h-8 w-8 opacity-60" aria-hidden />
            <span className="text-xs font-medium">Image unavailable</span>
          </div>
        ) : (
          <img
            src={mediaSrc}
            alt={active.title ?? 'Media'}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="w-full h-auto max-h-80 object-contain object-center"
            onError={handleImageError}
          />
        )}

        {/* Video playback indicator */}
        {isVideo && (
          <div className="absolute top-2 right-2 bg-black/60 text-white text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5">
            {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {isPlaying ? 'Playing' : 'Paused'}
          </div>
        )}

        {/* Media index indicator */}
        <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs font-bold px-2.5 py-1 rounded-full">
          {index + 1}/{items.length}
        </div>
      </div>

      {/* Navigation buttons - only show if multiple items */}
      {items.length > 1 && (
        <div className="absolute inset-0 flex items-center justify-between px-3 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            type="button"
            onClick={goToPrevious}
            className="pointer-events-auto bg-white/80 hover:bg-white text-gray-900 rounded-full p-1.5 shadow-lg transition-all hover:shadow-xl"
            aria-label="Previous media"
            title="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goToNext}
            className="pointer-events-auto bg-white/80 hover:bg-white text-gray-900 rounded-full p-1.5 shadow-lg transition-all hover:shadow-xl"
            aria-label="Next media"
            title="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Video mute control */}
      {isVideo && (
        <button
          type="button"
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.muted = !isMuted;
              setIsMuted(!isMuted);
            }
          }}
          className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-colors opacity-0 group-hover:opacity-100"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          title={isMuted ? 'Unmute video' : 'Mute video'}
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      {/* Progress indicator for video */}
      {isVideo && isPlaying && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{
              width: videoRef.current
                ? `${(videoRef.current.currentTime / videoRef.current.duration) * 100}%`
                : '0%',
            }}
          />
        </div>
      )}

      {/* Dots for navigation */}
      {items.length > 1 && (
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => {
                setIndex(i);
                setIsPlaying(false);
              }}
              className={`w-2 h-2 rounded-full transition-all ${
                i === index ? 'bg-white w-6' : 'bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`Go to media ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
