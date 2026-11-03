import { FrontendSubscriptionError } from './frontendErrorCodes';

interface ThemeRequestOptions {
  apiBase: string;
  themeId?: number;
  themePath?: string;
  alias?: string;
  previewOnly?: boolean;
  fetcher?: typeof fetch;
}

function buildBody(themeId: number | undefined, themePath: string | undefined, previewOnly: boolean, alias?: string): string {
  if (typeof themeId === 'number' && Number.isFinite(themeId) && themeId > 0) {
    return JSON.stringify({
      theme_id: String(themeId),
      preview_only: previewOnly,
      ...(alias ? { alias } : {}),
    });
  }
  if (typeof themePath === 'string' && themePath.trim()) {
    return JSON.stringify({
      theme_path: themePath,
      preview_only: previewOnly,
      ...(alias ? { alias } : {}),
    });
  }
  throw new Error('Either themeId or themePath must be provided');
}

export async function applyThemeSelectionWithFallback(options: ThemeRequestOptions): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const previewOnly = Boolean(options.previewOnly);
  const body = buildBody(options.themeId, options.themePath, previewOnly, options.alias);

  const primary = await fetcher(`${options.apiBase}/api/vcard/design/theme`, {
    method: 'PUT',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (primary.status !== 404) {
    return primary;
  }

  const fallback = await fetcher(`${options.apiBase}/api/bizcard/theme`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!fallback.ok) {
    const err = new Error('Theme API endpoint unavailable.') as Error & {
      errorCode?: FrontendSubscriptionError;
      requestId?: string;
    };
    err.errorCode = FrontendSubscriptionError.THEME_API_NOT_FOUND;
    const payload = (await fallback.clone().json().catch(() => null)) as { meta?: { requestId?: string } } | null;
    err.requestId = payload?.meta?.requestId;
    throw err;
  }

  return fallback;
}
