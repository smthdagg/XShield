import { BlockExecutor, MockBlockAdapter } from '@xshield/block-executor';
import type { AppSettings, BlockQueueItem } from '@xshield/shared';
import type { QueueRunResult } from '../types';
import { dexieBlockQueueStorage } from '../db/blockQueueStorage';
import { db } from '../db/dexie';
import { addLog } from '../db/logs';
import { seedDefaults } from '../db/seed';
import { XApiBlockAdapter, XBlockAuthError, XBlockSkipError } from './xApiBlockAdapter';

export const BLOCK_QUEUE_ALARM = 'xshield:block-queue';
const STALE_RUNNING_MS = 2 * 60 * 1000;

export interface QueueRunOptions {
  force?: boolean;
}

interface QueueBatchStats {
  attemptedCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  stopped: boolean;
  stopReason?: string;
}

function emptyStats(): QueueBatchStats {
  return {
    attemptedCount: 0,
    blockedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    stopped: false,
  };
}

function getAlarmPeriodMinutes(intervalMinutes: number): number {
  return Math.max(1, intervalMinutes || 1);
}

export async function syncBlockQueueAlarm(): Promise<void> {
  if (!chrome.alarms) return;

  await seedDefaults();
  const settings = await db.settings.get('default');
  await chrome.alarms.clear(BLOCK_QUEUE_ALARM);

  if (!settings || settings.queuePaused) return;

  chrome.alarms.create(BLOCK_QUEUE_ALARM, {
    delayInMinutes: getAlarmPeriodMinutes(settings.executorConfig.intervalMinutes),
    periodInMinutes: getAlarmPeriodMinutes(settings.executorConfig.intervalMinutes),
  });
}

async function markQueueItemBlocked(item: BlockQueueItem, blockedAt: number): Promise<void> {
  await db.blockedUsers.put({
    id: item.userId,
    username: item.username,
    displayName: item.displayName,
    bio: item.bio,
    avatarUrl: item.avatarUrl,
    followersCount: item.followersCount,
    followersText: item.followersText,
    profileUrl: item.profileUrl,
    postContent: [],
    discoveredAt: item.createdAt,
    blockedAt,
    sourceQueueItemId: item.id,
    score: item.score,
    matchedRules: item.matchedRules,
    triggerReason: item.triggerReason,
  });
  await db.candidates.update(item.userId, {
    status: 'blocked',
    updatedAt: blockedAt,
  });
  await db.blockQueue.delete(item.id);
}

async function removeSkippedQueueItem(item: BlockQueueItem, message: string): Promise<void> {
  const now = Date.now();
  await db.candidates.update(item.userId, {
    status: 'failed',
    note: message,
    updatedAt: now,
  });
  await db.blockQueue.delete(item.id);
}

async function finalizeMockSuccesses(): Promise<number> {
  const completed = await db.blockQueue.where('status').equals('success').toArray();
  const completedAt = Date.now();
  await db.transaction('rw', db.blockQueue, db.candidates, db.blockedUsers, async () => {
    await Promise.all(completed.map((item) => markQueueItemBlocked(item, completedAt)));
  });
  return completed.length;
}

async function runMockQueueBatch(settings: AppSettings): Promise<QueueBatchStats> {
  const attemptedCount = await db.blockQueue
    .where('status')
    .equals('queued')
    .limit(settings.executorConfig.batchSize)
    .count();
  const adapter = new MockBlockAdapter();
  const executor = new BlockExecutor(dexieBlockQueueStorage, adapter, settings.executorConfig);
  await executor.runOnce();
  const blockedCount = await finalizeMockSuccesses();
  const failedCount = await db.blockQueue.where('status').equals('failed').count();
  return {
    attemptedCount,
    blockedCount,
    skippedCount: 0,
    failedCount,
    stopped: false,
  };
}

async function runRealQueueBatch(settings: AppSettings): Promise<QueueBatchStats> {
  const adapter = new XApiBlockAdapter();
  const items = await db.blockQueue
    .where('status')
    .equals('queued')
    .limit(settings.executorConfig.batchSize)
    .toArray();

  const stats = emptyStats();
  for (const item of items) {
    stats.attemptedCount += 1;
    const now = Date.now();
    if (await db.blockedUsers.get(item.userId)) {
      await db.blockQueue.delete(item.id);
      await addLog('info', `Removed @${item.username} from queue because it is already in blocked database`, 'block-queue');
      stats.skippedCount += 1;
      continue;
    }

    try {
      await db.blockQueue.update(item.id, { status: 'running', updatedAt: now });
      await adapter.blockUser(item.username);
      await markQueueItemBlocked(item, Date.now());
      stats.blockedCount += 1;
    } catch (error) {
      const message = String((error as Error)?.message || error || 'Unknown error');
      if (error instanceof XBlockSkipError) {
        if (error.reason === 'already-blocked') {
          await markQueueItemBlocked(item, Date.now());
          stats.blockedCount += 1;
        } else {
          await removeSkippedQueueItem(item, message);
          stats.skippedCount += 1;
        }
        await addLog('warn', `Skipped @${item.username}: ${message}`, 'block-queue');
        continue;
      }

      if (error instanceof XBlockAuthError) {
        await db.blockQueue.update(item.id, { status: 'queued', lastError: message, updatedAt: Date.now() });
        const reason = `Stopped at @${item.username}: ${message}`;
        await addLog('error', `Real block stopped: ${reason}`, 'block-queue');
        stats.failedCount += 1;
        stats.stopped = true;
        stats.stopReason = reason;
        break;
      }

      if (item.retryCount < settings.executorConfig.maxRetries) {
        await db.blockQueue.update(item.id, {
          status: 'queued',
          retryCount: item.retryCount + 1,
          lastError: message,
          updatedAt: Date.now(),
        });
      } else {
        stats.failedCount += 1;
        await db.blockQueue.update(item.id, {
          status: 'failed',
          lastError: message,
          updatedAt: Date.now(),
        });
      }
    }
  }

  return stats;
}

async function restoreStaleRunningItems(): Promise<number> {
  const cutoff = Date.now() - STALE_RUNNING_MS;
  const staleItems = await db.blockQueue
    .where('status')
    .equals('running')
    .filter((item) => item.updatedAt < cutoff)
    .toArray();

  await Promise.all(
    staleItems.map((item) =>
      db.blockQueue.update(item.id, {
        status: 'queued',
        lastError: 'Recovered stale running queue item',
        updatedAt: Date.now(),
      }),
    ),
  );

  return staleItems.length;
}

export async function runBlockQueueBatch(options: QueueRunOptions = {}): Promise<QueueRunResult> {
  await seedDefaults();
  const settings = await db.settings.get('default');
  if (!settings || settings.queuePaused) {
    const message = 'Queue run skipped because queue is paused';
    await addLog('warn', message, 'block-queue');
    const remainingQueuedCount = await db.blockQueue.where('status').equals('queued').count();
    return {
      skipped: true,
      blockedCount: 0,
      attemptedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      remainingQueuedCount,
      message,
    };
  }

  const now = Date.now();
  const intervalMs = settings.executorConfig.intervalMinutes * 60 * 1000;
  const elapsedMs = settings.lastQueueRunAt ? now - settings.lastQueueRunAt : intervalMs;
  if (!options.force && intervalMs > 0 && elapsedMs < intervalMs) {
    const nextRunAt = new Date(settings.lastQueueRunAt! + intervalMs).toLocaleString();
    const message = `Block queue skipped until ${nextRunAt}`;
    await addLog('warn', message, 'block-queue');
    const remainingQueuedCount = await db.blockQueue.where('status').equals('queued').count();
    return {
      skipped: true,
      blockedCount: 0,
      attemptedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      remainingQueuedCount,
      message,
    };
  }

  const restoredCount = await restoreStaleRunningItems();
  if (restoredCount > 0) {
    await addLog('warn', `Recovered ${restoredCount} stale running queue item(s)`, 'block-queue');
  }

  const whitelistedCandidates = await db.candidates
    .where('status')
    .equals('whitelisted')
    .toArray();
  const whitelistedIds = new Set(whitelistedCandidates.map((candidate) => candidate.id));
  const queuedItems = await db.blockQueue.where('status').equals('queued').toArray();
  await Promise.all(
    queuedItems
      .filter((item) => whitelistedIds.has(item.userId))
      .map((item) =>
        db.blockQueue.update(item.id, {
          status: 'paused',
          lastError: 'Skipped because user is whitelisted as false positive',
          updatedAt: Date.now(),
        }),
      ),
  );

  const executableCount = await db.blockQueue.where('status').equals('queued').count();
  if (executableCount === 0) {
    const message = 'No queued users to execute';
    await addLog('warn', message, 'block-queue');
    return {
      skipped: true,
      blockedCount: 0,
      attemptedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      remainingQueuedCount: 0,
      message,
    };
  }

  const stats =
    settings.blockAdapterMode === 'real'
      ? await runRealQueueBatch(settings)
      : await runMockQueueBatch(settings);
  const remainingQueuedCount = await db.blockQueue.where('status').equals('queued').count();

  await db.settings.put({
    ...settings,
    lastQueueRunAt: Date.now(),
    updatedAt: Date.now(),
  });

  const stopSuffix = stats.stopReason ? `; ${stats.stopReason}` : stats.stopped ? '; stopped early' : '';
  const message = `Ran one ${settings.blockAdapterMode === 'real' ? 'real API' : 'mock'} block queue batch; attempted ${stats.attemptedCount}, blocked ${stats.blockedCount}, skipped ${stats.skippedCount}, failed ${stats.failedCount}, remaining queued ${remainingQueuedCount}${stopSuffix}`;
  await addLog('info', message, 'block-queue');
  await syncBlockQueueAlarm();
  return {
    skipped: false,
    blockedCount: stats.blockedCount,
    attemptedCount: stats.attemptedCount,
    skippedCount: stats.skippedCount,
    failedCount: stats.failedCount,
    remainingQueuedCount,
    stopReason: stats.stopReason,
    message,
  };
}
