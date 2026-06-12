import Dexie, { type Table } from 'dexie';
import type {
  ActivityLog,
  AppSettings,
  BlockedUser,
  BlockQueueItem,
  CandidateUser,
  DetectionRule,
  XUserProfile,
} from '@xshield/shared';

export class XShieldDB extends Dexie {
  candidates!: Table<CandidateUser, string>;
  rules!: Table<DetectionRule, string>;
  blockQueue!: Table<BlockQueueItem, string>;
  blockedUsers!: Table<BlockedUser, string>;
  discoveredUsers!: Table<XUserProfile, string>;
  logs!: Table<ActivityLog, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('xshield');
    this.version(1).stores({
      candidates: 'id, username, status, score, discoveredAt, updatedAt',
      rules: 'id, type, enabled, createdAt, updatedAt',
      blockQueue: 'id, userId, username, status, retryCount, createdAt, updatedAt',
    });
    this.version(2).stores({
      candidates: 'id, username, status, score, discoveredAt, updatedAt',
      rules: 'id, type, enabled, createdAt, updatedAt',
      blockQueue: 'id, userId, username, status, retryCount, createdAt, updatedAt',
      logs: 'id, level, createdAt',
      settings: 'id, updatedAt',
    });
    this.version(3).stores({
      candidates: 'id, username, status, score, discoveredAt, updatedAt',
      rules: 'id, type, enabled, createdAt, updatedAt',
      blockQueue: 'id, userId, username, status, retryCount, createdAt, updatedAt',
      discoveredUsers: 'id, username, discoveredAt',
      logs: 'id, level, createdAt',
      settings: 'id, updatedAt',
    });
    this.version(4).stores({
      candidates: 'id, username, status, score, discoveredAt, updatedAt',
      rules: 'id, type, enabled, createdAt, updatedAt',
      blockQueue: 'id, userId, username, status, retryCount, createdAt, updatedAt',
      blockedUsers: 'id, username, blockedAt',
      discoveredUsers: 'id, username, discoveredAt',
      logs: 'id, level, createdAt',
      settings: 'id, updatedAt',
    });
  }
}

export const db = new XShieldDB();
