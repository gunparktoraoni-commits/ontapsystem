/** DOM element to PNG download - using server-side rendering API */


export async function fetchImageAsDataUrl(src: string): Promise<string | null> {
  const normalized = src.trim();
  if (!normalized) return null;

  try {
    const response = await fetch(normalized, {
      mode: 'cors',
      credentials: 'same-origin',
      cache: 'force-cache',
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.size) return null;
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exportElementAsPng(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  throw new Error(
    'Client-side export is not available. Please use the server API endpoint instead.'
  );
}
