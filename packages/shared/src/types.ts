export type UserStatus =
  | 'candidate'
  | 'pending_block'
  | 'blocked'
  | 'whitelisted'
  | 'deleted'
  | 'failed';

export type RuleType = 'keyword' | 'regex';

export type MatchField = 'username' | 'displayName' | 'bio' | 'postContent';

export interface XUserProfile {
  id: string;
  username: string;
  displayName?: string;
  bio?: string;
  postContent?: string[];
  followersCount?: number;
  followersText?: string;
  avatarUrl?: string;
  profileUrl?: string;
  discoveredAt: number;
}

export interface DetectionRule {
  id: string;
  type: RuleType;
  content: string;
  fields: MatchField[];
  enabled: boolean;
  caseSensitive: boolean;
  score: number;
  createdAt: number;
  updatedAt: number;
}

export interface DetectionResult {
  userId: string;
  matched: boolean;
  score: number;
  matchedRules: string[];
  matchedFields: MatchField[];
}

export interface CandidateUser extends XUserProfile {
  score: number;
  status: UserStatus;
  matchedRules: string[];
  matchedFields?: MatchField[];
  triggerReason?: string;
  falsePositive?: boolean;
  note?: string;
  updatedAt: number;
}

export interface BlockQueueItem {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  followersCount?: number;
  followersText?: string;
  profileUrl?: string;
  score?: number;
  matchedRules?: string[];
  matchedFields?: MatchField[];
  triggerReason?: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'paused';
  retryCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BlockedUser extends XUserProfile {
  blockedAt: number;
  sourceQueueItemId?: string;
  score?: number;
  matchedRules?: string[];
  triggerReason?: string;
}

export interface BlockExecutorConfig {
  batchSize: number;
  intervalMinutes: number;
  jitterSeconds: number;
  maxRetries: number;
  cooldownMinutesAfterFailure: number;
}

export type LanguageMode = 'system' | 'en' | 'zh' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'fr';

export type RuleExecutionMode = 'automatic' | 'manual';

export type BlockAdapterMode = 'mock' | 'real';

export type LogLevel = 'info' | 'warn' | 'error';

export interface ActivityLog {
  id: string;
  level: LogLevel;
  message: string;
  context?: string;
  createdAt: number;
}

export interface AppSettings {
  id: 'default';
  scoreThreshold: number;
  executorConfig: BlockExecutorConfig;
  queuePaused: boolean;
  language: LanguageMode;
  ruleExecutionMode: RuleExecutionMode;
  rulesRunning: boolean;
  blockAdapterMode: BlockAdapterMode;
  lastQueueRunAt?: number;
  builtInAdRulesSeeded?: boolean;
  builtInAdRulesVersion?: number;
  updatedAt: number;
}
