import type { BlockExecutorConfig } from '@xshield/shared';

export function getNextDelayMs(config: BlockExecutorConfig): number {
  const baseMs = config.intervalMinutes * 60 * 1000;
  const jitterMs = Math.floor(Math.random() * config.jitterSeconds * 1000);
  return baseMs + jitterMs;
}

export function shouldPauseAfterFailure(error: unknown): boolean {
  const message = String(error || '').toLowerCase();
  return (
    message.includes('rate') ||
    message.includes('429') ||
    message.includes('too many') ||
    message.includes('temporarily')
  );
}
