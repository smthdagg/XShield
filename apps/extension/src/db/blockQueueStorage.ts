import type { BlockQueueStorage } from '@xshield/block-executor';
import type { BlockQueueItem } from '@xshield/shared';
import { db } from './dexie';

export const dexieBlockQueueStorage: BlockQueueStorage = {
  async getQueued(limit: number): Promise<BlockQueueItem[]> {
    return db.blockQueue.where('status').equals('queued').limit(limit).toArray();
  },
  async markRunning(id: string): Promise<void> {
    await db.blockQueue.update(id, { status: 'running', updatedAt: Date.now() });
  },
  async markSuccess(id: string): Promise<void> {
    await db.blockQueue.update(id, { status: 'success', updatedAt: Date.now() });
  },
  async markFailed(id: string, error: string): Promise<void> {
    await db.blockQueue.update(id, {
      status: 'failed',
      lastError: error,
      updatedAt: Date.now(),
    });
  },
  async incrementRetry(id: string, error: string): Promise<void> {
    const item = await db.blockQueue.get(id);
    if (!item) return;

    await db.blockQueue.update(id, {
      status: 'queued',
      retryCount: item.retryCount + 1,
      lastError: error,
      updatedAt: Date.now(),
    });
  },
};
