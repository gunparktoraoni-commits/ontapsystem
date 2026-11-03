'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapPin, AlertCircle } from 'lucide-react';
import { InlineLoader } from './Loader';
import { fetchGeocodeFromApi } from '../lib/addressGeocode';
import {
  isPrioritizedMapInput,
  parseGoogleMapsLink,
} from '../lib/portfolioMaps';
import RichTextEditor from './RichTextEditor';

const AddressMapPicker = dynamic(() => import('./AddressMapPicker'), {
  ssr: false,
  loading: () => <div className="h-52 w-full animate-pulse rounded-xl bg-gray-100" />,
});

export type AddressFieldKey =
  | 'addressArea'
  | 'addressHouseNo'
  | 'addressBrgy'
  | 'addressCity'
  | 'addressRegion'
  | 'addressZipcode'
  | 'addressMapLink'
  | 'addressLandmark'
  | 'addressLatitude'
  | 'addressLongitude';

export interface AddressLocationFieldsProps {
  values: Partial<Record<AddressFieldKey, string | number | null>>;
  onChange: (field: AddressFieldKey, value: string | number | null) => void;
  mapLinkError?: string | null;
  inputClassName?: string;
  labelClassName?: string;
}

type MapViewCenter = { latitude: number; longitude: number };

export default function AddressLocationFields({
  values,
  onChange,
  mapLinkError: externalMapLinkError,
  inputClassName = 'w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors',
  labelClassName = 'block text-sm font-semibold text-gray-700 mb-1',
}: AddressLocationFieldsProps) {
  const safeString = (val: unknown): string => String(val ?? '');

  const [mapLinkError, setMapLinkError] = useState<string | null>(null);

  const mapLinkAbortRef = useRef<AbortController | null>(null);
  const lastProcessedMapLinkRef = useRef<string>('');
  const mapLinkTimerRef = useRef<number | null>(null);
  const [geocodeStatus, setGeocodeStatus] = useState<'idle' | 'loading' | 'not_found' | 'error'>('idle');
  const [targetZoom, setTargetZoom] = useState<number | null>(null);
  const [mapViewCenter, setMapViewCenter] = useState<MapViewCenter | null>(null);

  const applyMapPin = useCallback(
    (coords: MapViewCenter, options?: { zoom?: number }) => {
      onChange('addressLatitude', coords.latitude);
      onChange('addressLongitude', coords.longitude);
      setMapViewCenter(coords);
      setTargetZoom(options?.zoom ?? 16);
    },
    [onChange],
  );
  
  const clearMapPin = useCallback(() => {
    onChange('addressLatitude', null);
    onChange('addressLongitude', null);
    setMapViewCenter(null);
    setTargetZoom(null);
    setGeocodeStatus('idle');
  }, [onChange]);

  // Derive map preview coordinates only from the Google Maps link the user provides.
  useEffect(() => {
    const mapLink = String(values.addressMapLink ?? '').trim();
    if (!mapLink) {
      lastProcessedMapLinkRef.current = '';
      setMapLinkError(null);
      clearMapPin();
      return;
    }

    const parsed = parseGoogleMapsLink(mapLink);
    if (!parsed.ok) {
      lastProcessedMapLinkRef.current = '';
      setMapLinkError(parsed.error);
      clearMapPin();
      return;
    }

    if (parsed.kind === 'empty') {
      lastProcessedMapLinkRef.current = '';
      setMapLinkError(null);
      clearMapPin();
      return;
    }

    if (lastProcessedMapLinkRef.current === mapLink) {
      return;
    }

    setMapLinkError(null);

    if (mapLinkTimerRef.current) clearTimeout(mapLinkTimerRef.current);
    if (mapLinkAbortRef.current) {
      mapLinkAbortRef.current.abort();
      mapLinkAbortRef.current = null;
    }

    mapLinkTimerRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      mapLinkAbortRef.current = controller;
      setGeocodeStatus('loading');

      try {
        let latitude: number;
        let longitude: number;

        if (parsed.kind === 'coords') {
          latitude = parsed.latitude;
          longitude = parsed.longitude;
        } else {
          // Always send the raw Maps URL for short links so the server can follow redirects.
          const geocodeQuery =
            mapLink && /maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps|maps\.google\./i.test(mapLink)
              ? mapLink
              : parsed.query;
          const result = await fetchGeocodeFromApi(
            {},
            { q: geocodeQuery, signal: controller.signal },
          );

          if (!result) {
            setGeocodeStatus('not_found');
            clearMapPin();
            return;
          }

          latitude = result.latitude;
          longitude = result.longitude;
        }

        if (controller.signal.aborted) return;

        lastProcessedMapLinkRef.current = mapLink;
        applyMapPin({ latitude, longitude }, { zoom: 16 });
        setGeocodeStatus('idle');
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setGeocodeStatus('idle');
          return;
        }
        setGeocodeStatus('error');
        clearMapPin();
      } finally {
        if (mapLinkAbortRef.current === controller) {
          mapLinkAbortRef.current = null;
        }
      }
    }, 450);

    return () => {
      if (mapLinkTimerRef.current) clearTimeout(mapLinkTimerRef.current);
      if (mapLinkAbortRef.current) {
        mapLinkAbortRef.current.abort();
        mapLinkAbortRef.current = null;
      }
    };
  }, [values.addressMapLink, applyMapPin, clearMapPin]);

  const hasPin = values.addressLatitude != null && values.addressLongitude != null;
  const mapZoom = targetZoom ?? (hasPin ? 15 : mapViewCenter ? 13 : 6);
  const latNum = values.addressLatitude != null ? Number(values.addressLatitude) : null;
  const lngNum = values.addressLongitude != null ? Number(values.addressLongitude) : null;
  const displayMapLinkError = externalMapLinkError || mapLinkError;

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClassName}>Google Maps link</label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="url"
            placeholder="Paste your Google Maps location link"
            value={values.addressMapLink || ''}
            onChange={(e) => {
              const next = e.target.value;
              onChange('addressMapLink', next);
              lastProcessedMapLinkRef.current = '';
              const trimmed = next.trim();
              if (!trimmed) {
                setMapLinkError(null);
                return;
              }
              const parsed = parseGoogleMapsLink(trimmed);
              if (!parsed.ok) {
                setMapLinkError(parsed.error);
                return;
              }
              setMapLinkError(null);
              if (isPrioritizedMapInput(trimmed)) {
                onChange('addressCity', '');
                onChange('addressRegion', '');
              }
            }}
            className={`${inputClassName} pl-11`}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Your Google Maps link is the only location source for your BizCard. Open Google Maps, copy the share link, and paste it here.
        </p>
        {displayMapLinkError && (
          <div className="flex items-center gap-1.5 text-xs text-red-500 mt-1">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{displayMapLinkError}</span>
          </div>
        )}
      </div>

      <div>
        <label className={labelClassName}>Landmark / Office details</label>
        <RichTextEditor
          value={safeString(values.addressLandmark)}
          onChange={(html) => onChange('addressLandmark', html)}
          placeholder="Building name, floor, nearby landmarks, parking notes…"
          rows={4}
          ariaLabel="Landmark or office details"
        />
        <p className="text-xs text-gray-500 mt-1">
          Shown when visitors hover the location pin on your portfolio map.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Location preview</label>
        {geocodeStatus === 'not_found' && (
          <p className="text-xs text-amber-600 mb-2">
            Could not resolve a map pin from this link. Check the URL or try a different Google Maps share link.
          </p>
        )}
        {geocodeStatus === 'error' && (
          <p className="text-xs text-red-500 mb-2">
            Map preview is temporarily unavailable. Your link will still be saved.
          </p>
        )}
        {geocodeStatus === 'loading' && (
          <p className="text-xs text-gray-500 mb-2 inline-flex items-center gap-1.5">
            <InlineLoader /> Updating map…
          </p>
        )}
        <AddressMapPicker
          latitude={latNum}
          longitude={lngNum}
          viewCenter={mapViewCenter}
          zoom={mapZoom}
          targetZoom={targetZoom}
          showPin={hasPin}
        />
      </div>
    </div>
  );
}
