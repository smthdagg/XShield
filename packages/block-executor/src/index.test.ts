import { describe, expect, it } from 'vitest';
import type { BlockQueueItem } from '@xshield/shared';
import { BlockExecutor, type BlockExecutorAdapter, type BlockQueueStorage } from './index';

function createItem(overrides: Partial<BlockQueueItem> = {}): BlockQueueItem {
  return {
    id: 'queue-1',
    userId: 'alice',
    username: 'alice',
    status: 'queued',
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

class MemoryStorage implements BlockQueueStorage {
  items: BlockQueueItem[];

  constructor(items: BlockQueueItem[]) {
    this.items = items;
  }

  async getQueued(limit: number): Promise<BlockQueueItem[]> {
    return this.items.filter((item) => item.status === 'queued').slice(0, limit);
  }

  async markRunning(id: string): Promise<void> {
    this.update(id, { status: 'running' });
  }

  async markSuccess(id: string): Promise<void> {
    this.update(id, { status: 'success' });
  }

  async markFailed(id: string, error: string): Promise<void> {
    this.update(id, { status: 'failed', lastError: error });
  }

  async incrementRetry(id: string, error: string): Promise<void> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    this.update(id, { status: 'queued', retryCount: item.retryCount + 1, lastError: error });
  }

  private update(id: string, patch: Partial<BlockQueueItem>): void {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  }
}

describe('BlockExecutor', () => {
  it('runs queued items through an adapter', async () => {
    const storage = new MemoryStorage([createItem()]);
    const adapter: BlockExecutorAdapter = { blockUser: async () => undefined };
    const executor = new BlockExecutor(storage, adapter, {
      batchSize: 10,
      intervalMinutes: 10,
      jitterSeconds: 60,
      maxRetries: 3,
      cooldownMinutesAfterFailure: 30,
    });

    await executor.runOnce();

    expect(storage.items[0].status).toBe('success');
  });

  it('pauses on rate-limit style failures', async () => {
    const storage = new MemoryStorage([createItem()]);
    const adapter: BlockExecutorAdapter = {
      blockUser: async () => {
        throw new Error('429 too many requests');
      },
    };
    const executor = new BlockExecutor(storage, adapter, {
      batchSize: 10,
      intervalMinutes: 10,
      jitterSeconds: 60,
      maxRetries: 3,
      cooldownMinutesAfterFailure: 30,
    });

    await executor.runOnce();

    expect(storage.items[0].status).toBe('queued');
    expect(storage.items[0].retryCount).toBe(1);
    expect(executor.isPaused()).toBe(true);
  });
});
