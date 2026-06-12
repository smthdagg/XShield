import type { BlockExecutorConfig } from '@xshield/shared';
import type { BlockQueueStorage } from './queue';
import { canRetry } from './retry';
import { shouldPauseAfterFailure } from './scheduler';

export type { BlockQueueStorage } from './queue';
export { getNextDelayMs, shouldPauseAfterFailure } from './scheduler';

export interface BlockExecutorAdapter {
  blockUser(username: string): Promise<void>;
}

export class MockBlockAdapter implements BlockExecutorAdapter {
  async blockUser(username: string): Promise<void> {
    console.log(`Mock block user: ${username}`);
  }
}

export class BlockExecutor {
  private paused = false;

  constructor(
    private storage: BlockQueueStorage,
    private adapter: BlockExecutorAdapter,
    private config: BlockExecutorConfig,
  ) {}

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async runOnce(): Promise<void> {
    if (this.paused) return;

    const items = await this.storage.getQueued(this.config.batchSize);
    for (const item of items) {
      if (this.paused) break;

      try {
        await this.storage.markRunning(item.id);
        await this.adapter.blockUser(item.username);
        await this.storage.markSuccess(item.id);
      } catch (error) {
        const message = String(error || 'Unknown error');
        if (canRetry(item.retryCount, this.config.maxRetries)) {
          await this.storage.incrementRetry(item.id, message);
        } else {
          await this.storage.markFailed(item.id, message);
        }

        if (shouldPauseAfterFailure(error)) {
          this.pause();
          break;
        }
      }
    }
  }
}
