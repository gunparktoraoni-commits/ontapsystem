'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SectionLoader } from "./Loader";
import { ModalPortal } from "./ModalPortal";
import { CropPreviewImage } from './CropPreviewImage';
import { Camera, User, Lock, ShieldCheck, ZoomIn, ZoomOut, X, Check, AlertCircle } from 'lucide-react';
import type { BizCardFormData, VCardFormData } from '../types';
import {
  compressImage,
  createCroppedImageDataUrl,
  enhanceProfileImage,
  dataUrlToBlob,
  SUFFIX_OPTIONS,
  Label,
  Input,
  Select,
  SectionCard,
} from './BizCardShared';
import AddressLocationFields, { type AddressFieldKey } from './AddressLocationFields';
import RichTextEditor from './RichTextEditor';
import ContactDetailsEditor from './ContactDetailsEditor';
import { toServableMediaSrc } from './ServiceMediaSlider';
import { sanitizeUrlAlias } from '@/lib/bizcard/url-alias-utils';
import { getFrontendApiBaseUrl } from './apiBase';
import { csrfClient } from '@/lib/csrf-client';
import { showConfirmDialog } from './ConfirmDialog';

const CROP_PREVIEW_SIZE = 256; // w-64 / h-64
const CROP_EXPORT_SIZE = 400;

const COVER_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm,.gif,application/pdf';

/** Matches server COVER_VIDEO_MAX_BYTES / MEDIA_LIMITS.IMAGE_MAX_BYTES */
const COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const COVER_VIDEO_MAX_BYTES = 15 * 1024 * 1024;

const COVER_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/pdf',
]);

const COVER_UNSUPPORTED_MSG =
  'Unsupported file type. Please upload an image (JPEG, PNG, GIF, WebP) or a video (MP4, WebM, MOV).';

function inferCoverMime(file: File): string {
  if (file.type) return file.type.toLowerCase().split(';')[0].trim();
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

async function uploadCoverFile(file: File): Promise<string> {
  const API = getFrontendApiBaseUrl();
  const token = await csrfClient.getToken(false, API || undefined);
  const headers = csrfClient.buildHeaders(token);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'cover');

  const res = await fetch(`${API}/api/media/upload`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: fd,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error || 'Cover upload failed. Please try again.');
  }

  const payload = (await res.json()) as { url?: string };
  const url = String(payload.url ?? '').trim();
  if (!url) throw new Error('Cover upload failed. Please try again.');
  return url;
}

function LockedInput({ value, placeholder }: { value: string; placeholder?: string }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        readOnly
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 pr-9 text-sm text-gray-500 bg-gray-50 cursor-not-allowed"
      />
      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-300 pointer-events-none" />
    </div>
  );
}



export interface VcardTabProps {
  bizCard: BizCardFormData;
  setBizCard: React.Dispatch<React.SetStateAction<BizCardFormData>>;
  vcard: VCardFormData;
  setVcard: React.Dispatch<React.SetStateAction<VCardFormData>>;
  setupCompleted: boolean;
  urlAliasEditable?: {
    allowed: boolean;
    daysRemaining: number;
    changeAvailableAt: string;
  };
  mapLinkError?: string | null;
}


export default function VcardTab({
  bizCard, setBizCard, vcard, setVcard, setupCompleted, urlAliasEditable, mapLinkError,
}: VcardTabProps) {
  const profileRef = useRef<HTMLInputElement>(null);
  const coverRef   = useRef<HTMLInputElement>(null);
  const coverPreviewUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [coverImageError, setCoverImageError] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  
  // Crop modal state (zoom + pan within the circular frame)
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropMode, setCropMode] = useState<'profile' | 'cover' | null>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropAspectRatio, setCropAspectRatio] = useState(1);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [isCropDragging, setIsCropDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const resetCropModal = () => {
    setIsCropModalOpen(false);
    setCropMode(null);
    setCropImage(null);
    setCropAspectRatio(1);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setIsCropDragging(false);
    cropDragRef.current = null;
    setLoading(false);
  };

  useEffect(() => {
    setCoverImageError(false);
  }, [bizCard.coverImage]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrlRef.current) {
        URL.revokeObjectURL(coverPreviewUrlRef.current);
        coverPreviewUrlRef.current = null;
      }
    };
  }, []);

  const updateBC = (k: keyof BizCardFormData, v: string | null) =>
    setBizCard(p => ({ ...p, [k]: v }));
  const updateVC = (k: keyof VCardFormData, v: string | number | null) =>
    setVcard(p => ({ ...p, [k]: v }));

  const revokeCoverPreview = () => {
    if (coverPreviewUrlRef.current) {
      URL.revokeObjectURL(coverPreviewUrlRef.current);
      coverPreviewUrlRef.current = null;
    }
  };

  const handleProfile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const nextSource = String(event.target?.result ?? '');
      setCropMode('profile');
      setCropAspectRatio(1);
      setCropImage(nextSource);
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setIsCropModalOpen(true);
    };
    reader.readAsDataURL(f);
  };

  const handleCropConfirm = useCallback(async () => {
    if (!cropImage || loading) return;

    setLoading(true);
    try {
      const outputWidth = cropMode === 'cover' ? 1400 : CROP_EXPORT_SIZE;
      const outputHeight = cropMode === 'cover' ? 850 : CROP_EXPORT_SIZE;
      const croppedDataUrl = await createCroppedImageDataUrl(cropImage, {
        aspectRatio: cropAspectRatio,
        frameWidth: CROP_PREVIEW_SIZE,
        frameHeight: CROP_PREVIEW_SIZE,
        zoom: cropZoom,
        offsetX: cropOffset.x,
        offsetY: cropOffset.y,
        outputWidth,
        outputHeight,
        mimeType: 'image/jpeg',
        quality: 0.9,
      });

      if (cropMode === 'profile') {
        const enhancedDataUrl = await enhanceProfileImage(croppedDataUrl);
        const blob = dataUrlToBlob(enhancedDataUrl);
        const file = new File([blob], 'cropped-profile.jpg', { type: 'image/jpeg' });
        const compressed = await compressImage(file, 400, 0.85);
        updateBC('profileImage', compressed);
      } else {
        updateBC('coverImage', croppedDataUrl);
        updateBC('coverType', 'image/jpeg');
        updateBC('coverFileName', 'cropped-cover.jpg');
      }

      resetCropModal();
    } finally {
      setLoading(false);
    }
  }, [cropAspectRatio, cropImage, cropMode, cropOffset, cropZoom, loading, updateBC]);

  const handleZoomIn = () => {
    setCropZoom(prev => Math.min(prev + 0.1, 3));
  };
  const handleZoomOut = () => {
    setCropZoom(prev => Math.max(prev - 0.1, 0.5));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  const handleCropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: cropOffset.x,
      originY: cropOffset.y,
    };
    setIsCropDragging(true);
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setCropOffset({
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    });
  };

  const handleCropPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    cropDragRef.current = null;
    setIsCropDragging(false);
  };

  const requestChangeCover = async () => {
    if (coverUploading) return;
    if (bizCard.coverImage) {
      const confirmed = await showConfirmDialog({
        title: 'Change cover',
        message: 'Replace your current cover media with a new file?',
        confirmLabel: 'Change cover',
        cancelLabel: 'Cancel',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    coverRef.current?.click();
  };

  const requestChangeProfile = async () => {
    if (bizCard.profileImage) {
      const confirmed = await showConfirmDialog({
        title: 'Change profile photo',
        message: 'Replace your current profile photo with a new image?',
        confirmLabel: 'Change photo',
        cancelLabel: 'Cancel',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    profileRef.current?.click();
  };

  const handleCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';

    setCoverImageError(false);
    setCoverError(null);

    const mime = inferCoverMime(f);
    if (!COVER_ALLOWED_MIME.has(mime)) {
      setCoverError(COVER_UNSUPPORTED_MSG);
      return;
    }

    const isVideo = mime.startsWith('video/');
    const isGif = mime === 'image/gif';
    const maxBytes = isVideo ? COVER_VIDEO_MAX_BYTES : COVER_IMAGE_MAX_BYTES;
    if (f.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      setCoverError(
        isVideo
          ? `Video must be ${maxMb} MB or smaller.`
          : `Image must be ${maxMb} MB or smaller.`,
      );
      return;
    }

    if (mime === 'application/pdf') {
      revokeCoverPreview();
      updateBC('coverImage', null);
      updateBC('coverType', 'application/pdf');
      updateBC('coverFileName', f.name);
      return;
    }

    if (isGif || isVideo) {
      revokeCoverPreview();
      const previewUrl = URL.createObjectURL(f);
      coverPreviewUrlRef.current = previewUrl;
      updateBC('coverImage', previewUrl);
      updateBC('coverType', mime);
      updateBC('coverFileName', f.name);

      setCoverUploading(true);
      try {
        const uploadedUrl = await uploadCoverFile(f);
        revokeCoverPreview();
        updateBC('coverImage', uploadedUrl);
        updateBC('coverType', mime);
        updateBC('coverFileName', f.name);
      } catch (err) {
        revokeCoverPreview();
        updateBC('coverImage', null);
        updateBC('coverType', null);
        updateBC('coverFileName', null);
        setCoverError(err instanceof Error ? err.message : 'Cover upload failed. Please try again.');
      } finally {
        setCoverUploading(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const nextSource = String(event.target?.result ?? '');
      setCropMode('cover');
      setCropAspectRatio(16 / 9);
      setCropImage(nextSource);
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setIsCropModalOpen(true);
    };
    reader.readAsDataURL(f);
  };
  const aliasLocked = setupCompleted && !(urlAliasEditable?.allowed ?? false);
  const addressValues = {
    addressArea: vcard.addressArea ?? '',
    addressHouseNo: vcard.addressHouseNo ?? '',
    addressBrgy: vcard.addressBrgy ?? '',
    addressCity: vcard.addressCity ?? '',
    addressRegion: vcard.addressRegion ?? '',
    addressZipcode: vcard.addressZipcode ?? '',
    addressMapLink: vcard.addressMapLink ?? '',
    addressLandmark: vcard.addressLandmark ?? '',
    addressLatitude: vcard.addressLatitude ?? null,
    addressLongitude: vcard.addressLongitude ?? null,
  };

  if (loading) return <SectionLoader text="Loading vcard..." />;
  
  return (
    <div className="space-y-4">
      {/* ── Profile + Cover media (side by side) ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-4 sm:p-5">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Profile — circle on the left */}
          <div className="relative shrink-0">
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full border border-gray-100 shadow-sm overflow-hidden flex items-center justify-center bg-gray-100">
              {bizCard.profileImage ? (
                <img
                  src={toServableMediaSrc(bizCard.profileImage)}
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  className="h-full w-full object-cover"
                  alt="Profile"
                />
              ) : (
                <User className="h-8 w-8 text-gray-400" />
              )}
            </div>
            <button
              type="button"
              onClick={() => void requestChangeProfile()}
              title="Upload profile photo — PNG or JPG only"
              className="absolute bottom-0.5 right-0.5 h-7 w-7 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:bg-primary-hover transition-colors"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input
              ref={profileRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={handleProfile}
            />
          </div>

          {/* Cover — wide rectangle on the right */}
          <div className="relative h-24 min-w-0 flex-1 overflow-hidden rounded-xl sm:h-28">
            {bizCard.coverImage && !coverImageError && bizCard.coverType?.startsWith('video/') ? (
              <video
                src={toServableMediaSrc(bizCard.coverImage)}
                className="absolute inset-0 h-full w-full object-cover object-center"
                muted
                autoPlay
                loop
                playsInline
                onError={() => setCoverImageError(true)}
              />
            ) : bizCard.coverImage && !coverImageError ? (
              <img
                src={toServableMediaSrc(bizCard.coverImage)}
                alt="Cover"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="absolute inset-0 h-full w-full object-cover object-center"
                onError={() => setCoverImageError(true)}
              />
            ) : (
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(135deg,#1e3a8a 0%,#3B569F 50%,#4785B8 100%)',
                }}
              />
            )}
            {bizCard.coverType === 'application/pdf' && !bizCard.coverImage && (
              <div className="absolute inset-0 flex items-center justify-center px-3">
                <p className="truncate text-xs font-semibold text-white/70">{bizCard.coverFileName}</p>
              </div>
            )}
            {coverUploading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35">
                <p className="text-xs font-semibold text-white">Uploading cover…</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => void requestChangeCover()}
              disabled={coverUploading}
              className="absolute top-2 right-2 flex items-center gap-1.5 rounded-xl bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-white disabled:opacity-60"
            >
              <Camera className="h-3.5 w-3.5" /> Change cover
            </button>
            <input
              ref={coverRef}
              type="file"
              accept={COVER_ACCEPT}
              className="hidden"
              onChange={handleCover}
            />
          </div>
        </div>

        {coverError && (
          <div className="mt-3 flex items-start gap-1.5 text-xs text-red-500">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{coverError}</span>
          </div>
        )}
        <p className="mt-3 text-[10px] text-gray-400">
          Profile photo: PNG or JPG — square crop recommended
        </p>
      </div>
      <SectionCard title="BizCard Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* URL Alias — editable on first setup; after that, 90-day cooldown */}
          <div>
            <Label required>URL Alias</Label>
            {aliasLocked ? (
              <>
                <LockedInput value={bizCard.urlAlias} />
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
                  <ShieldCheck className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-900">URL Alias Locked</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {urlAliasEditable && urlAliasEditable.daysRemaining > 0
                        ? `You can change your URL alias again in ${urlAliasEditable.daysRemaining} days.`
                        : 'URL alias changes are temporarily unavailable.'}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Input
                  value={bizCard.urlAlias}
                  onChange={v => updateBC('urlAlias', sanitizeUrlAlias(v))}
                  placeholder="e.g. jane-smith (3–64 chars)"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {setupCompleted
                    ? 'You can change your URL alias once every 90 days.'
                    : 'This is your permanent public URL'}
                </p>
              </>
            )}
          </div>
          <div>
            <Label required>BizCard Name</Label>
            <Input value={bizCard.bizCardName} onChange={v => updateBC('bizCardName', v)} placeholder="e.g. Jane Smith, Engr." />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Input value={bizCard.description} onChange={v => updateBC('description', v)} placeholder="Short tagline or bio" />
          </div>
        </div>
      </SectionCard>
      {/* ── VCard Information ── */}
      <SectionCard title="VCard Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          <div>
            <Label required>First Name</Label>
            <Input value={vcard.firstName} onChange={v => updateVC('firstName', v)} placeholder="First name" />
          </div>

          <div>
            <Label required>Last Name</Label>
            <Input value={vcard.lastName} onChange={v => updateVC('lastName', v)} placeholder="Last name" />
          </div>
          

          <div>
            <Label>Suffix</Label>
            <Select value={vcard.suffix} onChange={v => updateVC('suffix', v)} options={SUFFIX_OPTIONS} />
          </div>

          <div>
            <Label>Company / Occupation</Label>
            <Input value={bizCard.occupation} onChange={v => updateBC('occupation', v)} placeholder="Company or job title" />
          </div>

        </div>
      </SectionCard>

      {/* ── Address ── */}
      <SectionCard title="Address">
        <AddressLocationFields
          values={addressValues}
          onChange={(field: AddressFieldKey, value: string | number | null): void => updateVC(field as keyof VCardFormData, value)}
          mapLinkError={mapLinkError}
          inputClassName="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
      </SectionCard>
      {/* ── Bio ── */}
      <SectionCard title="Bio">
        <RichTextEditor
          value={vcard.about}
          onChange={v => updateVC('about', v)}
          placeholder="Write a short bio about yourself or your business…"
          rows={5}
          ariaLabel="Bio"
        />
      </SectionCard>
      {/* ── Contact Details ── */}
      <SectionCard title="Contact Details">
        <div className="space-y-4">
          <ContactDetailsEditor
            variant="edit"
            requireEmail
            values={{
              email: vcard.email,
              alternativeEmail: vcard.alternativeEmail,
              contactNumber: vcard.contactNumber,
              secondaryNumber: vcard.secondaryNumber,
              telephoneNumber: vcard.telephoneNumber,
              altTelephoneNumber: vcard.altTelephoneNumber,
            }}
            onChange={(next) => {
              setVcard((prev) => ({ ...prev, ...next }));
            }}
          />
        </div>
      </SectionCard>

      {/* Profile Image Crop Modal */}
      {isCropModalOpen && cropImage && (
        <ModalPortal isOpen={isCropModalOpen && !!cropImage} onClose={resetCropModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">Crop Profile Image</h3>
              <button
                type="button"
                onClick={resetCropModal}
                aria-label="Close crop modal"
                className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col items-center justify-center p-6 bg-gray-50">
              <div
                className={`relative border-4 border-white bg-white shadow-lg overflow-hidden touch-none ${
                  cropMode === 'cover' ? 'w-68 h-38 rounded-2xl' : 'w-64 h-64 rounded-full'
                } ${isCropDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onWheel={handleWheel}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerCancel={handleCropPointerUp}
              >
                {cropMode === 'profile' ? (
                  <CropPreviewImage
                    src={cropImage}
                    zoom={cropZoom}
                    offsetX={cropOffset.x}
                    offsetY={cropOffset.y}
                    frameWidth={CROP_PREVIEW_SIZE}
                    frameHeight={CROP_PREVIEW_SIZE}
                  />
                ) : (
                  <img
                    src={cropImage}
                    alt="Crop preview"
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
                    style={{
                      transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropZoom})`,
                      transformOrigin: 'center center',
                    }}
                    draggable={false}
                  />
                )}
                <div className={`absolute inset-0 pointer-events-none ${cropMode === 'cover' ? 'rounded-2xl border-2 border-primary/30' : 'rounded-full border-2 border-primary/30'}`} />
              </div>

              <div className="flex items-center gap-4 mt-6">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  aria-label="Zoom out"
                  className="h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  disabled={cropZoom <= 0.5 || loading}
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-gray-600 min-w-12 text-center">
                  {Math.round(cropZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  aria-label="Zoom in"
                  className="h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  disabled={cropZoom >= 3 || loading}
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs text-gray-500 mt-4 text-center">
                Drag to reposition · Scroll to zoom
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-white">
              <button
                type="button"
                onClick={resetCropModal}
                disabled={loading}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCropConfirm}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {loading ? 'Enhancing…' : 'Apply Crop'}
              </button>
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </ModalPortal>
      )}
    </div>
  );
}
