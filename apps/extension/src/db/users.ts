import type { BlockedUser, BlockQueueItem, CandidateUser, XUserProfile } from '@xshield/shared';
import { db } from './dexie';

const STATUS_RANK: Record<CandidateUser['status'], number> = {
  whitelisted: 6,
  blocked: 5,
  pending_block: 4,
  failed: 3,
  candidate: 2,
  deleted: 1,
};

export function normalizeUsername(username: string): string {
  return username.replace(/^@+/, '').trim();
}

export function getCanonicalUserId(profile: Pick<XUserProfile, 'id' | 'username'>): string {
  const username = normalizeUsername(profile.username || profile.id);
  return username.toLowerCase();
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    ),
  );
}

export function canonicalizeProfile<T extends XUserProfile>(profile: T): T {
  const username = normalizeUsername(profile.username || profile.id);
  const id = username.toLowerCase();
  return {
    ...profile,
    id,
    username,
    profileUrl: `https://x.com/${username}`,
  };
}

export function mergeProfiles<T extends XUserProfile>(existing: T | undefined, incoming: T): T {
  const canonicalIncoming = canonicalizeProfile(incoming);
  if (!existing) return canonicalIncoming;

  const canonicalExisting = canonicalizeProfile(existing);
  return {
    ...canonicalExisting,
    ...canonicalIncoming,
    displayName: canonicalIncoming.displayName || canonicalExisting.displayName,
    bio: canonicalIncoming.bio || canonicalExisting.bio,
    avatarUrl: canonicalIncoming.avatarUrl || canonicalExisting.avatarUrl,
    followersCount: canonicalIncoming.followersCount ?? canonicalExisting.followersCount,
    followersText: canonicalIncoming.followersText || canonicalExisting.followersText,
    postContent: uniqueStrings([
      ...(canonicalExisting.postContent ?? []),
      ...(canonicalIncoming.postContent ?? []),
    ]),
    discoveredAt: Math.min(canonicalExisting.discoveredAt, canonicalIncoming.discoveredAt),
  };
}

export function mergeCandidates(
  existing: CandidateUser | undefined,
  incoming: CandidateUser,
): CandidateUser {
  const mergedProfile = mergeProfiles(existing, incoming);
  if (!existing) return { ...incoming, ...mergedProfile };

  const existingStatusRank = STATUS_RANK[existing.status] ?? 0;
  const incomingStatusRank = STATUS_RANK[incoming.status] ?? 0;
  return {
    ...existing,
    ...incoming,
    ...mergedProfile,
    status: existingStatusRank >= incomingStatusRank ? existing.status : incoming.status,
    matchedRules: uniqueStrings([...(existing.matchedRules ?? []), ...(incoming.matchedRules ?? [])]),
    matchedFields: uniqueStrings([
      ...(existing.matchedFields ?? []),
      ...(incoming.matchedFields ?? []),
    ]) as CandidateUser['matchedFields'],
    triggerReason: uniqueStrings([existing.triggerReason, incoming.triggerReason]).join(', '),
    falsePositive: existing.falsePositive || incoming.falsePositive,
    note: existing.note || incoming.note,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}

export async function upsertDiscoveredUsers(users: XUserProfile[]): Promise<XUserProfile[]> {
  const byId = new Map<string, XUserProfile>();

  users.forEach((user) => {
    const canonical = canonicalizeProfile(user);
    byId.set(canonical.id, mergeProfiles(byId.get(canonical.id), canonical));
  });

  const merged: XUserProfile[] = [];
  for (const user of byId.values()) {
    const existing = await db.discoveredUsers.get(user.id);
    merged.push(mergeProfiles(existing, user));
  }

  if (merged.length > 0) {
    await db.discoveredUsers.bulkPut(merged);
  }

  return merged;
}

export async function upsertCandidate(candidate: CandidateUser): Promise<CandidateUser | undefined> {
  const canonical = canonicalizeProfile(candidate);
  const existing = await db.candidates.get(canonical.id);
  if (existing?.status === 'whitelisted') return undefined;

  const merged = mergeCandidates(existing, canonical);
  await db.candidates.put(merged);
  return merged;
}

function choosePrimaryCandidate(items: CandidateUser[]): CandidateUser {
  return items
    .slice()
    .sort((a, b) => {
      const statusDelta = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0);
      if (statusDelta !== 0) return statusDelta;
      return b.updatedAt - a.updatedAt;
    })[0];
}

export async function ensureCanonicalUserRecords(): Promise<void> {
  const [candidates, discoveredUsers, blockedUsers] = await Promise.all([
    db.candidates.toArray(),
    db.discoveredUsers.toArray(),
    db.blockedUsers.toArray(),
  ]);

  const candidateGroups = new Map<string, CandidateUser[]>();
  candidates.forEach((candidate) => {
    const canonicalId = getCanonicalUserId(candidate);
    candidateGroups.set(canonicalId, [...(candidateGroups.get(canonicalId) ?? []), candidate]);
  });

  await db.transaction('rw', db.candidates, db.discoveredUsers, db.blockQueue, db.blockedUsers, async () => {
    for (const [canonicalId, group] of candidateGroups) {
      if (group.length === 1 && group[0].id === canonicalId) continue;

      const primary = choosePrimaryCandidate(group);
      const merged = group.reduce<CandidateUser | undefined>(
        (current, item) => mergeCandidates(current, item),
        canonicalizeProfile(primary),
      );
      if (!merged) continue;

      await db.candidates.put({ ...merged, id: canonicalId });
      const oldIds = group.map((item) => item.id).filter((id) => id !== canonicalId);
      await Promise.all(
        oldIds.map(async (oldId) => {
          const queueItems = await db.blockQueue.where('userId').equals(oldId).toArray();
          await Promise.all(
            queueItems.map((item: BlockQueueItem) =>
              db.blockQueue.update(item.id, { userId: canonicalId, username: merged.username }),
            ),
          );
          await db.candidates.delete(oldId);
        }),
      );
    }

    const discoveredById = new Map<string, XUserProfile>();
    discoveredUsers.forEach((user) => {
      const canonical = canonicalizeProfile(user);
      discoveredById.set(canonical.id, mergeProfiles(discoveredById.get(canonical.id), canonical));
    });
    await db.discoveredUsers.clear();
    if (discoveredById.size > 0) await db.discoveredUsers.bulkPut(Array.from(discoveredById.values()));

    const blockedById = new Map<string, BlockedUser>();
    blockedUsers.forEach((user) => {
      const canonical = canonicalizeProfile(user);
      const existing = blockedById.get(canonical.id);
      blockedById.set(canonical.id, {
        ...mergeProfiles(existing, canonical),
        blockedAt: Math.max(existing?.blockedAt ?? 0, canonical.blockedAt),
        sourceQueueItemId: canonical.sourceQueueItemId || existing?.sourceQueueItemId,
        score: canonical.score ?? existing?.score,
        matchedRules: uniqueStrings([...(existing?.matchedRules ?? []), ...(canonical.matchedRules ?? [])]),
        triggerReason: uniqueStrings([existing?.triggerReason, canonical.triggerReason]).join(', '),
      });
    });
    await db.blockedUsers.clear();
    if (blockedById.size > 0) await db.blockedUsers.bulkPut(Array.from(blockedById.values()));
  });
}
