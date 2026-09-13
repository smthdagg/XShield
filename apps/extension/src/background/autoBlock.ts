/**
 * AutoBlockManager — the rate-limited auto-block drain (1.5.1 model,
 * conservative human-like pacing since 1.2.0).
 *
 * Extracted from index.ts so the queue lives apart from message routing and
 * the block ledger. The X call is injected (`blockUser`) so this module has
 * no dependency on the ledger/single-writer code; index.ts wires
 * `handleBlockUser` in and exports the singleton for tests.
 */
import {
  addLog,
  extractCleanScreenName,
  getLocalDateString,
  getStorageDefaults,
} from '../store/blockerStorage';

export class ProcessingLock {
  constructor(private obj: { isProcessing: boolean }) {
    this.obj.isProcessing = true;
  }
  dispose() {
    this.obj.isProcessing = false;
  }
}

const MAX_BLOCK_RETRIES = 5;

/** Failed block attempts are skipped by all auto paths for this long. */
export const FAILURE_RETRY_HOURS = 24;

/** Buffer between a keyword trigger and its automatic block execution. */
const AUTO_BLOCK_GRACE_MINUTES = 30;

/**
 * Conservative pacing: the defaults and the randomizers below are
 * deliberately non-mechanical — a fixed 5 s tick across hundreds of blocks a
 * day is exactly the rhythm X's anti-automation flags. Every gap is drawn
 * from a wide band and occasionally jumps to a multi-minute "stepped away"
 * pause, so no two blocks land on a recognizable schedule.
 */
function randomBetweenMs(minMs: number, maxMs: number): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

/** Inter-block gap: wide band around the baseline, ~1 in 6 blocks gets a
 *  much longer break (3–12 min). */
function getDynamicGapMs(baseMs: number, maxMs: number): number {
  const gap = randomBetweenMs(baseMs, maxMs);
  const LONG_GAP_PROBABILITY = 0.16;
  if (Math.random() < LONG_GAP_PROBABILITY) {
    return gap + randomBetweenMs(3 * 60_000, 12 * 60_000);
  }
  return gap;
}

/** Inter-batch pause: 20–60 min, randomized. */
function getBatchPauseMs(): number {
  return randomBetweenMs(20 * 60_000, 60 * 60_000);
}

/** Rate-limited (429) cooldown: 60–180 min — a rate limit is the loudest
 *  automation signal X sends back, so the response is extra slow. */
function getRateLimitPauseMs(): number {
  return randomBetweenMs(60 * 60_000, 180 * 60_000);
}

export class AutoBlockManager {
  isProcessing = false;
  /** Conservative defaults; users may raise them in the panel. */
  dailyLimit = 20;
  batchLimit = 5;
  /** Baseline gap band: default 90 s at least, up to 3x. */
  minDelayMs = 90_000;
  maxDelayMs = 270_000;

  /** Buffer between trigger and execution; tests may shorten it. */
  graceMinutes = AUTO_BLOCK_GRACE_MINUTES;

  constructor(
    private blockUser: (screenName: string) => Promise<BlockUserResult>,
    private historyUsers: () => Promise<string[]>,
  ) {}

  queue: string[] = [];
  /** Per-user ready timestamp (ms). Missing entry = immediately eligible. */
  eta: Record<string, number> = {};
  blockedUsersSet = new Set<string>();
  retryCounts = new Map<string, number>();
  /** Last block-attempt failure per user (ms); auto paths skip these. */
  failedAt: Record<string, number> = {};
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
        'blockFailedAt',
      ),
    );

    this.queue = (items.autoBlockQueue as string[]) ?? [];
    this.eta = (items.autoBlockEta as Record<string, number>) ?? {};
    this.graceMinutes = (items.autoBlockGraceMinutes as number) ?? 30;
    this.dailyLimit = Math.max(1, (items.autoBlockDailyLimit as number) ?? 20);
    this.batchLimit = Math.max(1, (items.autoBlockBatchLimit as number) ?? 5);
    const delaySeconds = Math.max(0, (items.autoBlockDelaySeconds as number) ?? 90);
    this.minDelayMs = delaySeconds * 1000;
    this.maxDelayMs = this.minDelayMs * 3;
    this.countToday = (items.autoBlockToday as number) ?? 0;
    this.lastDate = (items.autoBlockLastDate as string) ?? '';
    this.pausedUntil = (items.autoBlockPausedUntil as number) ?? 0;
    this.batchCount = (items.autoBlockBatchCount as number) ?? 0;
    this.blockedUsersSet = new Set((items.blockedUsersOnX as string[]) ?? []);
    this.failedAt = (items.blockFailedAt as Record<string, number>) ?? {};
    // The ledger is the source of truth (1.5.1): a user marked blocked must
    // never linger in the pending queue, even if older data left them there.
    await this.purgeBlockedFromQueue();
  }

  /** True when the last block attempt failed within the retry window. */
  recentlyFailed(name: string): boolean {
    const ts = this.failedAt[name];
    return Boolean(ts) && Date.now() - ts < FAILURE_RETRY_HOURS * 60 * 60 * 1000;
  }

  /** Record a failed block attempt; also trims the table to the last 10k. */
  markFailed(name: string): void {
    this.failedAt[name] = Date.now();
    const entries = Object.entries(this.failedAt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10000);
    this.failedAt = Object.fromEntries(entries);
  }

  /** Clear the failure marker (block succeeded or user retries manually). */
  clearFailed(name: string): void {
    if (name in this.failedAt) {
      delete this.failedAt[name];
    }
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

  /** Batch queue removal (duplicate cleanup): one storage write per batch. */
  async removeManyFromQueue(screenNames: string[]): Promise<void> {
    const target = new Set(screenNames.map(extractCleanScreenName).filter(Boolean));
    if (target.size === 0) return;
    const removed = this.queue.filter((name) => target.has(name));
    if (removed.length === 0) return;
    this.queue = this.queue.filter((name) => !target.has(name));
    for (const name of removed) delete this.eta[name];
    await this.saveState({ autoBlockQueue: this.queue, autoBlockEta: this.eta });
    void addLog('info', 'settings', `批量移除待拉黑队列 ${removed.length} 个（重复名单清理）`);
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
      const users = Array.from(new Set(await this.historyUsers()));
      const { whitelist } = await chrome.storage.local.get(getStorageDefaults('whitelist'));
      const whitelistSet = new Set((whitelist as string[]) ?? []);
      const candidates = users.filter(
        (name) =>
          !this.queue.includes(name) &&
          !this.blockedUsersSet.has(name) &&
          !whitelistSet.has(name) &&
          // A user whose block attempt just failed must not be re-fed into
          // the queue by every worker wake (that is the 78-stuck loop).
          !this.recentlyFailed(name),
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
        !whitelistSet.has(name) &&
        // Auto paths skip users whose last attempt failed within the retry
        // window; manual confirmation (readyNow) is an explicit retry and
        // always passes.
        (options?.readyNow || !this.recentlyFailed(name)),
    );
    const readyAt = options?.readyNow
      ? Date.now()
      : Date.now() + Math.max(0, this.graceMinutes) * 60_000;

    // Fresh entries always get the full grace window — a leftover stale eta
    // from a previous life must never let a new trigger bypass it. Manual
    // confirmations (readyNow) jump the backlog line: they join the queue at
    // the front so a multi-thousand backlog can't bury a user's explicit
    // block request behind older entries.
    const freshNames = candidates.filter((name) => !this.queue.includes(name));
    if (freshNames.length > 0) {
      if (options?.readyNow) {
        this.queue.unshift(...freshNames);
      } else {
        this.queue.push(...freshNames);
      }
      for (const name of freshNames) this.eta[name] = readyAt;
      const graceNote = options?.readyNow
        ? '立即执行'
        : `缓冲期 ${this.graceMinutes} 分钟，可在面板干预`;
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
            void addLog('warn', 'block', `自动拉黑已达每日上限（${this.dailyLimit}），明天继续`);
            break;
          }

          if (this.batchCount >= this.batchLimit) {
            const batchPauseMs = getBatchPauseMs();
            const pauseMinutes = Math.round(batchPauseMs / 60_000);
            console.warn(
              `[X-Blocker] Auto block batch limit reached. Pausing for ${pauseMinutes} mins.`,
            );
            this.pausedUntil = Date.now() + batchPauseMs;
            this.batchCount = 0;
            await this.saveState({
              autoBlockPausedUntil: this.pausedUntil,
              autoBlockBatchCount: this.batchCount,
            });
            void addLog(
              'info',
              'block',
              `一批（${this.batchLimit} 个）执行完成，随机暂停约 ${pauseMinutes} 分钟`,
            );
            break;
          }

          if (this.queue.length === 0) break;

          // Grace-window aware pick: take the first entry whose buffer has
          // expired. Entries still waiting for possible intervention stay in
          // the queue; the watchdog alarm re-kicks the drain every minute.
          const readyIndex = this.queue.findIndex((name) => (this.eta[name] ?? 0) <= now);
          if (readyIndex === -1) break;

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
            const res = await this.blockUser(currentItem);
            if (res?.success) {
              outcome = 'success';
            } else if (res?.status === 429) {
              outcome = 'rate-limited';
              pauseUntil = Date.now() + getRateLimitPauseMs();
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
            this.clearFailed(currentItem);
            this.countToday++;
            this.batchCount++;
            // Ledger write happened inside handleBlockUser (markBlockedOnX) —
            // the queue here only tracks counters.
            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockToday: this.countToday,
              autoBlockBatchCount: this.batchCount,
              blockFailedAt: this.failedAt,
            });
            void addLog('info', 'block', `已拉黑 @${currentItem}（今日第 ${this.countToday} 个）`);
          } else if (outcome === 'rate-limited') {
            const cooldownMinutes = Math.max(1, Math.round((pauseUntil - Date.now()) / 60_000));
            console.warn(
              `[X-Blocker] API rate limited (429). Pausing auto block for ${cooldownMinutes} mins.`,
            );
            this.queue.unshift(currentItem);
            this.pausedUntil = pauseUntil;
            this.batchCount = 0;
            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockPausedUntil: this.pausedUntil,
              autoBlockBatchCount: this.batchCount,
            });
            void addLog('warn', 'block', `触发 X 限流（429），随机暂停约 ${cooldownMinutes} 分钟`);
            break;
          } else if (outcome === 'transient') {
            const attempts = (this.retryCounts.get(currentItem) ?? 0) + 1;
            this.retryCounts.set(currentItem, attempts);
            if (attempts > MAX_BLOCK_RETRIES) {
              console.error(
                `[X-Blocker] Auto block giving up on ${currentItem} after ${attempts} attempts:`,
                failReason,
              );
              void addLog(
                'error',
                'block',
                `放弃重试 @${currentItem}：${failReason}（24 小时内不再自动回填）`,
              );
              this.retryCounts.delete(currentItem);
              this.markFailed(currentItem);
              await this.saveState({ autoBlockQueue: this.queue, blockFailedAt: this.failedAt });
            } else {
              console.warn(
                `[X-Blocker] Auto block transient failure for ${currentItem}, retry ${attempts}/${MAX_BLOCK_RETRIES}:`,
                failReason,
              );
              this.queue.push(currentItem);
              await this.saveState({ autoBlockQueue: this.queue });
              // Jittered exponential backoff (up to 5 min) — a deterministic
              // 2^n wait is another recognizable automation rhythm.
              const backoffMs = Math.min(
                5 * 60_000,
                5_000 * 2 ** (attempts - 1) * (0.5 + Math.random() * 0.5),
              );
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          } else {
            this.retryCounts.delete(currentItem);
            // Expected permanent failures (e.g. account already deleted, no
            // X session) are logged as warnings, not console errors.
            console.warn('[X-Blocker] Auto block skipped:', currentItem, failReason);
            void addLog(
              'warn',
              'block',
              `跳过 @${currentItem}：${failReason}（24 小时内不再自动回填）`,
            );
            this.markFailed(currentItem);
            await this.saveState({ autoBlockQueue: this.queue, blockFailedAt: this.failedAt });
          }

          if (this.queue.length > 0) {
            // Human-like gap: random band around the baseline, with frequent
            // longer pauses — never a fixed seconds tick.
            const gapMs = getDynamicGapMs(this.minDelayMs, this.maxDelayMs);
            await new Promise((r) => setTimeout(r, gapMs));
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

export interface BlockUserResult {
  success: boolean;
  reason?: string;
  status?: number;
  permanent?: boolean;
  screenName?: string;
}
