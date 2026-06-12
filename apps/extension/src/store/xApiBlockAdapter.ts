import type { BlockExecutorAdapter } from '@xshield/block-executor';

const X_API_BLOCK_URL = 'https://x.com/i/api/1.1/blocks/create.json';
const FALLBACK_X_WEB_BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejR0pILlMyg2s3gk5snEs%3D' +
  '6fVuTrO9XKX2jZCyLQ5x3Wx0d3d9jH6p0Y8ykYI8nI4';
const TOKEN_CACHE_KEY = 'xshield:x-web-bearer-token';

export type XBlockSkipReason = 'already-blocked' | 'not-found' | 'id-mismatch';

export class XBlockSkipError extends Error {
  constructor(
    public readonly reason: XBlockSkipReason,
    message: string,
  ) {
    super(message);
    this.name = 'XBlockSkipError';
  }
}

export class XBlockAuthError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'XBlockAuthError';
  }
}

function normalizeUsername(username: string): string {
  return username.replace(/^@+/, '').trim();
}

function getErrorText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const errors = (payload as { errors?: Array<{ message?: string; code?: number }> }).errors;
  if (Array.isArray(errors)) {
    return errors
      .map((error) => [error.code, error.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
  }
  const message = (payload as { message?: string; error?: string }).message || (payload as { error?: string }).error;
  return message || '';
}

function isAlreadyBlocked(message: string): boolean {
  return /already.*block|blocked/i.test(message);
}

function isNotFoundOrUnavailable(message: string): boolean {
  return /not found|doesn.?t exist|suspended|unavailable|no user/i.test(message);
}

async function getCookie(name: string): Promise<string | undefined> {
  const urls = ['https://x.com', 'https://twitter.com'];
  for (const url of urls) {
    const cookie = await chrome.cookies.get({ url, name });
    if (cookie?.value) return cookie.value;
  }
  return undefined;
}

async function getCsrfToken(): Promise<string> {
  const token = await getCookie('ct0');
  if (!token) {
    throw new XBlockAuthError('X login cookie ct0 is missing. Open x.com and make sure this Chrome profile is logged in.');
  }
  return token;
}

function findBearerToken(source: string): string | undefined {
  const matches = source.match(/AAAAAAAAAAAAAAAA[A-Za-z0-9%_-]{40,}/g);
  return matches?.[0];
}

async function getCachedBearerToken(): Promise<string | undefined> {
  const value = await chrome.storage.local.get(TOKEN_CACHE_KEY);
  return typeof value[TOKEN_CACHE_KEY] === 'string' ? value[TOKEN_CACHE_KEY] : undefined;
}

async function cacheBearerToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_CACHE_KEY]: token });
}

function getScriptUrls(html: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[^"']+\.js/g,
    /["'](\/responsive-web\/client-web\/[^"']+\.js)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1] || match[0];
      urls.add(value.startsWith('http') ? value : `https://abs.twimg.com${value}`);
    }
  }

  return Array.from(urls).slice(0, 24);
}

async function discoverBearerToken(): Promise<string> {
  const cached = await getCachedBearerToken();
  if (cached) return cached;

  try {
    const homeResponse = await fetch('https://x.com/home', { credentials: 'include' });
    const html = await homeResponse.text();
    const inlineToken = findBearerToken(html);
    if (inlineToken) {
      await cacheBearerToken(inlineToken);
      return inlineToken;
    }

    for (const scriptUrl of getScriptUrls(html)) {
      try {
        const scriptResponse = await fetch(scriptUrl, { credentials: 'omit' });
        const token = findBearerToken(await scriptResponse.text());
        if (token) {
          await cacheBearerToken(token);
          return token;
        }
      } catch {
        // Keep trying other X web bundles.
      }
    }
  } catch {
    // Fall back to the bundled token below.
  }

  return FALLBACK_X_WEB_BEARER_TOKEN;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export class XApiBlockAdapter implements BlockExecutorAdapter {
  async blockUser(username: string): Promise<void> {
    const normalized = normalizeUsername(username);
    if (!normalized) throw new XBlockSkipError('not-found', 'Missing username');

    const csrfToken = await getCsrfToken();
    const bearerToken = await discoverBearerToken();
    const body = new URLSearchParams({
      screen_name: normalized,
      skip_status: '1',
    });

    const response = await fetch(X_API_BLOCK_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrf-token': csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': navigator.language?.slice(0, 2) || 'en',
      },
      body,
    });

    const payload = await parseResponse(response);
    const errorText = getErrorText(payload);

    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove(TOKEN_CACHE_KEY);
      throw new XBlockAuthError(
        errorText || `X rejected the block request with HTTP ${response.status}. Please confirm x.com is logged in.`,
        response.status,
      );
    }

    if (!response.ok) {
      if (isAlreadyBlocked(errorText)) {
        throw new XBlockSkipError('already-blocked', errorText || `@${normalized} is already blocked`);
      }
      if (isNotFoundOrUnavailable(errorText)) {
        throw new XBlockSkipError('not-found', errorText || `@${normalized} is unavailable`);
      }
      throw new Error(errorText || `X block request failed with HTTP ${response.status}`);
    }

    const returnedUsername = normalizeUsername(
      String((payload as { screen_name?: string; username?: string }).screen_name || ''),
    );
    if (returnedUsername && returnedUsername.toLowerCase() !== normalized.toLowerCase()) {
      throw new XBlockSkipError(
        'id-mismatch',
        `X returned @${returnedUsername} while queue item expected @${normalized}`,
      );
    }
  }
}
