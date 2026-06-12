import { evaluateUser } from '@xshield/rule-engine';
import type {
  ActivityLog,
  AppSettings,
  BlockedUser,
  BlockQueueItem,
  CandidateUser,
  DetectionRule,
  MatchField,
  RuleType,
  XUserProfile,
} from '@xshield/shared';
import { create } from 'zustand';
import { db } from '../db/dexie';
import { addLog } from '../db/logs';
import { seedDefaults } from '../db/seed';
import {
  canonicalizeProfile,
  ensureCanonicalUserRecords,
  getCanonicalUserId,
  mergeCandidates,
  mergeProfiles,
  upsertCandidate,
  upsertDiscoveredUsers,
} from '../db/users';
import { runBlockQueueBatch, syncBlockQueueAlarm, type QueueRunOptions } from './queueRunner';
import type { CollectVisibleUsersPayload, QueueRunResult, RuntimeMessage } from '../types';

export interface RuleDraft {
  id?: string;
  type: RuleType;
  content: string;
  fields: MatchField[];
  enabled: boolean;
  caseSensitive: boolean;
  score: number;
}

export interface RuleRunSummary {
  scannedCount: number;
  evaluatedCount: number;
  matchedCount: number;
  message: string;
}

interface AppState {
  candidates: CandidateUser[];
  blockedUsers: BlockedUser[];
  rules: DetectionRule[];
  blockQueue: BlockQueueItem[];
  logs: ActivityLog[];
  settings?: AppSettings;
  searchResults: XUserProfile[];
  loadAll: () => Promise<void>;
  saveRule: (draft: RuleDraft) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  toggleRule: (id: string, enabled: boolean) => Promise<void>;
  addManualCandidate: (profile: XUserProfile) => Promise<void>;
  searchUsers: (query: string) => Promise<void>;
  addCandidateToQueue: (candidate: CandidateUser) => Promise<void>;
  addCandidatesToQueue: (candidates: CandidateUser[]) => Promise<void>;
  removeQueueItem: (id: string) => Promise<void>;
  removeQueueItems: (ids: string[]) => Promise<void>;
  whitelistQueueItems: (ids: string[]) => Promise<void>;
  runQueueOnce: (options?: QueueRunOptions) => Promise<QueueRunResult>;
  evaluateCandidatesNow: () => Promise<RuleRunSummary>;
  setQueuePaused: (paused: boolean) => Promise<void>;
  whitelistCandidate: (id: string) => Promise<void>;
  markFalsePositive: (id: string) => Promise<void>;
  restoreCandidate: (id: string) => Promise<void>;
  deleteCandidate: (id: string) => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  clearLogs: () => Promise<void>;
}

const X_URL_PATTERNS = ['https://x.com/*', 'https://twitter.com/*'];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildUserSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    src: 'typed_query',
    f: 'user',
    xshield_ts: String(Date.now()),
  });
  return `https://x.com/search?${params.toString()}`;
}

function normalizeScreenName(username: string): string {
  return username.replace(/^@+/, '').trim();
}

function parseProfileNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function decodeJsonString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
  }
}

function findFirst(source: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function extractProfileFromHtml(username: string, html: string): Partial<XUserProfile> {
  const followersValue = findFirst(html, [
    /"followers_count"\s*:\s*(\d+)/,
    /\\"followers_count\\"\s*:\s*(\d+)/,
    /"normal_followers_count"\s*:\s*(\d+)/,
    /\\"normal_followers_count\\"\s*:\s*(\d+)/,
  ]);
  const displayName = decodeJsonString(
    findFirst(html, [/"name"\s*:\s*"([^"]+)"/, /\\"name\\"\s*:\s*\\"([^"]+)\\"/]),
  );
  const bio = decodeJsonString(
    findFirst(html, [
      /"description"\s*:\s*"([^"]*)"/,
      /\\"description\\"\s*:\s*\\"([^"]*)\\"/,
    ]),
  );
  const avatarUrl = decodeJsonString(
    findFirst(html, [
      /"profile_image_url_https"\s*:\s*"([^"]+)"/,
      /\\"profile_image_url_https\\"\s*:\s*\\"([^"]+)\\"/,
    ]),
  );
  const followersCount = parseProfileNumber(followersValue);

  return {
    username,
    displayName,
    bio,
    avatarUrl,
    followersCount,
    followersText:
      typeof followersCount === 'number' ? `${followersCount.toLocaleString()} followers` : undefined,
  };
}

async function fetchXProfileSnapshot(username: string): Promise<Partial<XUserProfile>> {
  const normalizedUsername = normalizeScreenName(username);
  if (!normalizedUsername) return {};

  try {
    const response = await fetch(`https://x.com/${encodeURIComponent(normalizedUsername)}`, {
      credentials: 'include',
    });
    if (!response.ok) return {};

    return extractProfileFromHtml(normalizedUsername, await response.text());
  } catch {
    return {};
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 12000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await wait(300);
  }
}

async function findOrCreateXTab(searchQuery?: string): Promise<number | undefined> {
  if (!chrome?.tabs?.query) return undefined;

  const tabs = await chrome.tabs.query({
    currentWindow: true,
    url: X_URL_PATTERNS,
  });
  const existingTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const targetUrl = searchQuery ? buildUserSearchUrl(searchQuery) : undefined;

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, {
      active: false,
      ...(targetUrl ? { url: targetUrl } : {}),
    });
    return existingTab.id;
  }

  if (!targetUrl) return undefined;

  const created = await chrome.tabs.create({ active: false, url: targetUrl });
  return created.id;
}

async function sendCollectMessage(tabId: number, scrollPasses: number): Promise<XUserProfile[]> {
  const message: RuntimeMessage<CollectVisibleUsersPayload> = {
    source: 'xshield',
    type: 'COLLECT_VISIBLE_USERS',
    payload: { scrollPasses },
  };
  return chrome.tabs.sendMessage<RuntimeMessage, XUserProfile[]>(tabId, message);
}

async function collectUsersFromXTab(query?: string, scrollPasses = 0): Promise<XUserProfile[]> {
  const tabId = await findOrCreateXTab(query);
  if (!tabId) return [];

  if (query) {
    await waitForTabComplete(tabId);
    await wait(2200);
  }

  try {
    return await sendCollectMessage(tabId, scrollPasses);
  } catch (error) {
    const message = String(error).toLowerCase();
    if (!message.includes('context invalidated') && !message.includes('receiving end')) {
      return [];
    }

    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    await wait(2200);

    try {
      return await sendCollectMessage(tabId, scrollPasses);
    } catch {
      return [];
    }
  }
}

function matchesKeyword(profile: XUserProfile, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const haystack = [
    profile.username,
    profile.displayName,
    profile.bio,
    ...(profile.postContent ?? []),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return haystack.includes(normalized);
}

function createCandidate(profile: XUserProfile, rules: DetectionRule[], threshold: number): CandidateUser {
  const canonicalProfile = canonicalizeProfile(profile);
  const result = evaluateUser(canonicalProfile, rules, threshold);
  return {
    ...canonicalProfile,
    score: result.score,
    status: result.matched ? 'candidate' : 'candidate',
    matchedRules: result.matchedRules,
    matchedFields: result.matchedFields,
    triggerReason: result.matchedRules.join(', '),
    updatedAt: Date.now(),
  };
}

async function enrichCandidateBeforeQueue(candidate: CandidateUser): Promise<CandidateUser> {
  if (typeof candidate.followersCount === 'number' && candidate.followersText && candidate.avatarUrl) {
    return candidate;
  }

  const snapshot = await fetchXProfileSnapshot(candidate.username);
  if (
    typeof snapshot.followersCount !== 'number' &&
    !snapshot.followersText &&
    !snapshot.avatarUrl &&
    !snapshot.bio &&
    !snapshot.displayName
  ) {
    return candidate;
  }

  const enriched = mergeCandidates(candidate, {
    ...candidate,
    ...snapshot,
    updatedAt: Date.now(),
  });
  await db.candidates.put(enriched);
  await upsertDiscoveredUsers([enriched]);
  await addLog('info', `Enriched @${candidate.username} profile before queue`, 'profile');
  return enriched;
}

export const useAppStore = create<AppState>((set, get) => ({
  candidates: [],
  blockedUsers: [],
  rules: [],
  blockQueue: [],
  logs: [],
  searchResults: [],
  async loadAll() {
    await seedDefaults();
    await ensureCanonicalUserRecords();
    const [candidates, blockedUsers, rules, blockQueue, logs, settings] = await Promise.all([
      db.candidates.orderBy('updatedAt').reverse().toArray(),
      db.blockedUsers.orderBy('blockedAt').reverse().toArray(),
      db.rules.orderBy('updatedAt').reverse().toArray(),
      db.blockQueue.orderBy('updatedAt').reverse().toArray(),
      db.logs.orderBy('createdAt').reverse().limit(200).toArray(),
      db.settings.get('default'),
    ]);
    set({ candidates, blockedUsers, rules, blockQueue, logs, settings });
  },
  async saveRule(draft) {
    const now = Date.now();
    const id = draft.id || `rule:${now}:${crypto.randomUUID()}`;
    const existing = draft.id ? await db.rules.get(draft.id) : undefined;
    await db.rules.put({
      id,
      type: draft.type,
      content: draft.content.trim(),
      fields: draft.fields,
      enabled: draft.enabled,
      caseSensitive: draft.caseSensitive,
      score: draft.score,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await addLog('info', existing ? `Updated rule ${draft.content}` : `Created rule ${draft.content}`, 'rules');
    await get().loadAll();
  },
  async deleteRule(id) {
    await db.rules.delete(id);
    await addLog('warn', `Deleted rule ${id}`, 'rules');
    await get().loadAll();
  },
  async toggleRule(id, enabled) {
    await db.rules.update(id, { enabled, updatedAt: Date.now() });
    await addLog('info', `${enabled ? 'Enabled' : 'Disabled'} rule ${id}`, 'rules');
    await get().loadAll();
  },
  async addManualCandidate(profile) {
    const settings = get().settings;
    const candidate = createCandidate(
      profile,
      get().rules.filter((rule) => rule.enabled),
      settings?.scoreThreshold ?? 60,
    );
    const existing = await db.candidates.get(candidate.id);
    if (existing?.status === 'whitelisted') {
      await addLog('warn', `Skipped whitelisted user @${candidate.username}`, 'manual-search');
      return;
    }
    await db.candidates.put(
      mergeCandidates(existing, { ...candidate, status: existing?.status ?? candidate.status }),
    );
    await addLog('info', `Added @${candidate.username} to candidates`, 'manual-search');
    await get().loadAll();
  },
  async searchUsers(query) {
    const trimmedQuery = query.trim();
    const visibleUsers = await collectUsersFromXTab(trimmedQuery || undefined, trimmedQuery ? 8 : 2);
    if (visibleUsers.length > 0) {
      await upsertDiscoveredUsers(visibleUsers);
      await addLog(
        'info',
        `Collected ${visibleUsers.length} X user result(s) before search`,
        trimmedQuery || 'visible-page',
      );
    }

    const [discoveredUsers, candidates] = await Promise.all([
      db.discoveredUsers.toArray(),
      db.candidates.toArray(),
    ]);
    const sourceProfiles = [...discoveredUsers, ...candidates];
    const localResults = trimmedQuery
      ? sourceProfiles.filter((profile) => matchesKeyword(profile, trimmedQuery))
      : sourceProfiles.slice(-100);
    const deduped = new Map<string, XUserProfile>();
    localResults.forEach((profile) => {
      const canonicalId = getCanonicalUserId(profile);
      const current = deduped.get(canonicalId);
      deduped.set(canonicalId, mergeProfiles(current, canonicalizeProfile(profile)));
    });
    const results = Array.from(deduped.values());

    set({ searchResults: results });
    await addLog('info', `Keyword search returned ${results.length} result(s)`, trimmedQuery);
    await get().loadAll();
  },
  async addCandidateToQueue(candidate) {
    if (candidate.status === 'whitelisted' || candidate.falsePositive) {
      await addLog('warn', `Skipped whitelisted false-positive @${candidate.username}`, 'block-queue');
      await get().loadAll();
      return;
    }

    const queueCandidate = await enrichCandidateBeforeQueue(candidate);

    const existingBlocked = await db.blockedUsers.get(queueCandidate.id);
    if (existingBlocked) {
      await db.candidates.update(queueCandidate.id, { status: 'blocked', updatedAt: Date.now() });
      await addLog('info', `Skipped @${queueCandidate.username} because it is already blocked`, 'block-queue');
      await get().loadAll();
      return;
    }

    const existingQueueItem = await db.blockQueue.where('userId').equals(queueCandidate.id).first();
    if (existingQueueItem) {
      await db.candidates.update(queueCandidate.id, { status: 'pending_block', updatedAt: Date.now() });
      await addLog('info', `@${queueCandidate.username} is already in block queue`, 'block-queue');
      await get().loadAll();
      return;
    }

    const now = Date.now();
    await db.transaction('rw', db.candidates, db.blockQueue, async () => {
      await db.candidates.update(queueCandidate.id, {
        status: 'pending_block',
        updatedAt: now,
      });
      await db.blockQueue.put({
        id: `${queueCandidate.id}:${now}`,
        userId: queueCandidate.id,
        username: queueCandidate.username,
        displayName: queueCandidate.displayName,
        bio: queueCandidate.bio,
        avatarUrl: queueCandidate.avatarUrl,
        followersCount: queueCandidate.followersCount,
        followersText: queueCandidate.followersText,
        profileUrl: queueCandidate.profileUrl,
        score: queueCandidate.score,
        matchedRules: queueCandidate.matchedRules,
        matchedFields: queueCandidate.matchedFields,
        triggerReason: queueCandidate.triggerReason,
        status: 'queued',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    });
    await addLog('info', `Queued @${queueCandidate.username} for block review`, 'block-queue');
    await get().loadAll();
  },
  async addCandidatesToQueue(candidatesToQueue) {
    const queueable = candidatesToQueue.filter(
      (candidate) => candidate.status !== 'whitelisted' && !candidate.falsePositive,
    );
    for (const candidate of queueable) {
      await get().addCandidateToQueue(candidate);
    }
    await addLog('info', `Queued ${queueable.length} selected user(s)`, 'block-queue');
    await get().loadAll();
  },
  async removeQueueItem(id) {
    await db.blockQueue.delete(id);
    await addLog('warn', `Removed queue item ${id}`, 'block-queue');
    await get().loadAll();
  },
  async removeQueueItems(ids) {
    await db.transaction('rw', db.blockQueue, db.candidates, async () => {
      const items = await db.blockQueue.bulkGet(ids);
      await db.blockQueue.bulkDelete(ids);
      await Promise.all(
        items
          .filter((item): item is BlockQueueItem => Boolean(item))
          .map((item) =>
            db.candidates.update(item.userId, {
              status: 'candidate',
              updatedAt: Date.now(),
            }),
          ),
      );
    });
    await addLog('warn', `Removed ${ids.length} selected queue item(s)`, 'block-queue');
    await get().loadAll();
  },
  async whitelistQueueItems(ids) {
    await db.transaction('rw', db.blockQueue, db.candidates, async () => {
      const items = await db.blockQueue.bulkGet(ids);
      const existingItems = items.filter((item): item is BlockQueueItem => Boolean(item));
      await Promise.all(
        existingItems.map((item) =>
          db.candidates.update(item.userId, {
            status: 'whitelisted',
            falsePositive: true,
            note: 'Whitelisted from block queue',
            updatedAt: Date.now(),
          }),
        ),
      );
      await db.blockQueue.bulkDelete(ids);
    });
    await addLog('info', `Whitelisted ${ids.length} selected queue item(s)`, 'whitelist');
    await get().loadAll();
  },
  async runQueueOnce(options) {
    const result = await runBlockQueueBatch(options);
    await get().loadAll();
    return result;
  },
  async evaluateCandidatesNow() {
    const settings = get().settings;
    const activeRules = get().rules.filter((rule) => rule.enabled);
    if (activeRules.length === 0) {
      const message = 'Rule run skipped because no enabled rules exist';
      await addLog('warn', message, 'rules');
      await get().loadAll();
      return { scannedCount: 0, evaluatedCount: 0, matchedCount: 0, message };
    }

    const threshold = settings?.scoreThreshold ?? 60;
    const now = Date.now();
    const visibleUsers = await collectUsersFromXTab(undefined, 2);
    const discoveredUsers =
      visibleUsers.length > 0
        ? await upsertDiscoveredUsers(visibleUsers.map(canonicalizeProfile))
        : [];
    const candidatesToEvaluate = await db.candidates
      .where('status')
      .noneOf(['deleted', 'whitelisted', 'blocked'])
      .toArray();

    const profilesById = new Map<string, XUserProfile | CandidateUser>();
    candidatesToEvaluate.forEach((candidate) => profilesById.set(candidate.id, candidate));
    discoveredUsers.forEach((profile) => profilesById.set(profile.id, profile));

    let matchedCount = 0;
    for (const profile of profilesById.values()) {
      if (await db.blockedUsers.get(profile.id)) continue;
      const existing = await db.candidates.get(profile.id);
      if (existing?.status === 'whitelisted' || existing?.status === 'blocked') continue;

      const result = evaluateUser(profile, activeRules, threshold);
      if (result.matched) matchedCount += 1;

      if (existing) {
        await db.candidates.update(profile.id, {
          score: result.score,
          matchedRules: result.matchedRules,
          matchedFields: result.matchedFields,
          triggerReason: result.matchedRules.join(', '),
          updatedAt: now,
        });
      } else if (result.matched) {
        await upsertCandidate({
          ...canonicalizeProfile(profile),
          score: result.score,
          status: 'candidate',
          matchedRules: result.matchedRules,
          matchedFields: result.matchedFields,
          triggerReason: result.matchedRules.join(', '),
          updatedAt: now,
        });
      }
    }

    const message = `Rule run scanned ${discoveredUsers.length} visible X user(s), evaluated ${profilesById.size} user(s), matched ${matchedCount} user(s)`;
    await addLog('info', message, 'rules');
    await get().loadAll();
    return {
      scannedCount: discoveredUsers.length,
      evaluatedCount: profilesById.size,
      matchedCount,
      message,
    };
  },
  async setQueuePaused(paused) {
    const current = get().settings;
    if (!current) return;

    await db.settings.put({
      ...current,
      queuePaused: paused,
      updatedAt: Date.now(),
    });
    await syncBlockQueueAlarm();
    await addLog('info', paused ? 'Paused block queue' : 'Resumed block queue', 'settings');
    await get().loadAll();
  },
  async whitelistCandidate(id) {
    await db.transaction('rw', db.candidates, db.blockQueue, async () => {
      await db.candidates.update(id, { status: 'whitelisted', updatedAt: Date.now() });
      const queued = await db.blockQueue.where('userId').equals(id).toArray();
      await Promise.all(queued.map((item) => db.blockQueue.delete(item.id)));
    });
    await addLog('info', `Whitelisted candidate ${id}`, 'whitelist');
    await get().loadAll();
  },
  async markFalsePositive(id) {
    const candidate = await db.candidates.get(id);
    await db.transaction('rw', db.candidates, db.blockQueue, async () => {
      await db.candidates.update(id, {
        status: 'whitelisted',
        falsePositive: true,
        note: 'Marked as false positive',
        updatedAt: Date.now(),
      });
      const queued = await db.blockQueue.where('userId').equals(id).toArray();
      await Promise.all(queued.map((item) => db.blockQueue.delete(item.id)));
    });
    await addLog('warn', `Marked @${candidate?.username ?? id} as false positive and removed it from queue`, 'whitelist');
    await get().loadAll();
  },
  async restoreCandidate(id) {
    await db.candidates.update(id, {
      status: 'candidate',
      falsePositive: false,
      note: undefined,
      updatedAt: Date.now(),
    });
    await addLog('info', `Restored candidate ${id}`, 'whitelist');
    await get().loadAll();
  },
  async deleteCandidate(id) {
    await db.candidates.update(id, { status: 'deleted', updatedAt: Date.now() });
    await addLog('warn', `Marked candidate ${id} as deleted`, 'candidates');
    await get().loadAll();
  },
  async updateSettings(settings) {
    await db.settings.put({ ...settings, id: 'default', updatedAt: Date.now() });
    await syncBlockQueueAlarm();
    await addLog('info', 'Updated local settings', 'settings');
    await get().loadAll();
  },
  async clearLogs() {
    await db.logs.clear();
    await get().loadAll();
  },
}));
