import type { LogLevel } from '@xshield/shared';
import { db } from './dexie';

export async function addLog(level: LogLevel, message: string, context?: string): Promise<void> {
  const now = Date.now();
  await db.logs.put({
    id: `${now}:${crypto.randomUUID()}`,
    level,
    message,
    context,
    createdAt: now,
  });
}
