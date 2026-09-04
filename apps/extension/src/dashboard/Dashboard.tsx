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
  cloudOwnerRepo: '',
  autoBlockQueue: [] as string[],
  queueInfo: {} as Record<string, { displayName?: string; text?: string }>,
  autoBlockToday: 0,
  autoBlockPausedUntil: 0,
  blockedUsersOnX: [] as string[],
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

export default function Dashboard() {
  const [state, setState] = useState<Record<string, unknown>>(() => ({ ...DEFAULTS }));
  const [view, setView] = useState<ViewId>('triggered');
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

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
  // Display-side ledger filter: a blocked user must never render as "pending".
  const pendingQueue = useMemo(
    () => autoBlockQueue.filter((name) => !blockedUsersOnX.includes(name)),
    [autoBlockQueue, blockedUsersOnX],
  );
  const whitelist = useMemo(() => (state.whitelist as string[]) ?? [], [state.whitelist]);
  const cloudKeywords = useMemo(() => parseKeywords(String(state.cloudKeywords ?? '')), [state.cloudKeywords]);
  const customKeywords = useMemo(() => parseKeywords(String(state.keywords ?? '')), [state.keywords]);

  // ---- actions ----
  const triggerSync = (): void => {
    setSyncing(true);
    void send({ action: 'syncNow' })
      .then((res) => setStatus((res as { success?: boolean })?.success ? t.syncOk : t.syncFailed))
      .catch(() => setStatus(t.syncFailed))
      .finally(() => setSyncing(false));
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

  const [confirmBlockAll, setConfirmBlockAll] = useState(false);
  const confirmTimer = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);

  const blockSelected = (names: string[]): void => {
    if (names.length === 0) return;
    if (!confirmBlockAll) {
      setConfirmBlockAll(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmBlockAll(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmBlockAll(false);
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
      setStatus(t.queuedNote.replace('{count}', String(names.length)));
      setSelectedIds([]);
    });
  };

  const removeRecord = (id: string, time: number): void => {
    void send({ action: 'removeSpamRecord', id, time });
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
  const visibleCloudKeywords = cloudKeywords.filter((k) => (cloudQuery ? k.includes(cloudQuery.toLowerCase()) : true));

  // triggered page state
  const [triggerQuery, setTriggerQuery] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // `__blocked_on_x__` / `__queued_on_x__` are 1.5.1 pseudo-reasons driven by
  // the ledger and the auto-block queue instead of the record's own reason.
  const BLOCKED_FILTER = '__blocked_on_x__';
  const QUEUED_FILTER = '__queued_on_x__';
  const triggerReasons = ['all', '内容屏蔽', '昵称屏蔽', '表情屏蔽', '特殊字符屏蔽', 'Grok屏蔽', QUEUED_FILTER, BLOCKED_FILTER];
  // Default ('all') is the working list: records whose user is neither
  // queued nor blocked. Confirming a block (or an auto trigger enqueuing)
  // moves rows out immediately — into 排队中 — and into 已拉黑 once the
  // ledger confirms the block. Records stay in storage (1.5.1: blocks never
  // delete history); only the working view shrinks.
  const filterLabel = (reason: string): string =>
    reason === BLOCKED_FILTER ? '已拉黑' : reason === QUEUED_FILTER ? '排队中' : reason === 'all' ? '未拉黑' : reason;

  const filteredHistory = blockedHistory.filter((item) => {
    const handle = extractCleanScreenName(item.user ?? '');
    const isBlocked = Boolean(handle) && blockedUsersOnX.includes(handle);
    const isQueued = !isBlocked && Boolean(handle) && autoBlockQueue.includes(handle);
    if (triggerFilter === BLOCKED_FILTER) {
      if (!isBlocked) return false;
    } else if (triggerFilter === QUEUED_FILTER) {
      if (!isQueued) return false;
    } else if (isBlocked || isQueued) {
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
  // Records currently living under the 排队中/已拉黑 filters instead of the
  // working list.
  const hasDeferredRecords = blockedHistory.some((item) => {
    const handle = extractCleanScreenName(item.user ?? '');
    return Boolean(handle) && (blockedUsersOnX.includes(handle) || autoBlockQueue.includes(handle));
  });
  const selectedNames = Array.from(
    new Set(selectedRecords.map((item) => extractCleanScreenName(item.user ?? '')).filter(Boolean)),
  );

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
                {confirmBlockAll
                  ? t.confirmBlock.replace('{count}', String(selectedNames.length))
                  : `${t.blockAll}(${selectedNames.length})`}
              </button>
            </div>
            <p className="hint">{t.blockHere}</p>
            <div className="card-grid">
              {filteredHistory.map((item) => {
                const handle = extractCleanScreenName(item.user ?? '');
                const key = `${item.id}:${item.time}`;
                const isBlocked = handle ? blockedUsersOnX.includes(handle) : false;
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
                        <button type="button" title={t.whitelist} onClick={() => addWhitelistFromRecord(handle)}>
                          <CheckCircle2 size={16} />
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
                (triggerFilter !== BLOCKED_FILTER && triggerFilter !== QUEUED_FILTER && hasDeferredRecords ? (
                  <p className="empty-state">记录都已进入拉黑流程：「排队中」「已拉黑」筛选里可见。</p>
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
              <p className="hint">{t.cloudSourceHint}</p>
            <p className="hint">{t.autoBlockNote}</p>
              <div className="card-grid">
                {blockedUsersOnX.slice(-200).reverse().map((name) => {
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
                {blockedUsersOnX.length === 0 && <p className="empty-state">{t.blockedEmpty}</p>}
              </div>
            </DataPanel>

            <DataPanel title={t.queueTitle} meta={`${pendingQueue.length}`}>
              <div className="card-grid">
                {pendingQueue.map((name) => {
                  const info = ((state.queueInfo as Record<string, { displayName?: string; text?: string }>) ?? {})[name];
                  return (
                    <div className="profile-card" key={name} role="button" tabIndex={0} onClick={() => window.open(`https://x.com/${name}`, '_blank')}>
                      <div className="profile-card-head">
                        <span className="history-display">{info?.displayName || name}</span>
                        <span className="history-handle">@{name}</span>
                        <ExternalLink size={13} className="profile-card-open" />
                      </div>
                      {info?.text ? <p className="profile-card-text">{info.text}</p> : null}
                    </div>
                  );
                })}
                {pendingQueue.length === 0 && <p className="empty-state">{t.queueEmpty}</p>}
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
            <DataPanel title={t.cloudLibrary} meta={`${cloudKeywords.length}`}>
              <div className="form-grid inline">
                <button className="solid-button" type="button" disabled={syncing} onClick={triggerSync}>
                  <Download size={16} className={syncing ? 'spin' : ''} /> {syncing ? t.syncing : t.syncNow}
                </button>
                <span className="toolbar-status">
                  {Number(state.lastSyncTime ?? 0) > 0 ? formatTime(Number(state.lastSyncTime)) : ''}
                  {state.syncStatus === 'ok' ? ` · ${t.syncOk}` : ''}
                  {state.syncStatus === 'error' ? ` · ${t.syncFailed}` : ''}
                </span>
              </div>
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
            <div className="settings-grid">
              <label className="check-label">
                <span>{t.enabled}</span>
                <Toggle checked={Boolean(state.enabled)} onChange={(v) => setValue('enabled', v)} />
              </label>
              <label>
                <span>{t.displayMode}</span>
                <select
                  value={state.highlightMode ? 'highlight' : 'hide'}
                  onChange={(e) => setValue('highlightMode', e.currentTarget.value === 'highlight')}
                >
                  <option value="hide">{t.modeHide}</option>
                  <option value="highlight">{t.modeHighlight}</option>
                </select>
              </label>
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
              <label className="check-label">
                <span>{t.cloudEnabled}</span>
                <Toggle checked={Boolean(state.cloudEnabled)} onChange={(v) => setValue('cloudEnabled', v)} />
              </label>
              <label>
                <span>{t.language}</span>
                <select value={String(state.language ?? 'system')} onChange={(e) => setValue('language', e.currentTarget.value)}>
                  <option value="system">{t.system}</option>
                  <option value="zh-CN">{t.simplifiedChinese}</option>
                  <option value="zh-TW">{t.traditionalChinese}</option>
                  <option value="en">{t.english}</option>
                  <option value="ja">{t.japanese}</option>
                  <option value="ko">{t.korean}</option>
                  <option value="fr">{t.french}</option>
                </select>
              </label>
              <label>
                <span>{t.cloudOwnerRepo}</span>
                <input
                  value={String(state.cloudOwnerRepo ?? '')}
                  placeholder="amahteru/x-comment-blocker"
                  onChange={(e) => setValue('cloudOwnerRepo', e.currentTarget.value)}
                />
              </label>
            </div>
            <p className="hint">{t.cloudSourceHint}</p>
            <p className="hint">{t.autoBlockNote}</p>
          </DataPanel>
        )}
      </section>
    </main>
  );
}
