# XShield Architecture (1.0.0)

> The pre-1.5.1 self-built architecture (workspace packages, IndexedDB, candidate
> pool, scoring) was removed when the project aligned with X(Twitter) Comment
> Blocker 1.5.1. What remains is a single extension app with a small, testable core.

## Layout

```
apps/extension/
  manifest.json            MV3: storage, unlimitedStorage, alarms, cookies, contextMenus
  public/                  bundled fallback seeds: keywords.txt, handles.txt
  src/
    background/index.ts    service worker: sync, AutoBlockManager, block API, feeders
    content/index.ts       X page scanner: detect → hide/highlight → report
    store/blockerStorage.ts storage defaults, cloud sync, name utils, logging
    dashboard/             React dashboard (5 pages) + i18n (6 locales)
    popup/                 toolbar popup (counters)
  src/__tests__/           vitest suite (30 tests) with mocked chrome APIs
```

## Runtime model

```
content script (per X tab)
  keyword/regex/community-handle detection → hide or highlight
  reportSpam(record, isAutoBlock=true)
        ↓
background service worker (single writer for history & ledger)
  recordSpam → dedupe by record id (globalSpamCache, rebuilt from history)
             → append to blockedHistory (cap 20k, per-tweet evidence)
             → enqueueBatch([user]) deduped by user (ledger/whitelist/queue)
             → eta = now + grace (30 min default, storage-configurable)
  AutoBlockManager.process (watchdog alarm, 1/min)
    pick first queue entry whose eta expired (pop-first, crash-safe)
    → whitelist/ledger chokepoint → POST blocks/create.json (screen_name)
    → success: ledger += user, blockedAt[user] = now, queue -= user
    → pacing: batch 30 → 15-min pause; interval N ± 5 s; daily cap; 429 pause
  feedCommunityHandles: shared handles.txt backlog feeds the queue in batches
  purge paths: ledger members removed at refresh/shift/ledger-write;
               whitelist changes purge via storage.onChanged;
               deleting a record cancels its user (incl. 50 ms batch race)
```

## Data (chrome.storage.local, unlimitedStorage)

| Key | Shape | Cap |
|-----|-------|-----|
| blockedHistory | per-tweet evidence records | 20 000 |
| blockedUsersOnX | ledger of blocked handles | 100 000 |
| blockedAt | handle → block timestamp | aligned with ledger |
| autoBlockQueue / autoBlockEta | pending users + per-user ready time | — |
| communityHandles / communityDismissed | shared backlog (cloud is master) / opt-outs | — |
| keywords / cloudKeywords / disabledCloudKeywords | content rules | — |
| whitelist, settings, xshieldLogs (500) | as named | — |

Cloud master data lives in the `smthdagg/XShield-keywords` repo:
`keywords.txt` (content rules, cleaned) and `handles.txt` (shared blocklist,
merge-only, permanent). Local state is a workstation cache; a fresh machine
recovers by syncing.

## Invariants

- The ledger and history are written only by the background (single writer).
- A block success never deletes trigger records (1.5.1 anti-drift).
- A blocked/whitelisted user can never be re-enqueued or re-blocked.
- Every block path funnels through handleBlockUser → markBlockedOnX.
