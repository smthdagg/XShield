/**
 * Background — aligned with X(Twitter) Comment Blocker 1.5.1 background.js:
 *   - blocking posts screen_name directly to blocks/create.json|destroy.json
 *     (no user-id resolution round-trip);
 *   - the auto-block queue is pop-first and crash-safe;
 *   - trigger records are never deleted by a successful block — the ledger
 *     `blockedUsersOnX` marks users as blocked and the UI renders the state;
 *   - XShield deviations: an activity log (addLog), AsyncQueue single-writer
 *     for history batches, queueInfo side table, and a keyword-driven
 *     pending-then-auto-block model: every keyword hit is queued with a
 *     grace window; intervening (whitelist / delete) cancels it, otherwise
 *     the watchdog drains it through the rate-limited block program.
 */
import {
  browserApi as chrome,
  DEFAULT_CLOUD_OWNER_REPO,
  extractCleanScreenName,
  getLocalDateString,
  getStorageDefaults,
  parseKeywords,
  syncCloudKeywords,
  SYNC_INTERVAL_MINUTES,
  addLog,
} from '../store/blockerStorage';

const ALARM_NAME = 'cloudKeywordSync';
/** Pre-0.6.5 upstream keyword source (contains account-handle pollution). */
const LEGACY_UPSTREAM_REPO = 'amahteru/x-comment-blocker';
let isSyncing = false;

class SyncLock {
  constructor() {
    isSyncing = true;
  }
  dispose() {
    isSyncing = false;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  return {
    authorization:
      'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  };
}

class ProcessingLock {
  constructor(private obj: { isProcessing: boolean }) {
    this.obj.isProcessing = true;
  }
  dispose() {
    this.obj.isProcessing = false;
  }
}

class AsyncQueue {
  queue: Array<() => Promise<void>> = [];
  isProcessing = false;
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      try {
        return await task();
      } catch (e) {
        console.error('[X-Blocker] Queue task error:', e);
        return undefined as T;
      }
    };
    const promise = new Promise<T>((resolve) => {
      this.queue.push(async () => {
        resolve(await run());
      });
    });
    void this.process();
    return promise;
  }
  async process(): Promise<void> {
    if (this.isProcessing) return;
    const _lock = new ProcessingLock(this);

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) break;
        await task();
      }
    } finally {
      _lock.dispose();
    }
  }
}

interface SpamItem {
  id?: string;
  text?: string;
  user?: string;
  displayName?: string;
  reason?: string;
  time?: number;
  isAutoBlock?: boolean;
}

const globalSpamCache = new Set<string>();
const storageQueue = new AsyncQueue();

let inMemoryHistory: SpamItem[] | null = null;
let inMemoryBlockedCount: number | null = null;
let pendingSpamBatch: SpamItem[] = [];
const communitySourceIds = new Set<string>();
let spamBatchTimer: ReturnType<typeof setTimeout> | null = null;
const currentSessionToken = crypto.randomUUID();

function syncGlobalSpamCache(): void {
  globalSpamCache.clear();
  for (const item of inMemoryHistory ?? []) {
    if (item?.id) {
      globalSpamCache.add(item.id);
    }
  }
  for (const item of pendingSpamBatch) {
    if (item?.id) {
      globalSpamCache.add(item.id);
    }
  }
}

const initHistoryPromise = storageQueue.enqueue(async () => {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults('blockedCount', 'blockedHistory'),
    );
    inMemoryHistory = (items.blockedHistory as SpamItem[]) ?? [];
    inMemoryBlockedCount = (items.blockedCount as number) ?? 0;
    syncGlobalSpamCache();
  } catch (e) {
    console.error('[X-Blocker] Init history error:', e);
    inMemoryHistory ??= [];
    inMemoryBlockedCount ??= 0;
  }
});

async function ensureHistoryInitialized(): Promise<void> {
  if (inMemoryHistory === null) {
    await initHistoryPromise;
  }
}

async function saveHistoryState(): Promise<void> {
  try {
    await chrome.storage.local.set({
      blockedCount: inMemoryBlockedCount,
      blockedHistory: inMemoryHistory,
      _historyRev: currentSessionToken,
    });
  } catch (e) {
    console.error('[X-Blocker] saveHistoryState error:', e);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes._historyRev && changes._historyRev.newValue === currentSessionToken) {
    return;
  }

  if (changes.blockedHistory) {
    inMemoryHistory = (changes.blockedHistory.newValue as SpamItem[]) ?? [];
    syncGlobalSpamCache();
  }

  if (changes.blockedCount) {
    inMemoryBlockedCount = (changes.blockedCount.newValue as number) ?? 0;
  }
});

/**
 * First-run safety net: if the user has no cloud keywords yet (fresh install
 * or every network path failed), seed from the bundled keywords.txt so the
 * filter works immediately.
 */
async function seedBundledKeywords(): Promise<void> {
  try {
    const items = await chrome.storage.local.get(getStorageDefaults('cloudKeywords'));
    if ((items.cloudKeywords as string) ?? '') return;
    const response = await fetch(chrome.runtime.getURL('keywords.txt'));
    if (!response.ok) return;
    const list = parseKeywords(await response.text());
    if (list.length === 0) return;
    await chrome.storage.local.set({ cloudKeywords: list.join('\n') });
    void addLog('info', 'system', `内置词库已载入 ${list.length} 个词`);
  } catch {
    // Bundled seed is best-effort.
  }
}

async function doSync(): Promise<{ success: boolean; reason?: string }> {
  if (isSyncing) return { success: false, reason: 'busy' };
  const _lock = new SyncLock();

  try {
    const items = await chrome.storage.local.get({ cloudOwnerRepo: '' });
    let ownerRepo = (items.cloudOwnerRepo as string) || DEFAULT_CLOUD_OWNER_REPO;
    // One-time migration: the pre-0.6.5 upstream repo's keyword file is
    // polluted with account handles — force the cleaned default source.
    if (ownerRepo === LEGACY_UPSTREAM_REPO) {
      ownerRepo = DEFAULT_CLOUD_OWNER_REPO;
      await chrome.storage.local.set({ cloudOwnerRepo: '' });
      void addLog('info', 'sync', '检测到旧版上游词库源，已迁移到清洗后的默认仓库');
    }
    const success = await syncCloudKeywords(ownerRepo);
    void addLog(success ? 'info' : 'error', 'sync', `词库同步${success ? '成功' : '失败'}（来源：${ownerRepo}）`);
    if (success) {
      void feedCommunityHandles();
    }
    return { success };
  } finally {
    _lock.dispose();
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  void addLog('info', 'system', `扩展已安装/更新（v${chrome.runtime.getManifest().version}）`);
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });

  chrome.alarms.create('autoBlockWatchdog', {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });

  void doSync();
  void seedBundledKeywords();

  if (chrome.contextMenus) {
    // removeAll -> create must be strictly sequential; the create error is
    // reported via runtime.lastError (async), so read it in the callback to
    // suppress "Unchecked runtime.lastError". A duplicate id on rapid reload
    // is harmless — the menu already exists.
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create(
        {
          id: 'addToBlocklist',
          title: '添加「%s」到屏蔽词',
          contexts: ['selection'],
          documentUrlPatterns: ['*://*.twitter.com/*', '*://*.x.com/*'],
        },
        () => {
          const error = chrome.runtime.lastError;
          if (error && !/duplicate/i.test(error.message ?? '')) {
            console.warn('[XShield] contextMenus.create:', error.message);
          }
        },
      );
    });
  }
});

// Selected text → custom keyword list. The listener must live at the top
// level (MV3 event delivery); the menu itself is (re)created on install.
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'addToBlocklist' || !info.selectionText) return;
  const selection = info.selectionText.trim();
  if (!selection || selection.length > 200) return;
  void (async () => {
    const items = await chrome.storage.local.get(getStorageDefaults('keywords'));
    const existing = parseKeywords((items.keywords as string) ?? '');
    const next = Array.from(new Set([...existing, ...parseKeywords(selection)]));
    await chrome.storage.local.set({ keywords: next.join('\n') });
    void addLog('info', 'settings', `右键添加屏蔽词：${selection.slice(0, 50)}`);
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void doSync();
  } else if (alarm.name === 'autoBlockWatchdog') {
    void feedCommunityHandles();
    void autoBlockManager.process();
  }
});

const MAX_BLOCK_RETRIES = 5;

/** Buffer between a keyword trigger and its automatic block execution. */
const AUTO_BLOCK_GRACE_MINUTES = 30;

class AutoBlockManager {
  isProcessing = false;
  dailyLimit = 300;
  batchLimit = 30;
  minDelayMs = 5000;
  maxDelayMs = 10000;

  /** Buffer between trigger and execution; tests may shorten it. */
  graceMinutes = AUTO_BLOCK_GRACE_MINUTES;

  queue: string[] = [];
  /** Per-user ready timestamp (ms). Missing entry = immediately eligible. */
  eta: Record<string, number> = {};
  blockedUsersSet = new Set<string>();
  retryCounts = new Map<string, number>();
  countToday = 0;
  batchCount = 0;
  lastDate = '';
  pausedUntil = 0;
  initialized = false;
  initPromise: Promise<void> | null = null;

  async checkDailyReset(): Promise<void> {
    const today = getLocalDateString();
    if (this.lastDate !== today) {
      this.lastDate = today;
      this.countToday = 0;
      this.batchCount = 0;
      await this.saveState({
        autoBlockLastDate: this.lastDate,
        autoBlockToday: this.countToday,
        autoBlockBatchCount: this.batchCount,
      });
    }
  }

  async refreshFromStorage(): Promise<void> {
    const items = await chrome.storage.local.get(
      getStorageDefaults(
        'autoBlockQueue',
        'autoBlockEta',
        'autoBlockGraceMinutes',
        'autoBlockDailyLimit',
        'autoBlockBatchLimit',
        'autoBlockDelaySeconds',
        'autoBlockToday',
        'autoBlockLastDate',
        'autoBlockPausedUntil',
        'autoBlockBatchCount',
        'blockedUsersOnX',
      ),
    );

    this.queue = (items.autoBlockQueue as string[]) ?? [];
    this.eta = (items.autoBlockEta as Record<string, number>) ?? {};
    this.graceMinutes = (items.autoBlockGraceMinutes as number) ?? 30;
    this.dailyLimit = Math.max(1, (items.autoBlockDailyLimit as number) ?? 300);
    this.batchLimit = Math.max(1, (items.autoBlockBatchLimit as number) ?? 30);
    const delaySeconds = Math.max(0, (items.autoBlockDelaySeconds as number) ?? 5);
    this.minDelayMs = delaySeconds * 1000;
    this.maxDelayMs = delaySeconds * 1000 + 5000;
    this.countToday = (items.autoBlockToday as number) ?? 0;
    this.lastDate = (items.autoBlockLastDate as string) ?? '';
    this.pausedUntil = (items.autoBlockPausedUntil as number) ?? 0;
    this.batchCount = (items.autoBlockBatchCount as number) ?? 0;
    this.blockedUsersSet = new Set((items.blockedUsersOnX as string[]) ?? []);
    // The ledger is the source of truth (1.5.1): a user marked blocked must
    // never linger in the pending queue, even if older data left them there.
    await this.purgeBlockedFromQueue();
  }

  /** Drop ledger members from the queue and persist when anything changed. */
  async purgeBlockedFromQueue(): Promise<void> {
    if (this.queue.length === 0) return;
    const removed = this.queue.filter((name) => this.blockedUsersSet.has(name));
    if (removed.length > 0) {
      this.queue = this.queue.filter((name) => !this.blockedUsersSet.has(name));
      for (const name of removed) delete this.eta[name];
      await this.saveState({ autoBlockQueue: this.queue, autoBlockEta: this.eta });
    }
  }

  /** Whitelist members never sit in the pending queue. */
  async purgeWhitelistedFromQueue(whitelist: string[]): Promise<void> {
    const set = new Set(whitelist);
    const removed = this.queue.filter((name) => set.has(name));
    if (removed.length > 0) {
      this.queue = this.queue.filter((name) => !set.has(name));
      for (const name of removed) delete this.eta[name];
      await this.saveState({ autoBlockQueue: this.queue, autoBlockEta: this.eta });
      void addLog('info', 'block', `白名单更新：${removed.length} 个用户移出待拉黑队列`);
    }
  }

  /** Remove one user from the queue (blocked / whitelisted / record deleted). */
  async removeFromQueue(screenName: string): Promise<void> {
    if (!this.queue.includes(screenName) && !(screenName in this.eta)) return;
    this.queue = this.queue.filter((name) => name !== screenName);
    delete this.eta[screenName];
    await this.saveState({ autoBlockQueue: this.queue, autoBlockEta: this.eta });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initPromise ??= (async () => {
      await this.refreshFromStorage();
      await this.checkDailyReset();
      this.initialized = true;
      await this.backfillFromHistory();
    })();
    await this.initPromise;
  }

  /**
   * 0.6.0 model: a surviving unblocked trigger record IS a pending block.
   * On every worker wake, users with trigger records that are not in the
   * ledger, the queue or the whitelist enter the pending queue (full grace
   * window applies). Idempotent: ledger/queue/whitelist filters converge.
   */
  async backfillFromHistory(): Promise<void> {
    try {
      await ensureHistoryInitialized();
      const users = Array.from(
        new Set(
          (inMemoryHistory ?? [])
            .map((item) => extractCleanScreenName(item.user ?? ''))
            .filter(Boolean),
        ),
      );
      const { whitelist } = await chrome.storage.local.get(getStorageDefaults('whitelist'));
      const whitelistSet = new Set((whitelist as string[]) ?? []);
      const candidates = users.filter(
        (name) => !this.queue.includes(name) && !this.blockedUsersSet.has(name) && !whitelistSet.has(name),
      );
      if (candidates.length === 0) return;
      void addLog('info', 'block', `迁移：${candidates.length} 个历史触发用户进入待拉黑`);
      await this.enqueueBatch(candidates);
    } catch (e) {
      console.warn('[X-Blocker] history backfill skipped:', e);
    }
  }

  async saveState(updates: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(updates);
  }

  async enqueueBatch(screenNames: string[], options?: { readyNow?: boolean }): Promise<number> {
    await this.init();
    if (!screenNames || screenNames.length === 0) {
      void this.process();
      return 0;
    }

    const { whitelist } = await chrome.storage.local.get(getStorageDefaults('whitelist'));
    const whitelistSet = new Set((whitelist as string[]) ?? []);
    const candidates = Array.from(new Set(screenNames.map(extractCleanScreenName))).filter(
      (name) =>
        name &&
        /^[a-zA-Z0-9_]{1,15}$/v.test(name) &&
        !this.blockedUsersSet.has(name) &&
        !whitelistSet.has(name),
    );
    const readyAt = options?.readyNow ? Date.now() : Date.now() + Math.max(0, this.graceMinutes) * 60_000;

    // Fresh entries always get the full grace window — a leftover stale eta
    // from a previous life must never let a new trigger bypass it.
    const freshNames = candidates.filter((name) => !this.queue.includes(name));
    if (freshNames.length > 0) {
      this.queue.push(...freshNames);
      for (const name of freshNames) this.eta[name] = readyAt;
      const graceNote =
        options?.readyNow ? '立即执行' : `缓冲期 ${this.graceMinutes} 分钟，可在面板干预`;
      void addLog('info', 'block', `${freshNames.length} 个用户进入待拉黑（${graceNote}）`);
    }

    // Manual confirmation pulls already-pending entries forward to "now"
    // (never pushes them back).
    let accelerated = 0;
    if (options?.readyNow) {
      for (const name of candidates) {
        if (this.queue.includes(name) && (this.eta[name] ?? 0) > Date.now()) {
          this.eta[name] = Date.now();
          accelerated++;
        }
      }
    }

    if (freshNames.length > 0 || accelerated > 0) {
      await this.saveState({ autoBlockQueue: this.queue, autoBlockEta: this.eta });
    }

    // Always re-kick the drain: it also picks up entries whose grace window
    // expired while nothing else woke the manager.
    void this.process();
    return freshNames.length;
  }

  async process(): Promise<void> {
    if (this.isProcessing) return;
    const _lock = new ProcessingLock(this);

    try {
      try {
        await this.init();

        for (;;) {
          await this.refreshFromStorage();
          await this.checkDailyReset();

          const now = Date.now();
          if (this.pausedUntil > now) {
            const remainSeconds = Math.ceil((this.pausedUntil - now) / 1000);
            console.warn(`[X-Blocker] Auto block paused for ${remainSeconds}s.`);
            break;
          }

          if (this.countToday >= this.dailyLimit) {
            console.warn('[X-Blocker] Auto block daily limit reached.');
            void addLog('warn', 'block', '自动拉黑已达每日上限（300），明天继续');
            break;
          }

          if (this.batchCount >= this.batchLimit) {
            console.warn('[X-Blocker] Auto block batch limit reached. Pausing for 15 mins.');
            this.pausedUntil = Date.now() + 15 * 60 * 1000;
            this.batchCount = 0;
            await this.saveState({
              autoBlockPausedUntil: this.pausedUntil,
              autoBlockBatchCount: this.batchCount,
            });
            void addLog('info', 'block', '一批（30 个）执行完成，暂停 15 分钟');
            break;
          }

          if (this.queue.length === 0) break;

          // Grace-window aware pick: take the first entry whose buffer has
          // expired. Entries still waiting for possible intervention stay in
          // the queue; the watchdog alarm re-kicks the drain every minute.
          const readyIndex = this.queue.findIndex((name) => (this.eta[name] ?? 0) <= now);
          if (readyIndex === -1) break;

          // Pop-first (1.5.1): persist the shortened queue before the network
          // call, so a crashed MV3 worker never re-blocks the same user.
          const currentItem = this.queue.splice(readyIndex, 1)[0];
          delete this.eta[currentItem];
          await this.saveState({ autoBlockQueue: this.queue, autoBlockEta: this.eta });

          // The user may have been blocked manually (or by a previous run)
          // while sitting in the queue — the ledger wins, no second API call.
          if (this.blockedUsersSet.has(currentItem)) {
            void addLog('info', 'block', `跳过 @${currentItem}：已在拉黑账本中`);
            continue;
          }

          let outcome: string | null = null;
          let failReason = '';
          let pauseUntil = 0;
          try {
            const res = await handleBlockUser(currentItem, true);
            if (res?.success) {
              outcome = 'success';
            } else if (res?.status === 429) {
              outcome = 'rate-limited';
              pauseUntil = Date.now() + 15 * 60 * 1000;
            } else if (res?.permanent || (res?.status && res.status >= 400 && res.status < 500)) {
              outcome = 'failed';
              failReason = res?.reason ?? 'unknown';
            } else {
              outcome = 'transient';
              failReason = res?.reason ?? 'unknown';
            }
          } catch (e) {
            console.error('[X-Blocker] Auto block task execution error:', e);
            outcome = 'transient';
            failReason = 'task error';
          }

          if (outcome === 'success') {
            this.retryCounts.delete(currentItem);
            this.countToday++;
            this.batchCount++;
            // Ledger write happened inside handleBlockUser (markBlockedOnX) —
            // the queue here only tracks counters.
            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockToday: this.countToday,
              autoBlockBatchCount: this.batchCount,
            });
            void addLog('info', 'block', `已拉黑 @${currentItem}（今日第 ${this.countToday} 个）`);
          } else if (outcome === 'rate-limited') {
            console.warn('[X-Blocker] API rate limited (429). Pausing auto block for 15 mins.');
            this.queue.unshift(currentItem);
            this.pausedUntil = pauseUntil;
            this.batchCount = 0;
            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockPausedUntil: this.pausedUntil,
              autoBlockBatchCount: this.batchCount,
            });
            void addLog('warn', 'block', '触发 X 限流（429），暂停 15 分钟');
            break;
          } else if (outcome === 'transient') {
            const attempts = (this.retryCounts.get(currentItem) ?? 0) + 1;
            this.retryCounts.set(currentItem, attempts);
            if (attempts > MAX_BLOCK_RETRIES) {
              console.error(
                `[X-Blocker] Auto block giving up on ${currentItem} after ${attempts} attempts:`,
                failReason,
              );
              void addLog('error', 'block', `放弃重试 @${currentItem}：${failReason}`);
              this.retryCounts.delete(currentItem);
              await this.saveState({ autoBlockQueue: this.queue });
            } else {
              console.warn(
                `[X-Blocker] Auto block transient failure for ${currentItem}, retry ${attempts}/${MAX_BLOCK_RETRIES}:`,
                failReason,
              );
              this.queue.push(currentItem);
              await this.saveState({ autoBlockQueue: this.queue });
              await new Promise((r) =>
                setTimeout(r, Math.min(30_000, 5_000 * 2 ** (attempts - 1))),
              );
            }
          } else {
            this.retryCounts.delete(currentItem);
            // Expected permanent failures (e.g. account already deleted) are
            // logged as warnings, not console errors.
            console.warn('[X-Blocker] Auto block skipped:', currentItem, failReason);
            void addLog('warn', 'block', `跳过 @${currentItem}：${failReason}`);
            await this.saveState({ autoBlockQueue: this.queue });
          }

          if (this.queue.length > 0) {
            const delay =
              Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } catch (e) {
        console.error('[X-Blocker] AutoBlockManager process error:', e);
      }
    } finally {
      _lock.dispose();
    }
  }
}

const autoBlockManager = new AutoBlockManager();
// Exported for tests (grace-window tuning); not part of the public surface.
export { autoBlockManager, feedCommunityHandles };
void autoBlockManager.init().then(() => {
  void autoBlockManager.process();
});

async function blockAllHistoryUsers(usersToBlock: string[]): Promise<{ success: boolean; total: number; queued: number }> {
  const names = Array.isArray(usersToBlock) ? usersToBlock : [];
  // The user explicitly confirmed these — skip the grace window.
  const queued = await autoBlockManager.enqueueBatch(names, { readyNow: true });
  return { success: true, total: names.length, queued };
}

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender, sendResponse) => {
  if (message.action === 'syncNow') {
    void doSync().then(sendResponse);
    return true;
  }
  if (message.action === 'blockUserOnX') {
    void handleBlockUser(String(message.screenName ?? ''), true).then((res) => {
      void addLog(res?.success ? 'info' : 'error', 'block', `手动拉黑 @${String(message.screenName ?? '')} ${res?.success ? '成功' : `失败：${res?.reason ?? ''}`}`);
      sendResponse(res);
    });
    return true;
  }
  if (message.action === 'unblockUserOnX') {
    void handleBlockUser(String(message.screenName ?? ''), false).then((res) => {
      void addLog(res?.success ? 'info' : 'warn', 'block', `解除拉黑 @${String(message.screenName ?? '')} ${res?.success ? '成功' : `失败：${res?.reason ?? ''}`}`);
      sendResponse(res);
    });
    return true;
  }
  if (message.action === 'shareHandles') {
    void shareHandlesToProject().then(sendResponse);
    return true;
  }
  if (message.action === 'blockAllHistoryUsers') {
    void blockAllHistoryUsers((message.users as string[]) ?? []).then(sendResponse);
    return true;
  }
  if (message.action === 'recordSpam') {
    void handleRecordSpam((message.items as SpamItem[]) ?? [])
      .then(() => sendResponse({ success: true }))
      .catch((e: Error) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (message.action === 'clearSpamCache') {
    if (spamBatchTimer) {
      clearTimeout(spamBatchTimer);
      spamBatchTimer = null;
    }
    pendingSpamBatch = [];
    notifyContentScripts({ action: 'clearLocalSentIds' });
    void storageQueue
      .enqueue(async () => {
        if (spamBatchTimer) {
          clearTimeout(spamBatchTimer);
          spamBatchTimer = null;
        }
        pendingSpamBatch = [];
        inMemoryHistory = [];
        inMemoryBlockedCount = 0;
        globalSpamCache.clear();
        await saveHistoryState();
      })
      .then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.action === 'removeSpamRecord') {
    void handleRemoveSpamRecord(String(message.id ?? ''), message.time as number | undefined).then(sendResponse);
    return true;
  }
  return false;
});

// Intervention fault-tolerance: whitelisting a user must instantly cancel
// their pending auto-block — the queue, ledger and whitelist can overlap, and
// the whitelist always wins over pending entries.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.whitelist) {
    void autoBlockManager.purgeWhitelistedFromQueue((changes.whitelist.newValue as string[]) ?? []);
  }
});

async function notifyContentScripts(message: Record<string, unknown>): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ['*://*.twitter.com/*', '*://*.x.com/*'],
  });
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

/**
 * The background never deletes trigger records on block success (1.5.1 model):
 * `blockedUsersOnX` is the ledger that marks a user as blocked, and the UI
 * renders blocked state from it. Records stay put so nothing "drifts".
 */
async function markBlockedOnX(cleanName: string): Promise<void> {
  const stored = (
    await chrome.storage.local.get(getStorageDefaults('blockedUsersOnX', 'blockedAt'))
  );
  const ledger = Array.from(new Set([...((stored.blockedUsersOnX as string[]) ?? []), cleanName])).slice(-100000);
  const blockedAt = { ...((stored.blockedAt as Record<string, number>) ?? {}), [cleanName]: Date.now() };
  // Keep the timestamp map aligned with the ledger cap.
  const entries = Object.entries(blockedAt).sort((a, b) => b[1] - a[1]).slice(0, 100000);
  await chrome.storage.local.set({
    blockedUsersOnX: ledger,
    blockedAt: Object.fromEntries(entries),
  });
  autoBlockManager.blockedUsersSet.add(cleanName);
  if (autoBlockManager.blockedUsersSet.size > 10000) {
    const dropCount = autoBlockManager.blockedUsersSet.size - 10000;
    autoBlockManager.blockedUsersSet = new Set(
      Array.from(autoBlockManager.blockedUsersSet).slice(dropCount),
    );
  }
  // Ledger write implies queue exit: a blocked user is no longer "pending".
  await autoBlockManager.removeFromQueue(cleanName);
}

async function markUnblockedOnX(cleanName: string): Promise<void> {
  const stored = (
    await chrome.storage.local.get(getStorageDefaults('blockedUsersOnX', 'blockedAt'))
  );
  const blockedAt = { ...((stored.blockedAt as Record<string, number>) ?? {}) };
  delete blockedAt[cleanName];
  await chrome.storage.local.set({
    blockedUsersOnX: ((stored.blockedUsersOnX as string[]) ?? []).filter((name) => name !== cleanName),
    blockedAt,
  });
  autoBlockManager.blockedUsersSet.delete(cleanName);
}

function handleRemoveSpamRecord(id: string, time?: number): Promise<{ success: boolean }> {
  const isMatch = (item: SpamItem) => !(item.id === id && (!time || item.time === time));

  if (id) {
    void notifyContentScripts({ action: 'removeLocalSentId', id });
  }

  let batchRemovedUsers: string[] = [];
  if (pendingSpamBatch.length > 0) {
    const originalPendingLength = pendingSpamBatch.length;
    batchRemovedUsers = pendingSpamBatch
      .filter((item) => !isMatch(item))
      .map((item) => extractCleanScreenName(item.user ?? ''))
      .filter(Boolean);
    pendingSpamBatch = pendingSpamBatch.filter(isMatch);
    if (originalPendingLength > pendingSpamBatch.length && id) {
      globalSpamCache.delete(id);
    }
  }

  return storageQueue.enqueue(async () => {
    await ensureHistoryInitialized();

    const originalLength = (inMemoryHistory ?? []).length;
    // Capture which users lose their last record — deleting a record is an
    // intervention and cancels the user's pending auto-block. Records still
    // sitting in the write batch count too (they never reached memory).
    const removedUsers = Array.from(
      new Set([
        ...batchRemovedUsers,
        ...(inMemoryHistory ?? [])
          .filter((item) => !isMatch(item))
          .map((item) => extractCleanScreenName(item.user ?? ''))
          .filter(Boolean),
      ]),
    );
    inMemoryHistory = (inMemoryHistory ?? []).filter(isMatch);

    const removedCount = originalLength - (inMemoryHistory ?? []).length;
    if (removedCount > 0) {
      if (id) {
        globalSpamCache.delete(id);
      }
      inMemoryBlockedCount = Math.max(0, (inMemoryBlockedCount ?? 0) - removedCount);
      await saveHistoryState();
    }

    const remainingUsers = new Set(
      [
        ...(inMemoryHistory ?? []),
        // Records still waiting in the write batch count as remaining too —
        // the flush will merge them into history shortly.
        ...pendingSpamBatch,
      ]
        .map((item) => extractCleanScreenName(item.user ?? ''))
        .filter(Boolean),
    );

    if (removedUsers.length > 0) {
      // Deleting a community-sourced record is a permanent opt-out: without
      // this the feeder would re-add the handle on the next wake. Runs for
      // batch-window deletes too (where removedCount is 0).
      void (async () => {
        const removedCommunity = removedUsers.filter((name) =>
          communitySourceIds.has(`${COMMUNITY_HISTORY_PREFIX}${name}`),
        );
        if (removedCommunity.length === 0) return;
        const items = await chrome.storage.local.get(getStorageDefaults('communityDismissed'));
        const dismissed = new Set((items.communityDismissed as string[]) ?? []);
        let changed = false;
        for (const name of removedCommunity) {
          if (!dismissed.has(name)) {
            dismissed.add(name);
            changed = true;
          }
        }
        if (changed) {
          await chrome.storage.local.set({ communityDismissed: Array.from(dismissed).slice(-100000) });
        }
      })();
      for (const name of removedUsers) {
        if (!remainingUsers.has(name)) {
          void autoBlockManager.removeFromQueue(name);
        }
      }
    }
    return { success: true };
  });
}

/**
 * Persist display info (nickname / triggering text) for queue cards. The
 * queue itself stays a plain string list (1.4.3 behaviour); this side table
 * only powers the dashboard card UI.
 */
async function setQueueInfo(entries: Array<{ name: string; displayName?: string; text?: string }>): Promise<void> {
  try {
    const items = await chrome.storage.local.get({ queueInfo: {} });
    const info = (items.queueInfo as Record<string, { displayName?: string; text?: string }>) ?? {};
    for (const entry of entries) {
      if (!entry.name) continue;
      const existing = info[entry.name];
      info[entry.name] = {
        displayName: entry.displayName || existing?.displayName,
        text: entry.text || existing?.text,
      };
    }
    await chrome.storage.local.set({ queueInfo: info });
  } catch {
    // Best-effort side table.
  }
}

async function flushSpamBatch(): Promise<void> {
  if (spamBatchTimer) {
    clearTimeout(spamBatchTimer);
    spamBatchTimer = null;
  }
  if (pendingSpamBatch.length === 0) return;
  const batch = pendingSpamBatch;
  pendingSpamBatch = [];

  await storageQueue.enqueue(async () => {
    await ensureHistoryInitialized();
    (inMemoryHistory ?? []).unshift(...batch.reverse());
    if ((inMemoryHistory ?? []).length > 20000) {
      const history = inMemoryHistory ?? [];
      const evicted = history.slice(20000);
      history.length = 20000;
      for (const item of evicted) {
        if (item?.id) {
          globalSpamCache.delete(item.id);
        }
      }
    }
    inMemoryBlockedCount = (inMemoryBlockedCount ?? 0) + batch.length;
    await saveHistoryState();
  });
}

const COMMUNITY_FEED_BATCH = 50;
const COMMUNITY_QUEUE_TARGET = 100;
const COMMUNITY_HISTORY_PREFIX = 'community:';

/**
 * Actively feed the shared backlog: pull community handles (not blocked,
 * queued, whitelisted or dismissed) into the pending queue in small batches,
 * keeping at most COMMUNITY_QUEUE_TARGET community entries in flight. Each
 * fed handle gets a synthetic trigger record (reason 社区共享) so the usual
 * visibility and intervention apply; blocking follows the normal pacing.
 * The cloud handles.txt is the permanent master — local state is a cache.
 */
async function feedCommunityHandles(): Promise<void> {
  console.log('DBG feeder start');
  try {
    const stored = await chrome.storage.local.get(
      getStorageDefaults('communityHandles', 'communityDismissed', 'blockedUsersOnX', 'whitelist'),
    );
    const community = new Set((stored.communityHandles as string[]) ?? []);
    if (community.size === 0) return;
    const dismissed = new Set((stored.communityDismissed as string[]) ?? []);
    const ledger = new Set((stored.blockedUsersOnX as string[]) ?? []);
    const whitelist = new Set((stored.whitelist as string[]) ?? []);

    const { autoBlockQueue: queue } = await chrome.storage.local.get(
      getStorageDefaults('autoBlockQueue'),
    );
    const queueSet = new Set((queue as string[]) ?? []);
    let inFlight = 0;
    for (const name of queueSet) {
      if (community.has(name)) inFlight++;
    }

    const feed: string[] = [];
    for (const name of community) {
      if (feed.length >= COMMUNITY_FEED_BATCH) break;
      if (inFlight + feed.length >= COMMUNITY_QUEUE_TARGET) break;
      if (ledger.has(name) || whitelist.has(name) || dismissed.has(name) || queueSet.has(name)) continue;
      feed.push(name);
    }
    if (feed.length === 0) return;

    const now = Date.now();
    for (const name of feed) {
      const recordId = `${COMMUNITY_HISTORY_PREFIX}${name}`;
      communitySourceIds.add(recordId);
      pendingSpamBatch.push({
        id: recordId,
        text: '',
        user: name,
        displayName: '',
        reason: '社区共享',
        time: now,
        isAutoBlock: true,
      });
    }
    if (!spamBatchTimer) {
      spamBatchTimer = setTimeout(() => {
        spamBatchTimer = null;
        void flushSpamBatch();
      }, 50);
    }
    console.log('DBG feeder calling enqueueBatch');
    await autoBlockManager.enqueueBatch(feed);
    console.log('DBG feeder enqueueBatch returned');
    void addLog('info', 'block', `社区名单喂送 ${feed.length} 个进入待拉黑`);
  } catch (e) {
    console.warn('[X-Blocker] community feed skipped:', e);
  }
}

async function handleRecordSpam(items: SpamItem[]): Promise<void> {
  if (!items?.length) return;
  await ensureHistoryInitialized();

  const newSpams: SpamItem[] = [];
  for (const item of items) {
    if (!item?.id || globalSpamCache.has(item.id)) continue;
    globalSpamCache.add(item.id);
    newSpams.push({
      id: item.id,
      text: item.text ? item.text.slice(0, 200) : '',
      user: item.user || '',
      displayName: item.displayName || '',
      reason: item.reason || '',
      time: item.time || Date.now(),
      isAutoBlock: item.isAutoBlock === true,
    });
  }

  for (const spam of newSpams) {
    if (String(spam.id ?? '').startsWith(COMMUNITY_HISTORY_PREFIX)) communitySourceIds.add(String(spam.id));
  }

  if (newSpams.length === 0) return;
  void addLog(
    'info',
    'trigger',
    `检测到 ${newSpams.length} 条垃圾回复（${newSpams.filter((x) => x.isAutoBlock).length} 条进入待拉黑）`,
  );

  const autoBlockSpams = newSpams.filter((s) => s.isAutoBlock && s.user);

  if (autoBlockSpams.length > 0) {
    const autoBlockScreenNames = autoBlockSpams.map((s) => s.user as string);
    void setQueueInfo(autoBlockSpams.map((spam) => ({
      name: extractCleanScreenName(spam.user ?? ''),
      displayName: spam.displayName,
      text: spam.text,
    })));
    void autoBlockManager.enqueueBatch(autoBlockScreenNames);
  }

  pendingSpamBatch.push(...newSpams);
  if (!spamBatchTimer) {
    spamBatchTimer = setTimeout(() => {
      spamBatchTimer = null;
      void flushSpamBatch();
    }, 50);
  }
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Owner/contributor action: merge the local block ledger into the project's
 * shared handles.txt so every user's next sync picks the handles up. Requires
 * a GitHub token with push access to the target repo; ordinary users simply
 * never configure one and stay download-only.
 */
async function shareHandlesToProject(): Promise<{ success: boolean; total?: number; reason?: string }> {
  try {
    const stored = await chrome.storage.local.get(
      getStorageDefaults('githubToken', 'cloudOwnerRepo', 'blockedUsersOnX'),
    );
    const token = stored.githubToken as string;
    if (!token) {
      return { success: false, reason: '请先在设置中填写 GitHub Token' };
    }
    const ownerRepo = (stored.cloudOwnerRepo as string) || DEFAULT_CLOUD_OWNER_REPO;
    const handles = Array.from(
      new Set(
        ((stored.blockedUsersOnX as string[]) ?? [])
          .map(extractCleanScreenName)
          .filter(Boolean),
      ),
    );
    if (handles.length === 0) {
      return { success: false, reason: '本地没有已拉黑用户可共享' };
    }

    const api = `https://api.github.com/repos/${ownerRepo}/contents/handles.txt`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    };

    let sha: string | null = null;
    let existing: string[] = [];
    const getRes = await fetch(`${api}?ref=main`, { headers, signal: AbortSignal.timeout(15000) });
    if (getRes.ok) {
      const meta = (await getRes.json()) as { sha?: string; content?: string };
      sha = meta.sha ?? null;
      if (meta.content) existing = parseKeywords(base64ToUtf8(meta.content));
    } else if (getRes.status !== 404) {
      return { success: false, reason: `获取 handles.txt 失败: HTTP ${getRes.status}` };
    }

    const merged = Array.from(new Set([...existing, ...handles]));
    const putRes = await fetch(api, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `share ${handles.length} blocked handles from XShield`,
        content: utf8ToBase64(`${merged.join('\n')}\n`),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => '');
      return { success: false, reason: `提交失败: HTTP ${putRes.status} ${detail.slice(0, 120)}` };
    }
    void addLog('info', 'sync', `共享拉黑名单成功：合并后 ${merged.length} 个 handle`);
    return { success: true, total: merged.length };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

interface BlockApiResponse {
  errors?: Array<{ message?: string; code?: number }>;
}

interface BlockUserResult {
  success: boolean;
  reason?: string;
  status?: number;
  permanent?: boolean;
  screenName?: string;
}

/**
 * 1.5.1 block contract: a single POST addressed by screen_name. No profile
 * page parsing, no id resolution — HTTP ok means the block happened (a body
 * that fails to parse still counts as success; body errors with the permanent
 * codes 34/50/63 mean the account is gone and must not be retried).
 * On success the ledger is updated here (single writer) so the dashboard
 * never writes `blockedUsersOnX` itself.
 */
async function handleBlockUser(screenName: string, isBlock: boolean): Promise<BlockUserResult> {
  try {
    const cleanName = extractCleanScreenName(screenName);
    if (!cleanName) {
      return { success: false, reason: '无效的用户名', permanent: true };
    }
    // Whitelist chokepoint: checked at attempt time so a user whitelisted
    // while their failed block was awaiting retry can never be blocked.
    if (isBlock) {
      const { whitelist } = await chrome.storage.local.get(getStorageDefaults('whitelist'));
      if (((whitelist as string[]) ?? []).includes(cleanName)) {
        void addLog('info', 'block', `跳过拉黑 @${cleanName}：白名单用户`);
        return { success: false, reason: '白名单用户', permanent: true };
      }
    }
    const cookie = await chrome.cookies.get({
      url: 'https://x.com',
      name: 'ct0',
    });
    if (!cookie) {
      return { success: false, reason: '无法获取身份凭证，请确保已登录 X' };
    }

    const endpoint = isBlock ? 'create.json' : 'destroy.json';
    const headers = await getAuthHeaders();

    headers['x-csrf-token'] = cookie.value;
    headers['content-type'] = 'application/x-www-form-urlencoded';

    const response = await fetch(`https://x.com/i/api/1.1/blocks/${endpoint}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: `screen_name=${encodeURIComponent(cleanName)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      try {
        const data = (await response.json()) as BlockApiResponse;
        if (data?.errors?.length) {
          const messages = data.errors
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ');
          const PERMANENT_ERROR_CODES = new Set([34, 50, 63]);
          const isPermanent = data.errors.every(
            (e) => typeof e.code === 'number' && PERMANENT_ERROR_CODES.has(e.code),
          );
          return { success: false, reason: `API 错误: ${messages}`, permanent: isPermanent };
        }
      } catch {
        // Unparseable body — X accepted the request anyway (1.5.1 behaviour).
      }

      if (isBlock) {
        await markBlockedOnX(cleanName);
      } else {
        await markUnblockedOnX(cleanName);
      }
      return { success: true, screenName: cleanName };
    }

    return {
      success: false,
      reason: `请求失败: HTTP ${response.status}`,
      status: response.status,
    };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

console.info(`[XShield] background v${chrome.runtime.getManifest().version} loaded`);
