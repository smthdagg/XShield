import type { BlockQueueItem } from '@xshield/shared';

export interface BlockQueueStorage {
  getQueued(limit: number): Promise<BlockQueueItem[]>;
  markRunning(id: string): Promise<void>;
  markSuccess(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  incrementRetry(id: string, error: string): Promise<void>;
}
