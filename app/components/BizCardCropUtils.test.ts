import { describe, expect, it } from 'vitest';
import { createCroppedImageDataUrl } from './BizCardShared';

describe('createCroppedImageDataUrl', () => {
  it('returns a JPEG data URL for a valid source image', async () => {
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
    expect(result.length).toBeGreaterThan(100);
  });
});
