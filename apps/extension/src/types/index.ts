export interface RuntimeMessage<TPayload = unknown> {
  source: 'xshield';
  type:
    | 'VISIBLE_USERS_COLLECTED'
    | 'MATCHED_USERS_DETECTED'
    | 'COLLECT_VISIBLE_USERS'
    | 'OPEN_DASHBOARD'
    | 'XSHIELD_PING'
    | 'REAL_BLOCK_USER'
    | 'RUN_BLOCK_QUEUE'
    | 'SYNC_BLOCK_QUEUE_ALARM';
  payload?: TPayload;
}

export interface MatchedUsersPayload {
  usernames: string[];
}

export interface CollectVisibleUsersPayload {
  scrollPasses?: number;
}

export interface RealBlockUserPayload {
  username: string;
}

export interface RealBlockUserResult {
  success: boolean;
  error?: string;
  alreadyBlocked?: boolean;
}

export interface QueueRunResult {
  skipped: boolean;
  blockedCount: number;
  attemptedCount: number;
  skippedCount: number;
  failedCount: number;
  remainingQueuedCount: number;
  stopReason?: string;
  message: string;
}
