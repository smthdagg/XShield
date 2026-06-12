import { evaluateUser } from '@xshield/rule-engine';
import { DEFAULT_SCORE_THRESHOLD } from '@xshield/shared';
import type { CandidateUser, XUserProfile } from '@xshield/shared';
import { db } from '../db/dexie';
import { addLog } from '../db/logs';
import { seedDefaults } from '../db/seed';
import {
  canonicalizeProfile,
  ensureCanonicalUserRecords,
  upsertCandidate,
  upsertDiscoveredUsers,
} from '../db/users';
import { BLOCK_QUEUE_ALARM, runBlockQueueBatch, syncBlockQueueAlarm } from '../store/queueRunner';
import type { QueueRunResult, RuntimeMessage } from '../types';

async function upsertCandidates(users: XUserProfile[]): Promise<CandidateUser[]> {
  await seedDefaults();
  await ensureCanonicalUserRecords();
  const canonicalUsers = await upsertDiscoveredUsers(users.map(canonicalizeProfile));
  if (canonicalUsers.length > 0) {
    await addLog('info', `Scanned ${canonicalUsers.length} visible X user(s)`, 'content-script');
  }

  const settings = await db.settings.get('default');
  if (!settings?.rulesRunning || settings.ruleExecutionMode !== 'automatic') return [];

  const threshold = settings?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const rules = (await db.rules.toArray()).filter((rule) => rule.enabled);
  const now = Date.now();
  const candidates: CandidateUser[] = [];

  for (const user of canonicalUsers) {
    const result = evaluateUser(user, rules, threshold);
    if (!result.matched) continue;

    const existing = await db.candidates.get(user.id);
    if (existing?.status === 'whitelisted') continue;
    if (await db.blockedUsers.get(user.id)) continue;

    const candidate = await upsertCandidate({
      ...user,
      score: result.score,
      status: existing?.status ?? 'candidate',
      matchedRules: result.matchedRules,
      matchedFields: result.matchedFields,
      triggerReason: result.matchedRules.join(', '),
      note: existing?.note,
      updatedAt: now,
    });
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length > 0) {
    await addLog(
      'info',
      `Triggered ${candidates.length} candidate user(s): ${candidates
        .slice(0, 5)
        .map((candidate) => `@${candidate.username}`)
        .join(', ')}`,
      'content-script',
    );
  }

  return candidates;
}

chrome.runtime.onInstalled.addListener(() => {
  void seedDefaults().then(syncBlockQueueAlarm);
});

chrome.runtime.onStartup.addListener(() => {
  void syncBlockQueueAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BLOCK_QUEUE_ALARM) return;
  void runBlockQueueBatch();
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage<XUserProfile[]>, _sender, sendResponse) => {
  if (message?.source !== 'xshield') return;

  if (message.type === 'VISIBLE_USERS_COLLECTED') {
    void upsertCandidates(message.payload ?? []).then((candidates) => {
      sendResponse({
        usernames: candidates.map((candidate) => candidate.username),
      });
    });
    return true;
  }

  if (message.type === 'RUN_BLOCK_QUEUE') {
    void runBlockQueueBatch({ force: true }).then((result: QueueRunResult) => sendResponse(result));
    return true;
  }

  if (message.type === 'SYNC_BLOCK_QUEUE_ALARM') {
    void syncBlockQueueAlarm().then(() => sendResponse({ success: true }));
    return true;
  }

  return false;
});
