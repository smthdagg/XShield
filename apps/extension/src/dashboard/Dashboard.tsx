/**
 * XShield dashboard — five pages:
 *   1. Triggered users (nickname / @handle / reply text; remove, whitelist,
 *      block one, select-all block)
 *   2. Blocked log (blocked users + pending queue + today counter)
 *   3. Whitelist
 *   4. Rules & sync (cloud + custom keywords; cloud syncs down, local is
 *      user-owned: add / edit / delete)
 *   5. Script settings (master, hide/highlight mode, filters, language)
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  ListChecks,
  Pencil,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DEFAULT_CLOUD_OWNER_REPO,
  extractCleanScreenName,
  isKeywordRegex,
  parseKeywords,
  pruneLogs,
  exportLogs,
  type XLogEntry,
} from '../store/blockerStorage';
import { dashboardCopy, getLanguage } from './i18n';

type ViewId = 'triggered' | 'blockedLog' | 'whitelist' | 'rules' | 'logs' | 'settings';

interface SpamRecord {
  id: string;
  text: string;
  user: string;
  displayName: string;
  reason: string;
  time: number;
  isAutoBlock: boolean;
}

const DEFAULTS: Record<string, unknown> = {
  enabled: true,
  highlightMode: false,
  blockedCount: 0,
  blockedHistory: [] as SpamRecord[],
  cloudKeywords: '',
  keywords: '',
  disabledCloudKeywords: [] as string[],
  whitelist: [] as string[],
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  blockGrok: false,
  cloudEnabled: true,
  shareEnabled: true,
  cloudOwnerRepo: '',
  autoBlockQueue: [] as string[],
  autoBlockEta: {} as Record<string, number>,
  queueInfo: {} as Record<string, { displayName?: string; text?: string }>,
  autoBlockToday: 0,
  autoBlockPausedUntil: 0,
  communityHandles: [] as string[],
  communityDismissed: [] as string[],
  githubToken: '',
  autoBlockDailyLimit: 300,
  autoBlockBatchLimit: 30,
  autoBlockDelaySeconds: 5,
  blockedUsersOnX: [] as string[],
  blockedAt: {} as Record<string, number>,
  lastSyncTime: 0,
  syncStatus: '',
  syncError: '',
  language: 'system' as string,
  xshieldLogs: [] as XLogEntry[],
};

function DataPanel({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="data-panel">
      <header className="panel-header">
        <h2>{title}</h2>
        {meta && <span className="panel-meta">{meta}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle-switch${checked ? ' on' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function KeywordTag({
  keyword,
  isAutoBlock,
  disabled,
  showCheckbox,
  checked,
  onToggleCheck,
  onDelete,
}: {
  keyword: string;
  isAutoBlock?: boolean;
  disabled?: boolean;
  showCheckbox?: boolean;
  checked?: boolean;
  onToggleCheck?: () => void;
  onDelete?: () => void;
}) {
  return (
    <span
      className={`keyword-tag${isKeywordRegex(keyword) ? ' regex-tag' : ''}${isAutoBlock ? ' is-autoblock' : ''}${
        disabled ? ' is-disabled' : ''
      }`}
    >
      {showCheckbox && onToggleCheck && (
        <input type="checkbox" checked={Boolean(checked)} onChange={onToggleCheck} />
      )}
      <span className="keyword-text" title={keyword}>
        {keyword}
      </span>
      {onDelete && (
        <button type="button" className="tag-action" title="remove" onClick={onDelete}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function send(message: Record<string, unknown>): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

const VIEW_IDS: ViewId[] = ['triggered', 'blockedLog', 'whitelist', 'rules', 'logs', 'settings'];
const LAST_VIEW_KEY = 'xshieldLastView';

export interface BlockedEntry { name: string; at: number }

/** Pure filter+pagination for the blocked-users database view (exported for tests). */
export function filterAndPageBlocked(
  entries: BlockedEntry[],
  query: string,
  page: number,
  pageSize: number,
  browseLimit: number,
  displayNames: Record<string, string>,
): { items: BlockedEntry[]; total: number; pages: number } {
  const q = query.trim().toLowerCase();
  const matched = q
    ? entries.filter(
        (entry) =>
          entry.name.toLowerCase().includes(q) ||
          (displayNames[entry.name] ?? '').toLowerCase().includes(q),
      )
    : entries.slice(0, browseLimit);
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const current = Math.min(Math.max(0, page), pages - 1);
  return {
    items: matched.slice(current * pageSize, current * pageSize + pageSize),
    total: matched.length,
    pages,
  };
}

export default function Dashboard() {
  const [state, setState] = useState<Record<string, unknown>>(() => ({ ...DEFAULTS }));
  const [view, setView] = useState<ViewId>('triggered');
  const [status, setStatus] = useState('');
  const [syncingRules, setSyncingRules] = useState(false);
  const [syncingHandles, setSyncingHandles] = useState(false);

  const language = getLanguage(String(state.language ?? 'system'));
  const t = dashboardCopy[language];

  useEffect(() => {
    void chrome.storage.local.get(DEFAULTS).then((items) => {
      setState((current) => ({ ...current, ...items }));
    });
    // Restore the last visited page so refreshes never jump elsewhere.
    void chrome.storage.local.get({ [LAST_VIEW_KEY]: '' }).then((saved) => {
      const value = saved[LAST_VIEW_KEY] as string;
      if (VIEW_IDS.includes(value as ViewId)) setView(value as ViewId);
    });
  }, []);

  useEffect(() => {
    void chrome.storage.local.set({ [LAST_VIEW_KEY]: view });
  }, [view]);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      setState((current) => {
        const next = { ...current };
        for (const key of Object.keys(DEFAULTS)) {
          if (changes[key]?.newValue !== undefined) {
            next[key] = changes[key].newValue;
          }
        }
        return next;
      });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const setValue = (key: string, value: unknown): void => {
    void chrome.storage.local.set({ [key]: value });
  };

  const blockedHistory = useMemo(() => (state.blockedHistory as SpamRecord[]) ?? [], [state.blockedHistory]);
  const autoBlockQueue = useMemo(() => (state.autoBlockQueue as string[]) ?? [], [state.autoBlockQueue]);
  const blockedUsersOnX = useMemo(() => (state.blockedUsersOnX as string[]) ?? [], [state.blockedUsersOnX]);
  // Queue entries that duplicate the ledger can never be re-blocked — show
  // them as pending-delete duplicates, separate from the real pending queue.
  // (The background also auto-purges them, so this section is best-effort.)
  const dupQueueNames = useMemo(
    () => autoBlockQueue.filter((name) => blockedUsersOnX.includes(name)),
    [autoBlockQueue, blockedUsersOnX],
  );
  // Display-side ledger filter: a blocked user must never render as "pending".
  const pendingQueue = useMemo(
    () => autoBlockQueue.filter((name) => !blockedUsersOnX.includes(name)),
    [autoBlockQueue, blockedUsersOnX],
  );
  const whitelist = useMemo(() => (state.whitelist as string[]) ?? [], [state.whitelist]);
  const cloudKeywords = useMemo(() => parseKeywords(String(state.cloudKeywords ?? '')), [state.cloudKeywords]);
  // Rules and blacklist share one repo source (mirrors the settings hint).
  const cloudRepo = String(state.cloudOwnerRepo ?? '').trim() || DEFAULT_CLOUD_OWNER_REPO;
  const customKeywords = useMemo(() => parseKeywords(String(state.keywords ?? '')), [state.keywords]);

  // ---- actions ----
  const triggerSyncRules = (): void => {
    setSyncingRules(true);
    void send({ action: 'syncRules' })
      .then((res) => setStatus((res as { success?: boolean })?.success ? t.syncOk : t.syncFailed))
      .catch(() => setStatus(t.syncFailed))
      .finally(() => setSyncingRules(false));
  };

  const triggerSyncHandles = (): void => {
    setSyncingHandles(true);
    void send({ action: 'syncHandles' })
      .then((res) => setStatus((res as { success?: boolean })?.success ? t.syncBlacklistOk : t.syncBlacklistFail))
      .catch(() => setStatus(t.syncBlacklistFail))
      .finally(() => setSyncingHandles(false));
  };

  const blockOne = (handle: string): void => {
    const clean = extractCleanScreenName(handle);
    if (!clean) return;
    if (blockedUsersOnX.includes(clean)) {
      setStatus(t.alreadyBlockedHint);
      return;
    }
    // No optimistic writes here: the background is the single writer for the
    // ledger. On success it merges the user into `blockedUsersOnX`; trigger
    // records stay (1.5.1 model), so what the UI shows always matches what
    // actually happened on X.
    setStatus(`正在拉黑 @${clean}…`);
    void send({ action: 'blockUserOnX', screenName: clean }).then((res) => {
      const result = res as { success?: boolean; reason?: string };
      setStatus(result?.success ? `已拉黑 @${clean}` : result?.reason ?? '拉黑失败');
    });
  };

  /** Undo a mistaken block: unblock on X and add to the whitelist. */
  const restoreToWhitelist = (handle: string): void => {
    void send({ action: 'unblockUserOnX', screenName: handle }).then((res) => {
      const result = res as { success?: boolean; reason?: string };
      if (result?.success) {
        setValue('whitelist', Array.from(new Set([...whitelist, handle])));
        setStatus(`@${handle} ${t.restoredNote}`);
      } else {
        setStatus(result?.reason ?? t.unblockFail);
      }
    });
  };

  const unblockOne = (handle: string): void => {
    void send({ action: 'unblockUserOnX', screenName: handle }).then((res) => {
      const result = res as { success?: boolean; reason?: string };
      setStatus(result?.success ? `已解除拉黑 @${handle}` : result?.reason ?? '操作失败');
    });
  };

  const blockSelected = (names: string[]): void => {
    if (names.length === 0) return;
    // One direct confirmation dialog instead of the old double-click-in-3s
    // pattern (which silently reset and looked like "nothing happened").
    if (!window.confirm(t.confirmBlockAllNote.replace('{count}', String(names.length)))) return;
    const queuedNamesSet = new Set(names);
    void send({ action: 'blockAllHistoryUsers', users: names }).then(() => {
      // Card info for the queue page.
      const info = { ...((state.queueInfo as Record<string, { displayName?: string; text?: string }>) ?? {}) };
      for (const record of selectedRecords) {
        const name = extractCleanScreenName(record.user ?? '');
        if (name && queuedNamesSet.has(name)) {
          info[name] = { displayName: record.displayName, text: record.text };
        }
      }
      setValue('queueInfo', info);
      // Records stay in storage after enqueueing (1.5.1 model). The rows
      // leave this working list as soon as the queue write lands (排队中
      // filter); the ledger moves them to 已拉黑 as each block succeeds.
      setStatus(
        `${t.queuedNote.replace('{count}', String(names.length))} · ${t.autoBlockToday}: ${String(state.autoBlockToday ?? 0)}/${String(state.autoBlockDailyLimit ?? 300)}`,
      );
      setSelectedIds([]);
    });
  };

  const removeRecord = (id: string, time: number): void => {
    void send({ action: 'removeSpamRecord', id, time });
  };

  /** Bulk-delete the selected trigger records (toolbar 全选 → 删除). */
  const deleteSelected = (): void => {
    if (selectedRecords.length === 0) return;
    const ids = selectedRecords.map((r) => ({ id: r.id, time: r.time }));
    void send({ action: 'bulkRemoveRecords', ids }).then((res) => {
      const removed = (res as { removed?: number })?.removed ?? ids.length;
      setStatus(t.deletedSelected.replace('{count}', String(removed)));
    });
    setSelectedIds([]);
  };

  /** One-shot purge of every synthetic 社区共享 record (multi-thousand backlog). */
  const cleanCommunityRecords = (): void => {
    if (communityRecordCount === 0) return;
    if (!window.confirm(t.cleanCommunityConfirm.replace('{count}', String(communityRecordCount)))) return;
    void send({ action: 'bulkRemoveRecords', scope: 'community' }).then((res) => {
      const removed = (res as { removed?: number })?.removed ?? communityRecordCount;
      setStatus(t.cleanCommunityDone.replace('{count}', String(removed)));
    });
  };

  /** Drop queue entries that duplicate the block ledger (can't be re-blocked). */
  const deleteDupeQueue = (): void => {
    if (dupQueueNames.length === 0) return;
    void send({ action: 'removeFromQueue', names: dupQueueNames }).then(() => {
      setStatus(t.dupQueueDeleted.replace('{count}', String(dupQueueNames.length)));
    });
  };

  /**
   * Cancel one pending entry completely: wipe all of its trigger records
   * (so the history backfill can never re-add it) and drop the queue slot.
   */
  const removeQueueName = (name: string): void => {
    const records = ((state.blockedHistory as SpamRecord[]) ?? []).filter(
      (r) => extractCleanScreenName(r.user ?? '') === name,
    );
    for (const r of records) void send({ action: 'removeSpamRecord', id: r.id, time: r.time });
    void send({ action: 'removeFromQueue', names: [name] });
    setStatus(`@${name} → ${t.remove}`);
  };

  const addWhitelistFromRecord = (handle: string): void => {
    const clean = extractCleanScreenName(handle);
    if (!clean) return;
    setValue('whitelist', Array.from(new Set([...whitelist, clean])));
    setStatus(`@${clean} → ${t.whitelist}`);
  };

  const addWhitelist = (): void => {
    const input = (document.getElementById('whitelist-input') as HTMLInputElement | null)?.value ?? '';
    const clean = extractCleanScreenName(input);
    if (!clean) return;
    setValue('whitelist', Array.from(new Set([...whitelist, clean])));
    const el = document.getElementById('whitelist-input') as HTMLInputElement | null;
    if (el) el.value = '';
  };

  // keyword actions
  const addKeyword = (): void => {
    const input = (document.getElementById('new-keyword') as HTMLInputElement | null)?.value ?? '';
    const parsed = parseKeywords(input);
    if (parsed.length === 0) return;
    setValue('keywords', Array.from(new Set([...customKeywords, ...parsed])).join('\n'));
    const el = document.getElementById('new-keyword') as HTMLInputElement | null;
    if (el) el.value = '';
  };

  const saveEditedKeyword = (): void => {
    if (!editingKeyword) return;
    const value = editingKeyword.value.trim();
    const next = customKeywords
      .map((k) => (k === editingKeyword.old ? value : k))
      .filter((k) => k.length > 0);
    setValue('keywords', Array.from(new Set(next)).join('\n'));
    setEditingKeyword(null);
  };

  const deleteKeyword = (keyword: string): void => {
    setValue('keywords', customKeywords.filter((k) => k !== keyword).join('\n'));
  };

  const toggleDisabledCloud = (keyword: string, disable: boolean): void => {
    const next = new Set((state.disabledCloudKeywords as string[]) ?? []);
    if (disable) next.add(keyword);
    else next.delete(keyword);
    setValue('disabledCloudKeywords', Array.from(next));
  };

  /** Owner action: publish the panel's library view to the project keywords.txt. */
  const shareKeywords = (): void => {
    setSyncingRules(true);
    void send({ action: 'shareKeywords' })
      .then((res) => {
        const result = res as { success?: boolean; detail?: string; reason?: string };
        setStatus(result?.success ? result.detail ?? t.shareKeywordsDone : result?.reason || t.shareKeywordsFail);
      })
      .catch(() => setStatus(t.shareKeywordsFail))
      .finally(() => setSyncingRules(false));
  };

  /** Owner/contributor action: push the local block ledger to the project. */
  const shareHandles = (): void => {
    setSyncingHandles(true);
    void send({ action: 'shareHandles' })
      .then((res) => {
        const result = res as { success?: boolean; detail?: string; reason?: string };
        setStatus(result?.success ? result.detail ?? t.shareDone : result?.reason || t.shareFail);
      })
      .catch(() => setStatus(t.shareFail))
      .finally(() => setSyncingHandles(false));
  };

  /** One-click environment snapshot: real storage state + recent logs. */
  const exportDiagnostics = (): void => {
    const diag = {
      exportedAt: new Date().toISOString(),
      version: chrome.runtime.getManifest().version,
      counts: {
        cloudKeywords: cloudKeywords.length,
        customKeywords: customKeywords.length,
        whitelist: whitelist.length,
        blockedHistory: blockedHistory.length,
        blockedUsers: blockedUsersOnX.length,
        communityHandles: ((state.communityHandles as string[]) ?? []).length,
        communityDismissed: ((state.communityDismissed as string[]) ?? []).length,
        pendingQueue: pendingQueue.length,
        autoBlockToday: Number(state.autoBlockToday ?? 0),
        pausedUntil: Number(state.autoBlockPausedUntil ?? 0),
      },
      settings: {
        enabled: Boolean(state.enabled),
        highlightMode: Boolean(state.highlightMode),
        checkUsername: Boolean(state.checkUsername),
        onlyComments: Boolean(state.onlyComments),
        blockEmoji: Boolean(state.blockEmoji),
        blockSpecialChars: Boolean(state.blockSpecialChars),
        blockGrok: Boolean(state.blockGrok),
        cloudEnabled: Boolean(state.cloudEnabled),
        cloudOwnerRepo: String(state.cloudOwnerRepo ?? ''),
        language: String(state.language ?? 'system'),
      },
      sync: {
        lastSyncTime: Number(state.lastSyncTime ?? 0),
        syncStatus: String(state.syncStatus ?? ''),
        syncError: String(state.syncError ?? ''),
      },
      pendingQueue,
      eta: state.autoBlockEta ?? {},
      logs: logs.slice(0, 100),
    };
    const blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xshield-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(t.diagDone);
  };

  const exportKeywords = (): void => {
    const blob = new Blob([String(state.keywords ?? '')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xshield-keywords.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importKeywords = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        let parsed = parseKeywords(text);
        if (parsed.length === 0) {
          try {
            parsed = parseKeywords((JSON.parse(text) as { keywords?: string }).keywords ?? '');
          } catch {
            // keep empty
          }
        }
        if (parsed.length > 0) setValue('keywords', Array.from(new Set([...customKeywords, ...parsed])).join('\n'));
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // logs page state
  const logs = (state.xshieldLogs as XLogEntry[]) ?? [];
  // Inline audit trail for the settings "sync & share" section (≤500 items).
  const syncLogs = logs.filter((entry) => entry.category === 'sync').slice(0, 5);
  const [logLevel, setLogLevel] = useState('all');
  const [logCategory, setLogCategory] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const [logPage, setLogPage] = useState(0);
  const LOG_PAGE_SIZE = 50;
  const logLevels = ['all', 'info', 'warn', 'error'];
  const logCategories = ['all', 'block', 'sync', 'trigger', 'settings', 'system'];
  const filteredLogs = logs.filter((entry) => {
    if (logLevel !== 'all' && entry.level !== logLevel) return false;
    if (logCategory !== 'all' && entry.category !== logCategory) return false;
    if (logQuery && !entry.message.toLowerCase().includes(logQuery.toLowerCase())) return false;
    return true;
  });

  // rules page state
  const [cloudQuery, setCloudQuery] = useState('');
  const [editingKeyword, setEditingKeyword] = useState<{ old: string; value: string } | null>(null);
  const [blockedQuery, setBlockedQuery] = useState('');
  const [blockedPage, setBlockedPage] = useState(0);
  const [queueFilter, setQueueFilter] = useState('all');
  const [queuePage, setQueuePage] = useState(0);
  const [showToken, setShowToken] = useState(false);
  const visibleCloudKeywords = cloudKeywords.filter((k) => (cloudQuery ? k.includes(cloudQuery.toLowerCase()) : true));

  // triggered page state
  const [triggerQuery, setTriggerQuery] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // `__blocked_on_x__` / `__queued_on_x__` are 1.5.1 pseudo-reasons driven by
  // the ledger and the auto-block queue instead of the record's own reason.
  const BLOCKED_FILTER = '__blocked_on_x__';
  const triggerReasons = ['all', '内容屏蔽', '昵称屏蔽', '表情屏蔽', '特殊字符屏蔽', 'Grok屏蔽', BLOCKED_FILTER];
  // 触发记录 = every record whose user is not blocked yet (queued ones stay
  // here, marked 排队中, with their action buttons); a successful block moves
  // the row into the 已拉黑 filter. Records stay in storage (1.5.1: blocks
  // never delete history).
  const filterLabel = (reason: string): string =>
    reason === BLOCKED_FILTER ? '已拉黑' : reason === 'all' ? '未拉黑' : reason;

  const whitelistMembers = new Set(whitelist);
  const filteredHistory = blockedHistory.filter((item) => {
    const handle = extractCleanScreenName(item.user ?? '');
    const isBlocked = Boolean(handle) && blockedUsersOnX.includes(handle);
    // Whitelisted users count as handled: their records leave the working
    // list (this is what makes the 白名单 click visibly react).
    const isWhitelisted = Boolean(handle) && whitelistMembers.has(handle);
    if (triggerFilter === BLOCKED_FILTER) {
      if (!isBlocked) return false;
    } else if (isBlocked || isWhitelisted) {
      return false;
    } else if (triggerFilter !== 'all') {
      if (item.reason !== triggerFilter) return false;
    }
    if (triggerQuery && !`${item.user} ${item.text} ${item.displayName}`.toLowerCase().includes(triggerQuery.toLowerCase())) {
      return false;
    }
    return true;
  });
  const selectedRecords = filteredHistory.filter((item) => selectedIds.includes(`${item.id}:${item.time}`));
  // Synthetic 社区共享 records accumulate from past feeding rounds (the
  // multi-thousand backlog) — they carry no real signal, just visibility.
  const communityRecordCount = useMemo(
    () =>
      ((state.blockedHistory as SpamRecord[]) ?? []).filter((r) =>
        String(r.id ?? '').startsWith('community:'),
      ).length,
    [state.blockedHistory],
  );
  // True when the working list is empty because every record's user is
  // already blocked (they live under the 已拉黑 filter now).
  const allRecordsBlocked = blockedHistory.length > 0 && blockedHistory.every((item) => {
    const handle = extractCleanScreenName(item.user ?? '');
    return Boolean(handle) && blockedUsersOnX.includes(handle);
  });
  const selectedNames = Array.from(
    new Set(selectedRecords.map((item) => extractCleanScreenName(item.user ?? '')).filter(Boolean)),
  );

  // Blocked-users "database view": newest first, browse limited to the most
  // recent slice; anything older must be found via search. 100 per page.
  const BLOCKED_BROWSE_LIMIT = 300;
  const BLOCKED_PAGE_SIZE = 100;
  const blockedAtMap = (state.blockedAt as Record<string, number>) ?? {};
  const blockedWithTime = blockedUsersOnX
    .map((name) => ({ name, at: blockedAtMap[name] ?? 0 }))
    .sort((a, b) => b.at - a.at);
  // No search: browse only the newest slice; searching looks at everything.
  const queueInfoMap = (state.queueInfo as Record<string, { displayName?: string; text?: string }>) ?? {};
  const displayNames: Record<string, string> = {};
  for (const [key, value] of Object.entries(queueInfoMap)) displayNames[key] = value.displayName ?? '';
  const { items: blockedPageItems, total: matchedBlockedCount, pages: totalBlockedPages } =
    filterAndPageBlocked(blockedWithTime, blockedQuery, blockedPage, BLOCKED_PAGE_SIZE, BLOCKED_BROWSE_LIMIT, displayNames);

  // Pending-queue classification: a queued handle is 社区共享 when it comes
// from the synced community blacklist (communityHandles — the authoritative
// server list, kept clean locally). History records are only a fallback:
// they can be truncated (20k cap) or deleted, which would silently mislabel
// entries as 正常触发. 100 per page — the queue routinely holds thousands.
  const QUEUE_PAGE_SIZE = 100;
  const communityQueuedSet = useMemo(() => {
    const set = new Set(((state.communityHandles as string[]) ?? []).map(extractCleanScreenName).filter(Boolean));
    for (const r of (state.blockedHistory as SpamRecord[]) ?? []) {
      if (String(r.id ?? '').startsWith('community:')) {
        const handle = extractCleanScreenName(r.user ?? '');
        if (handle) set.add(handle);
      }
    }
    return set;
  }, [state.communityHandles, state.blockedHistory]);
  const filteredQueueNames = useMemo(() => {
    if (queueFilter === 'community') return pendingQueue.filter((name) => communityQueuedSet.has(name));
    if (queueFilter === 'trigger') return pendingQueue.filter((name) => !communityQueuedSet.has(name));
    return pendingQueue;
  }, [pendingQueue, queueFilter, communityQueuedSet]);
  const queuePageItems = filteredQueueNames.slice(
    queuePage * QUEUE_PAGE_SIZE,
    queuePage * QUEUE_PAGE_SIZE + QUEUE_PAGE_SIZE,
  );
  const totalQueuePages = Math.max(1, Math.ceil(filteredQueueNames.length / QUEUE_PAGE_SIZE));

  // Daily blocked counts for the last 7 days (from the blockedAt ledger).
  const dailyBlocked = (() => {
    const days: Array<{ key: string; count: number }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ key: `${d.getMonth() + 1}-${d.getDate()}`, count: 0 });
    }
    const index = new Map(days.map((d) => [d.key, d]));
    for (const ts of Object.values(blockedAtMap)) {
      if (!ts) continue;
      const d = new Date(ts);
      const bucket = index.get(`${d.getMonth() + 1}-${d.getDate()}`);
      if (bucket) bucket.count++;
    }
    return days;
  })();

  const navItems: Array<{ id: ViewId; label: string; icon: ReactNode }> = [
    { id: 'triggered', label: t.triggered, icon: <ListChecks size={18} /> },
    { id: 'blockedLog', label: t.blockedLog, icon: <ShieldCheck size={18} /> },
    { id: 'whitelist', label: t.whitelist, icon: <CheckCircle2 size={18} /> },
    { id: 'rules', label: t.rulesSync, icon: <ScrollText size={18} /> },
    { id: 'settings', label: t.settings, icon: <SettingsIcon size={18} /> },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={chrome.runtime.getURL('icons/xshield-logo.svg')} alt="" />
          <span>XShield</span>
          <span className={`status-dot${state.enabled ? ' on' : ''}`} />
          <span className="version-badge">v{chrome.runtime.getManifest().version}</span>
        </div>
        <nav className="nav-list" aria-label="Sections">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              type="button"
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.appSubtitle}</p>
            <h1>{navItems.find((item) => item.id === view)?.label ?? ''}</h1>
          </div>
          {status && <span className="toolbar-status status-flash">{status}</span>}
        </header>

        {view === 'triggered' && (
          <DataPanel title={t.triggered} meta={`${selectedRecords.length} / ${filteredHistory.length}`}>
            <div className="toolbar">
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={filteredHistory.length > 0 && selectedIds.length === filteredHistory.length}
                  onChange={(event) =>
                    setSelectedIds(
                      event.currentTarget.checked
                        ? filteredHistory.map((item) => `${item.id}:${item.time}`)
                        : [],
                    )
                  }
                />
                {t.selectAll}
              </label>
              <input
                placeholder={t.search}
                value={triggerQuery}
                onChange={(e) => {
                  setTriggerQuery(e.currentTarget.value);
                  setSelectedIds([]);
                }}
              />
              <select value={triggerFilter} onChange={(e) => { setTriggerFilter(e.currentTarget.value); setSelectedIds([]); }}>
                {triggerReasons.map((reason) => (
                  <option key={reason} value={reason}>{filterLabel(reason)}</option>
                ))}
              </select>
              <button
                className="solid-button danger"
                type="button"
                disabled={selectedNames.length === 0}
                onClick={() => blockSelected(selectedNames)}
              >
                <Ban size={16} />
                {`${t.blockAll}(${selectedNames.length})`}
              </button>
              <button
                className="plain-button danger"
                type="button"
                disabled={selectedNames.length === 0}
                onClick={deleteSelected}
              >
                <Trash2 size={16} />
                {`${t.deleteSelected}(${selectedNames.length})`}
              </button>
              {communityRecordCount > 0 && (
                <button
                  className="plain-button danger"
                  type="button"
                  onClick={cleanCommunityRecords}
                  title={t.cleanCommunityTitle}
                >
                  <Trash2 size={16} />
                  {t.cleanCommunity.replace('{count}', String(communityRecordCount))}
                </button>
              )}
            </div>
            <p className="hint">{t.blockHere}</p>
            <p className="hint">{t.recordsScopeNote.replace('{count}', String(pendingQueue.length))}</p>
            <div className="form-grid inline">
              <label>
                <span>{t.dailyLimitLabel}</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={String(state.autoBlockDailyLimit ?? 300)}
                  onChange={(e) => setValue('autoBlockDailyLimit', Math.max(1, Number(e.currentTarget.value) || 300))}
                />
              </label>
              <label>
                <span>{t.batchLimitLabel}</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={String(state.autoBlockBatchLimit ?? 30)}
                  onChange={(e) => setValue('autoBlockBatchLimit', Math.max(1, Number(e.currentTarget.value) || 30))}
                />
              </label>
              <label>
                <span>{t.delaySecondsLabel}</span>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={String(state.autoBlockDelaySeconds ?? 5)}
                  onChange={(e) => setValue('autoBlockDelaySeconds', Math.max(0, Number(e.currentTarget.value) || 0))}
                />
              </label>
            </div>
            <p className="hint">{t.autoBlockNote}</p>
            <div className="card-grid">
              {filteredHistory.map((item) => {
                const handle = extractCleanScreenName(item.user ?? '');
                const key = `${item.id}:${item.time}`;
                const isBlocked = handle ? blockedUsersOnX.includes(handle) : false;
                const isQueued = !isBlocked && Boolean(handle) && autoBlockQueue.includes(handle);
                // Same handle queued AND blocked: it can't be blocked again,
                // so it is a duplicate pending deletion, not a pending block.
                const isDupQueue = isBlocked && Boolean(handle) && autoBlockQueue.includes(handle);
                return (
                  <div className="profile-card trigger-card" key={key}>
                    <label className="check-inline card-check">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(key)}
                        onChange={(e) =>
                          setSelectedIds((current) =>
                            e.currentTarget.checked ? [...current, key] : current.filter((id) => id !== key),
                          )
                        }
                      />
                    </label>
                    <div
                      className="profile-card-head"
                      role="button"
                      tabIndex={0}
                      onClick={() => handle && window.open(`https://x.com/${handle}`, '_blank')}
                    >
                      <span className="history-display">{item.displayName || item.user || 'unknown'}</span>
                      {handle && <span className="history-handle">@{handle}</span>}
                      {isQueued && <span className="queue-badge">{t.queuedBadge}</span>}
                      {isDupQueue && <span className="queue-badge dup">{t.dupQueueBadge}</span>}
                      <span className="history-reason">{item.reason ? `[${item.reason}]` : ''}</span>
                      <small>{formatTime(item.time)}</small>
                      <ExternalLink size={13} className="profile-card-open" />
                    </div>
                    {item.text ? <p className="profile-card-text">{item.text}</p> : null}
                    <span className="row-actions profile-card-actions">
                      {handle && (
                        <button
                          type="button"
                          className={isBlocked ? 'btn-block-x success' : 'btn-block-x'}
                          onClick={() => blockOne(handle)}
                        >
                          {isBlocked ? t.blocked : t.block}
                        </button>
                      )}
                      {handle && (
                        <button
                          type="button"
                          className="btn-whitelist"
                          title={isBlocked ? t.restoreWhitelist : t.whitelist}
                          onClick={() => (isBlocked ? restoreToWhitelist(handle) : addWhitelistFromRecord(handle))}
                        >
                          {isBlocked ? t.restoreWhitelist : t.whitelist}
                        </button>
                      )}
                      <button type="button" title={t.remove} onClick={() => removeRecord(item.id, item.time)}>
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </div>
                );
              })}
              {filteredHistory.length === 0 &&
                (allRecordsBlocked && triggerFilter !== BLOCKED_FILTER ? (
                  <p className="empty-state">全部已拉黑：记录在「已拉黑」筛选里可见。</p>
                ) : (
                  <p className="empty-state">{t.historyEmpty}</p>
                ))}
            </div>
          </DataPanel>
        )}

        {view === 'blockedLog' && (
          <div className="stack">
            <DataPanel
              title={t.blockedLog}
              meta={`${t.autoBlockToday}: ${String(state.autoBlockToday ?? 0)} · ${t.queueRemaining}: ${pendingQueue.length}${
                Number(state.autoBlockPausedUntil ?? 0) > Date.now() ? ` · ${t.paused}` : ''
              }`}
            >
              <div className="metric-grid small">
                <article className="metric-card">
                  <span>{t.autoBlockToday}</span>
                  <strong>{String(state.autoBlockToday ?? 0)}</strong>
                </article>
                <article className="metric-card">
                  <span>{t.queueRemaining}</span>
                  <strong>{pendingQueue.length}</strong>
                </article>
                <article className="metric-card">
                  <span>{t.blockedUsers}</span>
                  <strong>{blockedUsersOnX.length}</strong>
                </article>
              </div>
              <p className="hint">
                {t.dailyBlockedLabel}：{dailyBlocked.map((d) => `${d.key} · ${d.count}`).join('　')}
              </p>
              {dupQueueNames.length > 0 && (
                <div className="form-grid inline">
                  <span className="toolbar-status">{t.dupQueueLabel}：{dupQueueNames.length}</span>
                  <button className="plain-button danger" type="button" onClick={deleteDupeQueue}>
                    <Trash2 size={16} /> {t.deleteDupQueue}
                  </button>
                </div>
              )}
              <p className="settings-subtitle">{t.queueTitle}（{t.queueRemaining} {pendingQueue.length}）</p>
              <div className="form-grid inline">
                <select
                  value={queueFilter}
                  onChange={(e) => { setQueueFilter(e.currentTarget.value); setQueuePage(0); }}
                >
                  <option value="all">{t.queueFilterAll}</option>
                  <option value="community">{t.queueFilterCommunity}</option>
                  <option value="trigger">{t.queueFilterTrigger}</option>
                </select>
                <span className="toolbar-status">{filteredQueueNames.length} 条</span>
              </div>
              <div className="card-grid">
                {queuePageItems.map((name) => {
                  const info = ((state.queueInfo as Record<string, { displayName?: string; text?: string }>) ?? {})[name];
                  const isCommunity = communityQueuedSet.has(name);
                  return (
                    <div className="profile-card" key={name}>
                      <div
                        className="profile-card-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => window.open(`https://x.com/${name}`, '_blank')}
                      >
                        <span className="history-display">{info?.displayName || name}</span>
                        <span className="history-handle">@{name}</span>
                        <span className={`queue-badge${isCommunity ? '' : ' trigger'}`}>
                          {isCommunity ? t.queueFilterCommunity : t.queueFilterTrigger}
                        </span>
                      </div>
                      {info?.text ? <p className="profile-card-text">{info.text}</p> : null}
                      <span className="row-actions profile-card-actions">
                        <button
                          type="button"
                          className="btn-whitelist"
                          title={t.whitelist}
                          onClick={() => addWhitelistFromRecord(name)}
                        >
                          <CheckCircle2 size={14} /> {t.whitelist}
                        </button>
                        <button type="button" title={t.remove} onClick={() => removeQueueName(name)}>
                          <Trash2 size={16} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {filteredQueueNames.length === 0 && <p className="empty-state">{t.queueEmpty}</p>}
              </div>
              {totalQueuePages > 1 && (
                <div className="pager">
                  <span className="toolbar-status">{filteredQueueNames.length} 条 · 第 {queuePage + 1} / {totalQueuePages} 页</span>
                  {queuePage > 0 && (
                    <button type="button" onClick={() => setQueuePage(queuePage - 1)}>‹ 上一页</button>
                  )}
                  {queuePage < totalQueuePages - 1 && (
                    <button type="button" onClick={() => setQueuePage(queuePage + 1)}>下一页 ›</button>
                  )}
                </div>
              )}
                <div className="card-grid">
                <div className="form-grid inline">
                  <input
                    placeholder={t.search}
                    value={blockedQuery}
                    onChange={(e) => { setBlockedQuery(e.currentTarget.value); setBlockedPage(0); }}
                  />
                </div>
                {blockedPageItems.map((entry) => {
                  const name = entry.name;
                  const info = ((state.queueInfo as Record<string, { displayName?: string; text?: string }>) ?? {})[name];
                  return (
                    <div className="profile-card" key={name}>
                      <div
                        className="profile-card-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => window.open(`https://x.com/${name}`, '_blank')}
                      >
                        <span className="history-display">{info?.displayName || name}</span>
                        <span className="history-handle">@{name}</span>
                        {entry.at > 0 && <small>{formatTime(entry.at)}</small>}
                        <ExternalLink size={13} className="profile-card-open" />
                      </div>
                      {info?.text ? <p className="profile-card-text">{info.text}</p> : null}
                      <span className="row-actions profile-card-actions">
                        <button
                          type="button"
                          className="btn-whitelist"
                          title={t.restoreWhitelist}
                          onClick={() => restoreToWhitelist(name)}
                        >
                          <CheckCircle2 size={14} /> {t.whitelist}
                        </button>
                        <button type="button" className="btn-block-x success" onClick={() => unblockOne(name)}>
                          {t.unblock}
                        </button>
                      </span>
                    </div>
                  );
                })}
                {matchedBlockedCount > BLOCKED_BROWSE_LIMIT && !blockedQuery && (
                  <p className="hint">仅显示最新 {BLOCKED_BROWSE_LIMIT} 个；更早的用户请用上方搜索定位后解除拉黑。</p>
                )}
                {totalBlockedPages > 1 && (
                  <div className="pager">
                    <span className="toolbar-status">{matchedBlockedCount} 条 · 第 {blockedPage + 1} / {totalBlockedPages} 页</span>
                    {blockedPage > 0 && (
                      <button type="button" onClick={() => setBlockedPage(blockedPage - 1)}>‹ 上一页</button>
                    )}
                    {blockedPage < totalBlockedPages - 1 && (
                      <button type="button" onClick={() => setBlockedPage(blockedPage + 1)}>下一页 ›</button>
                    )}
                  </div>
                )}
                {blockedUsersOnX.length === 0 && <p className="empty-state">{t.blockedEmpty}</p>}
              </div>
            </DataPanel>

          </div>
        )}

        {view === 'whitelist' && (
          <DataPanel title={t.whitelist} meta={`${whitelist.length}`}>
            <div className="form-grid inline">
              <input id="whitelist-input" placeholder={t.whitelistPlaceholder} onKeyDown={(e) => e.key === 'Enter' && addWhitelist()} />
              <button className="solid-button" type="button" onClick={addWhitelist}>
                {t.whitelistAdd}
              </button>
            </div>
            <div className="compact-list">
              {whitelist.map((name) => (
                <div className="list-row" key={name}>
                  <span className="history-handle">@{name}</span>
                  <span className="row-actions">
                    <button type="button" title={t.remove} onClick={() => setValue('whitelist', whitelist.filter((w) => w !== name))}>
                      <Trash2 size={16} />
                    </button>
                  </span>
                </div>
              ))}
              {whitelist.length === 0 && <p className="empty-state">{t.whitelistEmpty}</p>}
            </div>
          </DataPanel>
        )}

        {view === 'rules' && (
          <div className="stack">
            <DataPanel
              title={t.cloudLibrary}
              meta={`${t.repoLabel}：${cloudRepo} · ${cloudKeywords.length}`}
            >
              <div className="form-grid inline">
                <button className="solid-button" type="button" disabled={syncingRules} onClick={triggerSyncRules}>
                  <Download size={16} className={syncingRules ? 'spin' : ''} /> {syncingRules ? t.syncing : t.syncRules}
                </button>
                <button className="plain-button" type="button" disabled={syncingRules || !state.shareEnabled} title={t.shareKeywordsHint} onClick={shareKeywords}>
                  <Upload size={16} className={syncingRules ? 'spin' : ''} /> {t.shareKeywords}
                </button>
                <span className="toolbar-status">
                  {Number(state.lastSyncTime ?? 0) > 0 ? formatTime(Number(state.lastSyncTime)) : ''}
                  {state.syncStatus === 'ok' ? ` · ${t.syncOk}` : ''}
                  {state.syncStatus === 'error' ? ` · ${t.syncFailed}` : ''}
                </span>
              </div>
              <p className="hint">{t.rulesSyncHint}</p>
              <p className="hint">{t.syncManualHint}</p>
              <div className="form-grid inline">
                <input
                  placeholder={t.search}
                  value={cloudQuery}
                  onChange={(e) => setCloudQuery(e.currentTarget.value)}
                />
              </div>
              <div className="tag-cloud">
                {visibleCloudKeywords.map((keyword) => {
                  const disabled = ((state.disabledCloudKeywords as string[]) ?? []).includes(keyword);
                  return (
                    <KeywordTag
                      key={keyword}
                      keyword={keyword}
                      disabled={disabled}
                      onDelete={() => toggleDisabledCloud(keyword, !disabled)}
                    />
                  );
                })}
                {cloudKeywords.length === 0 && <p className="empty-state">{t.noCloudKeywords}</p>}
              </div>
            </DataPanel>

            <DataPanel title={t.customKeywords} meta={`${customKeywords.length}`}>
              <div className="form-grid inline">
                <input id="new-keyword" placeholder={t.keywordPlaceholder} onKeyDown={(e) => e.key === 'Enter' && addKeyword()} />
                <button className="solid-button" type="button" onClick={addKeyword}>
                  {t.addKeyword}
                </button>
                <button className="plain-button" type="button" onClick={importKeywords}>
                  <Upload size={16} /> {t.import}
                </button>
                <button className="plain-button" type="button" onClick={exportKeywords}>
                  <Download size={16} /> {t.export}
                </button>
              </div>
              <p className="hint">{t.customHint}</p>
              <div className="tag-cloud">
                {customKeywords.map((keyword) =>
                  editingKeyword?.old === keyword ? (
                    <span key={keyword} className="keyword-tag is-editing">
                      <input
                        value={editingKeyword.value}
                        autoFocus
                        onChange={(e) => setEditingKeyword({ old: keyword, value: e.currentTarget.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditedKeyword();
                          if (e.key === 'Escape') setEditingKeyword(null);
                        }}
                      />
                      <button type="button" className="tag-action" title={t.save} onClick={saveEditedKeyword}>
                        ✓
                      </button>
                      <button type="button" className="tag-action" title={t.cancel} onClick={() => setEditingKeyword(null)}>
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span key={keyword} className="keyword-edit-wrap">
                      <KeywordTag keyword={keyword} onDelete={() => deleteKeyword(keyword)} />
                      <button
                        type="button"
                        className="tag-action"
                        title={t.edit}
                        onClick={() => setEditingKeyword({ old: keyword, value: keyword })}
                      >
                        <Pencil size={12} />
                      </button>
                    </span>
                  ),
                )}
                {customKeywords.length === 0 && <p className="empty-state">{t.noCustomKeywords}</p>}
              </div>
            </DataPanel>
          </div>
        )}

        {view === 'logs' && (
          <DataPanel title={t.logs} meta={`${filteredLogs.length} / ${logs.length}`}>
            <div className="toolbar">
              <select value={logLevel} onChange={(e) => { setLogLevel(e.currentTarget.value); setLogPage(0); }}>
                {logLevels.map((level) => (
                  <option key={level} value={level}>{level === 'all' ? t.all : t[`level-${level}`] ?? level}</option>
                ))}
              </select>
              <select value={logCategory} onChange={(e) => { setLogCategory(e.currentTarget.value); setLogPage(0); }}>
                {logCategories.map((category) => (
                  <option key={category} value={category}>{category === 'all' ? t.all : t[`cat-${category}`] ?? category}</option>
                ))}
              </select>
              <input
                placeholder={t.search}
                value={logQuery}
                onChange={(e) => { setLogQuery(e.currentTarget.value); setLogPage(0); }}
              />
              <button className="plain-button" type="button" onClick={() => exportLogs(filteredLogs)}>
                <Download size={16} /> {t.export}
              </button>
              <button
                className="plain-button"
                type="button"
                onClick={() => { void pruneLogs(7); setStatus(t.prunedNote); }}
                title={t.pruneTitle}
              >
                <Trash2 size={16} /> {t.prune}
              </button>
              <button
                className="plain-button"
                type="button"
                onClick={() => { if (window.confirm(t.clearAll)) setValue('xshieldLogs', []); }}
              >
                <Trash2 size={16} /> {t.clearAll}
              </button>
            </div>
            <div className="compact-list">
              {filteredLogs
                .slice(logPage * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE)
                .map((entry) => (
                  <div className="list-row log-row" key={entry.id}>
                    <span className={`log-level ${entry.level}`}>{entry.level}</span>
                    <span className={`log-cat ${entry.category}`}>{entry.category}</span>
                    <span className="history-text">{entry.message}</span>
                    <small>{new Date(entry.time).toLocaleString()}</small>
                  </div>
                ))}
              {filteredLogs.length === 0 && <p className="empty-state">{t.logsEmpty}</p>}
            </div>
            {filteredLogs.length > LOG_PAGE_SIZE && (
              <div className="toolbar">
                <button className="plain-button" type="button" disabled={logPage === 0} onClick={() => setLogPage(logPage - 1)}>‹</button>
                <span className="toolbar-status">{logPage + 1} / {Math.ceil(filteredLogs.length / LOG_PAGE_SIZE)}</span>
                <button
                  className="plain-button"
                  type="button"
                  disabled={(logPage + 1) * LOG_PAGE_SIZE >= filteredLogs.length}
                  onClick={() => setLogPage(logPage + 1)}
                >›</button>
              </div>
            )}
          </DataPanel>
        )}

        {view === 'settings' && (
          <DataPanel title={t.settings}>
            <div className="settings-section">
              <h3>{t.secRuntime}</h3>
              <div className="settings-grid">
                <label className="check-label">
                  <span>{t.enabled}</span>
                  <Toggle checked={Boolean(state.enabled)} onChange={(v) => setValue('enabled', v)} />
                </label>
                <label className="field-row compact">
                  <span>{t.displayMode}</span>
                  <select
                    value={state.highlightMode ? 'highlight' : 'hide'}
                    onChange={(e) => setValue('highlightMode', e.currentTarget.value === 'highlight')}
                  >
                    <option value="hide">{t.modeHide}</option>
                    <option value="highlight">{t.modeHighlight}</option>
                  </select>
                </label>
                <label className="field-row compact">
                  <span>{t.language}</span>
                  <select value={String(state.language ?? 'system')} onChange={(e) => setValue('language', e.currentTarget.value)}>
                    <option value="system">{t.system}</option>
                    <option value="zh-CN">{t.simplifiedChinese}</option>
                    <option value="zh-TW">{t.traditionalChinese}</option>
                    <option value="en">{t.english}</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="settings-section">
              <h3>{t.secFilters}</h3>
              <div className="settings-grid compact">
                <label className="check-label">
                  <span>{t.checkUsername}</span>
                  <Toggle checked={Boolean(state.checkUsername)} onChange={(v) => setValue('checkUsername', v)} />
                </label>
                <label className="check-label">
                  <span>{t.onlyComments}</span>
                  <Toggle checked={Boolean(state.onlyComments)} onChange={(v) => setValue('onlyComments', v)} />
                </label>
                <label className="check-label">
                  <span>{t.blockSpecialChars}</span>
                  <Toggle checked={Boolean(state.blockSpecialChars)} onChange={(v) => setValue('blockSpecialChars', v)} />
                </label>
                <label className="check-label">
                  <span>{t.blockEmoji}</span>
                  <Toggle checked={Boolean(state.blockEmoji)} onChange={(v) => setValue('blockEmoji', v)} />
                </label>
                <label className="check-label">
                  <span>{t.blockGrok}</span>
                  <Toggle checked={Boolean(state.blockGrok)} onChange={(v) => setValue('blockGrok', v)} />
                </label>
              </div>
            </div>

            <div className="settings-section">
              <h3>{t.secCloud}</h3>
              <div className="settings-grid">
                <label className="check-label">
                  <span>{t.cloudEnabled}</span>
                  <Toggle checked={Boolean(state.cloudEnabled)} onChange={(v) => setValue('cloudEnabled', v)} />
                </label>
                <label className="field-row">
                  <span>{t.cloudOwnerRepo}</span>
                  <input
                    value={String(state.cloudOwnerRepo ?? '')}
                    placeholder="默认 smthdagg/XShield-keywords"
                    onChange={(e) => setValue('cloudOwnerRepo', e.currentTarget.value)}
                  />
                </label>
              </div>
              <p className="hint">{t.cloudSourceHint}</p>
            </div>

            <div className="settings-section">
              <h3>{t.secShare}</h3>
              <p className="hint">{t.syncShareHint}</p>
              <p className="hint">{t.shareEnabledHint}</p>
              <div className="settings-grid">
                <label className="check-label">
                  <span>{t.shareEnabledLabel}</span>
                  <Toggle checked={Boolean(state.shareEnabled)} onChange={(v) => setValue('shareEnabled', v)} />
                </label>
                <label className="field-row">
                  <span>{t.githubTokenLabel}</span>
                  <span className="token-field">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={String(state.githubToken ?? '')}
                      disabled={!state.shareEnabled}
                      placeholder={showToken ? (state.githubToken ? '当前已保存令牌' : '未设置') : ''}
                      onChange={(e) => setValue('githubToken', e.currentTarget.value)}
                    />
                    <button type="button" title={showToken ? t.hide : t.show} onClick={() => setShowToken(!showToken)} disabled={!state.shareEnabled}>
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button type="button" title={t.clearToken} onClick={() => setValue('githubToken', '')} disabled={!state.shareEnabled}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                </label>
              </div>
              <div className="form-grid inline">
                <button className="plain-button" type="button" disabled={syncingHandles} onClick={triggerSyncHandles}>
                  <Download size={16} className={syncingHandles ? 'spin' : ''} /> {syncingHandles ? t.syncing : t.syncBlacklist}
                </button>
                <button className="plain-button" type="button" disabled={syncingHandles || !state.shareEnabled} onClick={shareHandles}>
                  <Upload size={16} className={syncingHandles ? 'spin' : ''} /> {t.shareHandles}
                </button>
                <button className="plain-button" type="button" onClick={exportDiagnostics} title={t.diagnostics}>
                  <Download size={16} /> {t.diagnostics}
                </button>
              </div>
              <p className="settings-subtitle">{t.syncRecords}</p>
              <div className="compact-list">
                {syncLogs.map((entry) => (
                  <div className="list-row log-row" key={entry.id}>
                    <span className={`log-level ${entry.level}`}>{entry.level}</span>
                    <span className="history-text">{entry.message}</span>
                    <small>{new Date(entry.time).toLocaleString()}</small>
                  </div>
                ))}
                {syncLogs.length === 0 && <p className="empty-state">{t.noSyncRecords}</p>}
              </div>
            </div>

            <div className="settings-section">
              <h3>{t.supportTitle}</h3>
              <p className="hint">{t.supportHint}</p>
              <div className="form-grid inline">
                <button className="plain-button" type="button" onClick={() => window.open('https://github.com/sponsors/smthdagg', '_blank')}>
                  ♥ GitHub Sponsors
                </button>
                <button className="plain-button" type="button" onClick={() => window.open('https://afdian.net/a/smthdagg', '_blank')}>
                  ♥ 爱发电
                </button>
              </div>
            </div>
          </DataPanel>
        )}
      </section>
    </main>
  );
}
