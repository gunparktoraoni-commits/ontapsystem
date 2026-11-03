import { describe, expect, it } from 'vitest';
import {
  createCroppedImageDataUrl,
  getCropPreviewDimensions,
} from '@/app/components/BizCardShared';

class MockCanvas {
  width = 0;
  height = 0;
  private fillStyleValue = '#ffffff';

  getContext() {
    return {
      clearRect: () => undefined,
      fillRect: () => undefined,
      drawImage: () => undefined,
      fillStyle: this.fillStyleValue,
    };
  }

  toDataURL = () => 'data:image/jpeg;base64,AAAA';
}

describe('createCroppedImageDataUrl', () => {
  it('creates a valid cropped JPEG data URL', async () => {
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;

    (globalThis as any).Image = class {
      naturalWidth = 200;
      naturalHeight = 200;
      width = 200;
      height = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    };

    (globalThis as any).document = {
      createElement: () => new MockCanvas(),
    };

    try {
      const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF' +
        'c0d0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJ0UkGAAAA' +
        'AABJRU5ErkJggg==';

      const result = await createCroppedImageDataUrl(source, {
        aspectRatio: 1,
        frameWidth: 256,
        frameHeight: 256,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        outputWidth: 400,
        outputHeight: 400,
        mimeType: 'image/jpeg',
        quality: 0.88,
      });

      expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(result.slice('data:image/jpeg;base64,'.length).trim().length).toBeGreaterThan(0);
    } finally {
      (globalThis as any).Image = originalImage;
      (globalThis as any).document = originalDocument;
    }
  });
});

describe('getCropPreviewDimensions', () => {
  it('fits a landscape image to cover a square frame without cropping the source first', () => {
    expect(getCropPreviewDimensions(400, 200, 256, 256)).toEqual({
      width: 512,
      height: 256,
    });
  });

  it('fits a portrait image to cover a square frame without cropping the source first', () => {
    expect(getCropPreviewDimensions(200, 400, 256, 256)).toEqual({
      width: 256,
      height: 512,
    });
  });
});
