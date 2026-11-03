'use client';

import { Camera, ImageIcon, FileText, AlertCircle, ShieldCheck } from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';

import StepIndicator from './StepIndicator';
import { CropPreviewImage } from './CropPreviewImage';
import type { BizCardFormData } from '../types';
import { csrfClient } from '../../lib/csrf-client';
import { compressImage, createCroppedImageDataUrl, dataUrlToBlob } from './BizCardShared';

const COVER_POSITION_PRESETS = [
  { id: 'center top', label: 'Top' },
  { id: 'center center', label: 'Center' },
  { id: 'center bottom', label: 'Bottom' },
] as const;

interface SetupBizCardProps {
  onContinue?: (data: BizCardFormData) => void;
  onBack?: () => void;
  currentStep?: number;
  totalSteps?: number;
  initialData?: BizCardFormData;
  urlAliasEditable?: {
    allowed: boolean;
    daysRemaining: number;
    changeAvailableAt: string;
  };
}

const SetupBizCard: React.FC<SetupBizCardProps> = ({
  onContinue = () => {},
  onBack = () => {},
  currentStep = 1,
  totalSteps = 1,
  initialData,
  urlAliasEditable,
}) => {
  const [profileImage, setProfileImage] = useState<string | null>(initialData?.profileImage ?? null);
  const [coverImage, setCoverImage] = useState<string | null>(initialData?.coverImage ?? null);
  const [coverType, setCoverType] = useState<string | null>(initialData?.coverType ?? null);
  const [coverFileName, setCoverFileName] = useState<string | null>(initialData?.coverFileName ?? null);
  const [coverImagePosition, setCoverImagePosition] = useState(
    initialData?.coverImagePosition ?? 'center center'
  );
  // NEW: store image natural dimensions
  const [coverImageWidth, setCoverImageWidth] = useState<number | null>(null);
  const [coverImageHeight, setCoverImageHeight] = useState<number | null>(null);

  const [profileError, setProfileError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropMode, setCropMode] = useState<'profile' | 'cover' | null>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropAspectRatio, setCropAspectRatio] = useState(1);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [isCropDragging, setIsCropDragging] = useState(false);
  const cropDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const profileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const profilePreviewUrlRef = useRef<string | null>(null);
  const coverPreviewUrlRef = useRef<string | null>(null);
  const [formData, setFormData] = useState({
    urlAlias: initialData?.urlAlias ?? '',
    bizCardName: initialData?.bizCardName ?? '',
    description: initialData?.description ?? '',
    occupation: initialData?.occupation ?? '',
  });

  useEffect(() => {
    return () => {
      if (profilePreviewUrlRef.current) {
        URL.revokeObjectURL(profilePreviewUrlRef.current);
        profilePreviewUrlRef.current = null;
      }
      if (coverPreviewUrlRef.current) {
        URL.revokeObjectURL(coverPreviewUrlRef.current);
        coverPreviewUrlRef.current = null;
      }
    };
  }, []);

  const inferMimeType = (file: File) => {
    if (file.type) return file.type;
    const name = file.name.toLowerCase();
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.mp4')) return 'video/mp4';
    if (name.endsWith('.mov')) return 'video/quicktime';
    if (name.endsWith('.webm')) return 'video/webm';
    return 'application/octet-stream';
  };

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const normalizedMimeType = inferMimeType(file);
    const isImage = normalizedMimeType.startsWith('image/');
    if (!isImage) {
      setProfileError('Profile photo must be a JPG, JPEG, PNG, or WebP image.');
      e.target.value = '';
      return;
    }

    setProfileError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      setCropMode('profile');
      setCropAspectRatio(1);
      setCropImage(String(event.target?.result ?? ''));
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setIsCropModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const normalizedMimeType = inferMimeType(file);
    const isImage = normalizedMimeType.startsWith('image/');
    const isVideo = normalizedMimeType.startsWith('video/');

    if (!isImage && !isVideo) {
      setCoverError('Unsupported file type. Please upload an image (JPEG, PNG, GIF, WebP) or a video (MP4, WebM, MOV).');
      e.target.value = '';
      return;
    }

    setCoverError(null);
    setCoverType(normalizedMimeType);
    setCoverFileName(file.name);

    if (isVideo) {
      if (coverPreviewUrlRef.current) {
        URL.revokeObjectURL(coverPreviewUrlRef.current);
      }
      const previewUrl = URL.createObjectURL(file);
      coverPreviewUrlRef.current = previewUrl;
      setCoverImage(previewUrl);
      setCoverType(normalizedMimeType);
      setCoverFileName(file.name);
      setCoverImageWidth(null);
      setCoverImageHeight(null);

      const VERCEL_PAYLOAD_LIMIT_BYTES = 4.5 * 1024 * 1024;
      const shouldUseSigned = file.size > VERCEL_PAYLOAD_LIMIT_BYTES;
      if (shouldUseSigned) {
        performSignedUpload(file, normalizedMimeType).catch((err) => {
          console.error('Signed upload failed', err);
          setCoverError('Signed upload failed. Try again or provide a hosted URL.');
        });
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
    reader.readAsDataURL(file);
  };

  async function performSignedUpload(file: File, mimeType: string) {
    // 1) Request presigned URL from R2 signing endpoint
    const signOpts = await csrfClient.getFetchOptions('POST', {
      context: 'cover',
      file_name: file.name || `cover-${Date.now()}.${mimeType.split("/")[1] || "bin"}`,
    });
    const signRes = await fetch('/api/media/sign', signOpts);
    if (!signRes.ok) {
      const errorText = await signRes.text();
      throw new Error(errorText || 'Failed to obtain presigned URL');
    }
    const signJson = await signRes.json();

    if (!signJson.uploadUrl || !signJson.key) {
      throw new Error('Invalid presigned URL response');
    }

    // 2) Upload directly to R2 using the presigned URL
    const uploadRes = await fetch(signJson.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      throw new Error(`R2 upload failed: ${errorText || uploadRes.statusText}`);
    }

    // 3) Prefer canonical public URL from sign response
    const r2PublicUrl = String(signJson.publicUrl || '').trim()
      || `${window.location.origin}/${signJson.key}`;

    // 4) Register with our backend so DB records are created
    const registerOpts = await csrfClient.getFetchOptions('POST', {
      context: 'cover',
      url: r2PublicUrl,
      key: signJson.key,
      content_type: mimeType,
      size: file.size,
    });
    const registerRes = await fetch('/api/media/register', registerOpts);
    if (!registerRes.ok) {
      const txt = await registerRes.text();
      throw new Error('Register failed: ' + txt.slice(0, 200));
    }

    // Update UI with final R2 URL
    if (coverPreviewUrlRef.current) {
      URL.revokeObjectURL(coverPreviewUrlRef.current);
      coverPreviewUrlRef.current = null;
    }
    setCoverImage(r2PublicUrl);
    setCoverType(mimeType);
    setCoverFileName(file.name);
    setCoverError(null);
    setCoverUploadProgress(0);
    
    // Return the R2 public URL
    return { secure_url: r2PublicUrl };
  }

  const [coverUploadProgress, setCoverUploadProgress] = useState<number>(0);

  const resetCropModal = () => {
    setIsCropModalOpen(false);
    setCropMode(null);
    setCropImage(null);
    setCropAspectRatio(1);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setIsCropDragging(false);
    cropDragRef.current = null;
  };

  const handleCropConfirm = async () => {
    if (!cropImage) return;

    const cropped = await createCroppedImageDataUrl(cropImage, {
      aspectRatio: cropAspectRatio,
      frameWidth: 256,
      frameHeight: 256,
      zoom: cropZoom,
      offsetX: cropOffset.x,
      offsetY: cropOffset.y,
      outputWidth: cropMode === 'cover' ? 1400 : 400,
      outputHeight: cropMode === 'cover' ? 787 : 400,
      mimeType: 'image/jpeg',
      quality: 0.9,
    });

    if (cropMode === 'profile') {
      const blob = dataUrlToBlob(cropped);
      const file = new File([blob], 'profile-cropped.jpg', { type: 'image/jpeg' });
      const compressed = await compressImage(file, 400, 0.85);
      setProfileImage(compressed);
    } else {
      setCoverImage(cropped);
      setCoverType('image/jpeg');
      setCoverFileName('cropped-cover.jpg');
      const img = new Image();
      img.onload = () => {
        setCoverImageWidth(img.naturalWidth);
        setCoverImageHeight(img.naturalHeight);
      };
      img.src = cropped;
    }

    resetCropModal();
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setCropZoom((prev) => Math.min(Math.max(prev + (event.deltaY < 0 ? 0.1 : -0.1), 0.5), 3));
  };

  const handleCropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cropOffset.x,
      originY: cropOffset.y,
    };
    setIsCropDragging(true);
  };

  const handleCropPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCropOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const handleCropPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    cropDragRef.current = null;
    setIsCropDragging(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onContinue({
      urlAlias: formData.urlAlias,
      bizCardName: formData.bizCardName,
      description: formData.description,
      occupation: formData.occupation,
      profileImage,
      coverImage,
      coverType,
      coverFileName,
      coverImagePosition,
    });
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8">
      <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Set up your BizCard</h1>
      <p className="text-gray-400 text-sm mb-6">Set your bizCard to create your own digital card.</p>
      {isCropModalOpen && cropImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-bold text-gray-900">{cropMode === 'cover' ? 'Crop Cover Photo' : 'Crop Profile Photo'}</h3>
              <button type="button" onClick={resetCropModal} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">×</button>
            </div>
            <div className="bg-gray-50 p-6">
              <div
                className={`relative overflow-hidden border-4 border-white bg-white shadow-lg touch-none ${cropMode === 'cover' ? 'mx-auto h-36 w-64 rounded-2xl' : 'mx-auto h-64 w-64 rounded-full'} ${isCropDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
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
                    frameWidth={256}
                    frameHeight={256}
                  />
                ) : (
                  <img
                    src={cropImage}
                    alt="Crop preview"
                    className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                    style={{ transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropZoom})`, transformOrigin: 'center center' }}
                    draggable={false}
                  />
                )}
                <div className={`pointer-events-none absolute inset-0 ${cropMode === 'cover' ? 'rounded-2xl border-2 border-primary/30' : 'rounded-full border-2 border-primary/30'}`} />
              </div>
              <div className="mt-5 flex items-center justify-center gap-4">
                <button type="button" onClick={() => setCropZoom((prev) => Math.max(prev - 0.1, 0.5))} className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-lg text-gray-700">−</button>
                <span className="min-w-12 text-center text-sm font-medium text-gray-600">{Math.round(cropZoom * 100)}%</span>
                <button type="button" onClick={() => setCropZoom((prev) => Math.min(prev + 0.1, 3))} className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-lg text-gray-700">+</button>
              </div>
              <p className="mt-4 text-center text-xs text-gray-500">Drag to reposition • Scroll or use buttons to zoom</p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-white px-5 py-4">
              <button type="button" onClick={resetCropModal} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleCropConfirm} className="rounded-xl bg-[#2D3A8C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#243080]">Apply Crop</button>
            </div>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex flex-col items-center mb-4">
          <div
            className="relative w-28 h-28 rounded-full border-2 border-blue-300 overflow-hidden cursor-pointer group mb-2"
            onClick={() => profileRef.current?.click()}
          >
            {profileImage ? (
              <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                <Camera className="h-8 w-8 text-gray-300" />
              </div>
            )}
            <div className="absolute bottom-1 right-1 w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center border-2 border-white">
              <Camera className="h-3.5 w-3.5 text-[#2D3A8C]" />
            </div>
          </div>
          <span className="text-sm text-gray-500">Upload Photo</span>
          <p className="text-xs text-gray-400 mt-0.5">JPG or PNG only</p>
          {profileError && (
            <div className="flex items-center gap-1 text-red-500 text-xs mt-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {profileError}
            </div>
          )}
          <input ref={profileRef} type="file" accept=".jpg,.png" className="hidden" onChange={handleProfileChange} />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Cover Photo</label>
          <div
            className="w-full border border-gray-200 rounded-xl bg-gray-50 flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden"
            style={{
              // Dynamic aspect ratio based on uploaded image dimensions
              aspectRatio: coverImageWidth && coverImageHeight ? coverImageWidth / coverImageHeight : 'auto',
              // For placeholder, keep a minimum height so the UI looks nice
              minHeight: coverImageWidth && coverImageHeight ? undefined : '144px', // ≈ 36 * 4 = 144px (h-36)
              backgroundImage: coverImage && coverType?.startsWith('image/') ? `url(${coverImage})` : undefined,
              backgroundSize: 'cover', // now it won't crop because container matches image shape
              backgroundPosition: coverImagePosition,
              backgroundRepeat: 'no-repeat',
            }}
            onClick={() => coverRef.current?.click()}
          >
            {coverImage && coverType?.startsWith('image/') ? null : coverImage && coverType === 'application/pdf' ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="h-10 w-10 text-red-400" />
                  <span className="text-xs text-gray-600 font-medium px-4 text-center truncate max-w-full">
                    {coverFileName}
                  </span>
                  <span className="text-[10px] text-gray-400">PDF uploaded</span>
                </div>
              ) : coverImage && coverType?.startsWith('video/') ? (
                <div className="w-full h-full flex items-center justify-center">
                  <video src={coverImage} className="max-h-full max-w-full" controls muted playsInline />
                </div>
              ) : (
                <div className="w-full flex flex-col items-center justify-center">
                  <ImageIcon className="h-10 w-10 text-gray-300 mb-2" />
                  <span className="text-xs text-gray-500 font-medium">Click to upload cover</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">PNG, JPG, GIF, PDF, or Video · Recommended 1400 × 620 px</span>
                </div>
              )}
          </div>

          {coverImage && coverType?.startsWith('image/') && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">Cover focus</p>
              <div className="flex gap-2">
                {COVER_POSITION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setCoverImagePosition(preset.id)}
                    className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      coverImagePosition === preset.id
                        ? 'border-[#2D3A8C] bg-blue-50 text-[#2D3A8C]'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {coverError && (
            <div className="flex items-center gap-1 text-red-500 text-xs mt-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {coverError}
            </div>
          )}
          {coverUploadProgress > 0 && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                <div className="h-2 bg-blue-500" style={{ width: `${coverUploadProgress}%` }} />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Uploading cover: {coverUploadProgress}%</p>
            </div>
          )}
          <input
            ref={coverRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4,.mov,.webm"
            className="hidden"
            onChange={handleCoverChange}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            URL alias <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Custom Alias"
            value={formData.urlAlias}
            onChange={(e) => setFormData({ ...formData, urlAlias: e.target.value })}
            disabled={urlAliasEditable && !urlAliasEditable.allowed}
            className={`w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors ${
              urlAliasEditable && !urlAliasEditable.allowed
                ? 'bg-amber-50 border-amber-200 text-gray-600 cursor-not-allowed'
                : ''
            }`}
            required
          />
          {urlAliasEditable && !urlAliasEditable.allowed && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">URL Alias Locked</p>
                <p className="text-xs text-amber-700 mt-1">
                  You can change your URL alias again in {urlAliasEditable.daysRemaining} days.
                </p>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            BizCard Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Your BizCard display name"
            value={formData.bizCardName}
            onChange={(e) => setFormData({ ...formData, bizCardName: e.target.value })}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            required
          />
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <label className="block text-sm font-semibold text-gray-700">Description</label>
            <span className="text-xs text-blue-500">optional</span>
          </div>
          <textarea
            placeholder="Short description for your card"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Role <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Your role or professional title"
            value={formData.occupation}
            onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            required
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Back
          </button>
          <button
            type="submit"
            className="flex-1 bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
};

export default SetupBizCard;