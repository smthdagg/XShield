/**
 * Shared utils — ported 1:1 from X(Twitter) Comment Blocker 1.4.3 utils.js.
 * Iterator-helper methods are replaced with equivalent array operations
 * (identical behaviour); everything else matches the original line by line.
 */

export const browserApi: typeof chrome = (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome;

export const DEFAULT_CLOUD_OWNER_REPO = 'amahteru/x-comment-blocker';

function cloudApiUrl(ownerRepo: string): string {
  return `https://api.github.com/repos/${ownerRepo}/contents/keywords.txt`;
}
function cloudCdnUrl(ownerRepo: string): string {
  return `https://fastly.jsdelivr.net/gh/${ownerRepo}@main/keywords.txt`;
}
export const SYNC_INTERVAL_MINUTES = 360;
export const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;
// eslint-disable-next-line no-misleading-character-class
export const invisibleCharsRegex = /\p{Default_Ignorable_Code_Point}/gv;

const fastHandleRegex = /^[@/]?([a-zA-Z0-9_]{1,15})$/;

export function isKeywordRegex(k: string): boolean {
  return typeof k === 'string' && k.length >= 3 && /^\/.+\/[a-zA-Z]*$/v.test(k);
}

export function extractCleanScreenName(input: string): string {
  if (!input) return '';
  const simpleMatch = fastHandleRegex.exec(input);
  if (simpleMatch) {
    return simpleMatch[1].toLowerCase();
  }
  const cleaned = input.replaceAll(invisibleCharsRegex, '').trim();
  const match = cleaned.match(/(?:^|\/|@)(?<handle>[a-zA-Z0-9_]{1,15})(?:\/|\?|$)/v);
  if (match) return (match.groups?.handle ?? '').toLowerCase();
  return '';
}

/** Local calendar date as YYYY-MM-DD (1.5.1 checkDailyReset format). */
export function getLocalDateString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STORAGE_DEFAULTS: Record<string, unknown> = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: '',
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  blockGrok: false,
  enabled: true,
  blockedCount: 0,
  blockedHistory: [],
  lastSyncTime: 0,
  syncStatus: '',
  syncError: '',
  cloudETag: '',
  blockedUsersOnX: [],
  historyFilterReason: 'all',
  autoBlockKeywords: [],
  disabledCloudKeywords: [],
  autoBlockQueue: [],
  autoBlockToday: 0,
  autoBlockLastDate: '',
  autoBlockPausedUntil: 0,
  autoBlockBatchCount: 0,
  whitelist: [],
  // XShield extension keys (not part of 1.4.3)
  highlightMode: false,
};

export function getStorageDefaults(...keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(STORAGE_DEFAULTS, key)) {
      const value = STORAGE_DEFAULTS[key];
      result[key] = Array.isArray(value) ? [] : value;
    }
  }
  return result;
}

export function parseKeywords(text: string): string[] {
  if (!text) return [];
  const result: string[] = [];
  for (const line of text.split('\n')) {
    const k = line.replaceAll(invisibleCharsRegex, '').trim();
    if (!k) continue;
    if (isKeywordRegex(k)) {
      result.push(k);
    } else {
      result.push(k.toLowerCase());
    }
  }
  return result;
}

export async function syncCloudKeywords(ownerRepo: string = DEFAULT_CLOUD_OWNER_REPO): Promise<boolean> {
  const { cloudEnabled } = await browserApi.storage.local.get(getStorageDefaults('cloudEnabled'));
  if (!cloudEnabled) return false;

  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3.raw' };
    const { cloudETag } = await browserApi.storage.local.get(getStorageDefaults('cloudETag'));
    if (cloudETag) {
      headers['If-None-Match'] = cloudETag as string;
    }

    let resp: Response;
    let isCDN = false;

    try {
      resp = await fetch(cloudApiUrl(ownerRepo), {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 403 || resp.status === 429) {
        throw new Error('API Rate Limit');
      }
      if (!resp.ok && resp.status !== 304) {
        throw new Error(`API HTTP Error: ${resp.status}`);
      }
    } catch (apiError) {
      console.warn('[X-Blocker] API update failed, falling back to CDN:', apiError);
      isCDN = true;
      try {
        resp = await fetch(`${cloudCdnUrl(ownerRepo)}?t=${Date.now()}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) {
          throw new Error(`CDN HTTP Error: ${resp.status}`);
        }
      } catch (cdnError) {
        console.warn('[X-Blocker] CDN failed, using bundled keywords:', cdnError);
        resp = await fetch(browserApi.runtime.getURL('keywords.txt'));
        if (!resp.ok) {
          throw new Error('Bundled keywords missing');
        }
      }
    }

    if (!isCDN && resp.status === 304) {
      await browserApi.storage.local.set({
        lastSyncTime: Date.now(),
        syncStatus: 'ok',
        syncError: '',
      });
      return true;
    }

    const text = await resp.text();
    const newETag = isCDN ? '' : (resp.headers.get('ETag') ?? '');

    const cloudList = parseKeywords(text);

    const storageItems = await browserApi.storage.local.get(
      getStorageDefaults('disabledCloudKeywords', 'autoBlockKeywords', 'keywords', 'cloudKeywords'),
    );

    const currentCloudList = parseKeywords((storageItems.cloudKeywords as string) ?? '');

    if (isCDN && cloudList.length < currentCloudList.length) {
      console.log(
        `[X-Blocker] CDN cache (${cloudList.length} items) is older than local (${currentCloudList.length} items). Update aborted.`,
      );
      await browserApi.storage.local.set({
        lastSyncTime: Date.now(),
        syncStatus: 'ok',
        syncError: '',
      });
      return true;
    }
    const disabledCloudKeywords = (storageItems.disabledCloudKeywords as string[]) ?? [];
    const autoBlockKeywords = (storageItems.autoBlockKeywords as string[]) ?? [];
    const userKws = parseKeywords((storageItems.keywords as string) ?? '');

    const cloudListSet = new Set(cloudList);
    const cleanedDisabled = disabledCloudKeywords.filter((k) => cloudListSet.has(k));
    const userKwsSet = new Set(userKws);
    const cleanedAutoBlock = autoBlockKeywords.filter((k) => cloudListSet.has(k) || userKwsSet.has(k));

    await browserApi.storage.local.set({
      cloudKeywords: cloudList.join('\n'),
      disabledCloudKeywords: cleanedDisabled,
      autoBlockKeywords: cleanedAutoBlock,
      cloudETag: newETag,
      lastSyncTime: Date.now(),
      syncStatus: 'ok',
      syncError: '',
    });
    return true;
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    await browserApi.storage.local
      .set({
        syncStatus: 'error',
        syncError: isTimeout ? '同步超时，请检查网络' : '网络连接失败',
      })
      .catch(() => {});
    return false;
  }
}

// ---- XShield additions (kept from our build; not part of 1.4.3) ----

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Contributor write: upload cloud + custom keywords to the user's own repo. */
export async function submitKeywordsToGithub(): Promise<{ success: boolean; reason?: string }> {
  const stored = await chrome.storage.local.get({
    githubToken: '',
    githubOwnerRepo: '',
    githubBranch: 'main',
    keywords: '',
    cloudKeywords: '',
  });
  const token = stored.githubToken as string;
  const ownerRepo = stored.githubOwnerRepo as string;
  const branch = (stored.githubBranch as string) || 'main';
  if (!token || !ownerRepo) {
    return { success: false, reason: '请先在设置中填写 GitHub Token 与仓库' };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ownerRepo)) {
    return { success: false, reason: '仓库格式应为 owner/repo' };
  }

  const userKws = parseKeywords((stored.keywords as string) ?? '');
  const cloudKws = parseKeywords((stored.cloudKeywords as string) ?? '');
  const localKws = Array.from(new Set([...cloudKws, ...userKws]));
  if (localKws.length === 0) {
    return { success: false, reason: '本地没有词库（先同步或添加自定义词）' };
  }

  const apiBase = `https://api.github.com/repos/${ownerRepo}/contents/keywords.txt`;
  const authHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  try {
    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(15000),
    });
    let sha: string | null = null;
    let existingKws: string[] = [];
    if (getRes.ok) {
      const meta = (await getRes.json()) as { sha?: string; content?: string };
      sha = meta.sha ?? null;
      if (meta.content) existingKws = parseKeywords(base64ToUtf8(meta.content));
    } else if (getRes.status !== 404) {
      return { success: false, reason: `获取仓库文件失败: HTTP ${getRes.status}` };
    }

    const merged = Array.from(new Set([...existingKws, ...localKws]));
    const content = `${merged.join('\n')}\n`;
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `chore: sync ${localKws.length} keywords from XShield`,
        content: utf8ToBase64(content),
        branch,
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => '');
      return { success: false, reason: `提交失败: HTTP ${putRes.status} ${detail.slice(0, 120)}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export type LogLevel = 'info' | 'warn' | 'error';

export type LogCategory =
  | 'block' // blocking actions (queue, success, skip, rate-limit)
  | 'sync' // keyword library sync / GitHub upload
  | 'trigger' // detection statistics from the content script
  | 'settings' // configuration changes
  | 'system'; // lifecycle (install, init, errors)

export interface XLogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  time: number;
}

export const LOGS_KEY = 'xshieldLogs';
export const LOGS_LIMIT = 500;

/** Append to the standardized activity log shown on the dashboard Logs page. */
export async function addLog(
  level: LogLevel,
  category: LogCategory,
  message: string,
): Promise<void> {
  try {
    const items = await chrome.storage.local.get({ [LOGS_KEY]: [] });
    const logs = (items[LOGS_KEY] as XLogEntry[]) ?? [];
    logs.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      category,
      message,
      time: Date.now(),
    });
    if (logs.length > LOGS_LIMIT) logs.length = LOGS_LIMIT;
    await chrome.storage.local.set({ [LOGS_KEY]: logs });
  } catch {
    // Logging must never break the caller.
  }
}

/** Remove entries older than `days` (default 7). */
export async function pruneLogs(days = 7): Promise<number> {
  try {
    const items = await chrome.storage.local.get({ [LOGS_KEY]: [] });
    const logs = (items[LOGS_KEY] as XLogEntry[]) ?? [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const kept = logs.filter((entry) => entry.time >= cutoff);
    if (kept.length !== logs.length) {
      await chrome.storage.local.set({ [LOGS_KEY]: kept });
    }
    return logs.length - kept.length;
  } catch {
    return 0;
  }
}

/** Export logs as a downloadable JSON file. */
export function exportLogs(logs: XLogEntry[]): void {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xshield-logs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
