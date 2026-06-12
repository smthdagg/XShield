import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ClipboardList,
  CircleHelp,
  Download,
  Gauge,
  ListChecks,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type {
  AppSettings,
  BlockAdapterMode,
  BlockedUser,
  BlockQueueItem,
  CandidateUser,
  LanguageMode,
  MatchField,
  RuleExecutionMode,
  RuleType,
  XUserProfile,
} from '@xshield/shared';
import { DEFAULT_BLOCK_EXECUTOR_CONFIG, DEFAULT_SCORE_THRESHOLD } from '@xshield/shared';
import { useAppStore, type RuleDraft } from '../store/useAppStore';
import { dashboardCopy } from './i18n';
import { helpManuals } from './helpContent';
import { PROJECT_INFO } from '../projectInfo';

const navItems = [
  { id: 'overview', labelKey: 'overview', icon: Gauge },
  { id: 'candidates', labelKey: 'candidates', icon: ClipboardList },
  { id: 'rules', labelKey: 'rules', icon: SlidersHorizontal },
  { id: 'queue', labelKey: 'queue', icon: ListChecks },
  { id: 'blocked', labelKey: 'blocked', icon: Ban },
  { id: 'whitelist', labelKey: 'whitelist', icon: CheckCircle2 },
  { id: 'logs', labelKey: 'logs', icon: Search },
  { id: 'settings', labelKey: 'settings', icon: Settings },
  { id: 'help', labelKey: 'help', icon: CircleHelp },
] as const;

const fields: MatchField[] = ['username', 'displayName', 'bio', 'postContent'];
type ViewId = (typeof navItems)[number]['id'];
type UiLanguage = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'fr';
type CopyKey =
  | (typeof navItems)[number]['labelKey']
  | 'appSubtitle'
  | 'manualSearch'
  | 'searchScope'
  | 'keyword'
  | 'search'
  | 'triggered'
  | 'recentTriggers'
  | 'profileLink'
  | 'description'
  | 'followers'
  | 'matched'
  | 'falsePositive'
  | 'blocked'
  | 'deleteSelected'
  | 'whitelistSelected'
  | 'selectAll'
  | 'queueSelected'
  | 'queueAndRun'
  | 'exportBlocked'
  | 'exportFormat'
  | 'ruleMode'
  | 'automatic'
  | 'manual'
  | 'start'
  | 'stop'
  | 'evaluateNow'
  | 'blockMode'
  | 'mock'
  | 'real'
  | 'language'
  | 'system'
  | 'saveSettings'
  | 'runBatch'
  | 'manualBlockNow'
  | 'manualBlockWarning'
  | 'queueSettingsHint'
  | 'newRule'
  | 'editRule'
  | 'ruleType'
  | 'content'
  | 'fieldUsername'
  | 'fieldDisplayName'
  | 'fieldBio'
  | 'fieldPostContent'
  | 'onePerLine'
  | 'ruleLines'
  | 'score'
  | 'caseSensitive'
  | 'save'
  | 'cancel'
  | 'deleteRule'
  | 'clear'
  | 'status'
  | 'actions'
  | 'retries'
  | 'lastError'
  | 'restore'
  | 'clearLogs'
  | 'resetDraft'
  | 'noCandidates'
  | 'noSearchResults'
  | 'queueEmpty'
  | 'whitelistEmpty'
  | 'logsEmpty'
  | 'scoreThreshold'
  | 'batchSize'
  | 'intervalMinutes'
  | 'jitterSeconds'
  | 'maxRetries'
  | 'cooldownMinutes'
  | 'languageSimplifiedChinese'
  | 'languageTraditionalChinese'
  | 'languageEnglish'
  | 'languageJapanese'
  | 'languageKorean'
  | 'languageFrench'
  | 'running'
  | 'scanningCurrentPage'
  | 'runningQueue'
  | 'ruleRunResult'
  | 'queueRunDone'
  | 'queueRunSkipped';

const copy = dashboardCopy as Record<UiLanguage, Record<CopyKey, string>>;
type BlockedExportFormat = 'txt' | 'csv' | 'json' | 'ndjson' | 'sql';

const emptyRule: RuleDraft = {
  type: 'keyword',
  content: '',
  fields: ['username', 'displayName', 'bio', 'postContent'],
  enabled: true,
  caseSensitive: false,
  score: DEFAULT_SCORE_THRESHOLD,
};

function getLanguage(settings?: AppSettings): UiLanguage {
  if (settings?.language === 'zh') return 'zh-CN';
  if (
    settings?.language === 'en' ||
    settings?.language === 'zh-CN' ||
    settings?.language === 'zh-TW' ||
    settings?.language === 'ja' ||
    settings?.language === 'ko' ||
    settings?.language === 'fr'
  ) {
    return settings.language;
  }

  const systemLanguage = navigator.language.toLowerCase();
  if (systemLanguage.startsWith('zh-tw') || systemLanguage.startsWith('zh-hk')) return 'zh-TW';
  if (systemLanguage.startsWith('zh')) return 'zh-CN';
  if (systemLanguage.startsWith('ja')) return 'ja';
  if (systemLanguage.startsWith('ko')) return 'ko';
  if (systemLanguage.startsWith('fr')) return 'fr';
  return 'en';
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(`{${key}}`, String(value)),
    template,
  );
}

function normalizeUsername(username: string): string {
  return username.replace(/^@+/, '').trim();
}

function getProfileUrl(profile: Pick<XUserProfile, 'username' | 'profileUrl'>): string {
  const normalizedUsername = normalizeUsername(profile.username);
  return `https://x.com/${normalizedUsername}`;
}

function formatFollowers(profile: Pick<XUserProfile, 'followersCount' | 'followersText'>): string {
  if (profile.followersText) return profile.followersText;
  if (typeof profile.followersCount === 'number') return profile.followersCount.toLocaleString();
  return '-';
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function sqlText(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function exportBlockedUsers(users: BlockedUser[], format: BlockedExportFormat): void {
  const rows = users.map((user) => ({
    id: user.id,
    username: normalizeUsername(user.username),
    displayName: user.displayName ?? '',
    bio: user.bio ?? '',
    followersCount: user.followersCount ?? '',
    followersText: user.followersText ?? '',
    profileUrl: getProfileUrl(user),
    score: user.score ?? '',
    matchedRules: user.matchedRules?.join('|') ?? '',
    triggerReason: user.triggerReason ?? '',
    blockedAt: new Date(user.blockedAt).toISOString(),
    sourceQueueItemId: user.sourceQueueItemId ?? '',
  }));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let body = '';
  let mime = 'text/plain;charset=utf-8';

  if (format === 'txt') {
    body = rows.map((row) => `@${row.username}\t${row.profileUrl}\t${row.blockedAt}`).join('\n');
  } else if (format === 'csv') {
    const headers = Object.keys(rows[0] ?? {
      id: '',
      username: '',
      displayName: '',
      bio: '',
      followersCount: '',
      followersText: '',
      profileUrl: '',
      score: '',
      matchedRules: '',
      triggerReason: '',
      blockedAt: '',
      sourceQueueItemId: '',
    });
    body = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key as keyof typeof row])).join(','))].join('\n');
    mime = 'text/csv;charset=utf-8';
  } else if (format === 'json') {
    body = JSON.stringify(rows, null, 2);
    mime = 'application/json;charset=utf-8';
  } else if (format === 'ndjson') {
    body = rows.map((row) => JSON.stringify(row)).join('\n');
    mime = 'application/x-ndjson;charset=utf-8';
  } else {
    body = [
      'CREATE TABLE IF NOT EXISTS xshield_blocked_users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT, bio TEXT, followers_count INTEGER, followers_text TEXT, profile_url TEXT, score INTEGER, matched_rules TEXT, trigger_reason TEXT, blocked_at TEXT, source_queue_item_id TEXT);',
      ...rows.map(
        (row) =>
          `INSERT OR REPLACE INTO xshield_blocked_users (id, username, display_name, bio, followers_count, followers_text, profile_url, score, matched_rules, trigger_reason, blocked_at, source_queue_item_id) VALUES (${sqlText(row.id)}, ${sqlText(row.username)}, ${sqlText(row.displayName)}, ${sqlText(row.bio)}, ${row.followersCount === '' ? 'NULL' : Number(row.followersCount)}, ${sqlText(row.followersText)}, ${sqlText(row.profileUrl)}, ${row.score === '' ? 'NULL' : Number(row.score)}, ${sqlText(row.matchedRules)}, ${sqlText(row.triggerReason)}, ${sqlText(row.blockedAt)}, ${sqlText(row.sourceQueueItemId)});`,
      ),
    ].join('\n');
    mime = 'application/sql;charset=utf-8';
  }

  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `xshield-blocked-users-${stamp}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

function getTriggerSummary(
  profile: Pick<CandidateUser, 'triggerReason' | 'matchedRules' | 'matchedFields'>,
): string {
  const rules = profile.triggerReason || profile.matchedRules?.join(', ');
  const fieldsText = profile.matchedFields?.length ? ` (${profile.matchedFields.join(', ')})` : '';
  return rules ? `${rules}${fieldsText}` : '-';
}

function getRuleLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getFieldLabel(field: MatchField, t: Record<CopyKey, string>): string {
  if (field === 'username') return t.fieldUsername;
  if (field === 'displayName') return t.fieldDisplayName;
  if (field === 'bio') return t.fieldBio;
  return t.fieldPostContent;
}

function ProfileIdentity({
  profile,
  selectable,
  selected,
  onSelected,
}: {
  profile: Pick<XUserProfile, 'username' | 'displayName' | 'bio' | 'postContent' | 'profileUrl' | 'avatarUrl'>;
  selectable?: boolean;
  selected?: boolean;
  onSelected?: (selected: boolean) => void;
}): JSX.Element {
  const username = normalizeUsername(profile.username);

  return (
    <span className={selectable ? 'profile-cell selectable' : 'profile-cell'}>
      {selectable && (
        <input
          aria-label={`Select ${username}`}
          type="checkbox"
          checked={Boolean(selected)}
          onChange={(event) => onSelected?.(event.currentTarget.checked)}
        />
      )}
      {profile.avatarUrl ? (
        <img className="profile-avatar" src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="profile-avatar avatar-fallback">{username.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="profile-copy">
        <a className="profile-link" href={getProfileUrl(profile)} target="_blank" rel="noreferrer">
          @{username}
        </a>
        <small>{profile.bio || '-'}</small>
        {profile.displayName && <small>{profile.displayName}</small>}
        <small>{getProfileUrl(profile)}</small>
      </span>
    </span>
  );
}

export function Dashboard(): JSX.Element {
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [query, setQuery] = useState('');
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(emptyRule);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | undefined>();
  const [selectedSearchIds, setSelectedSearchIds] = useState<string[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [isRuleRunPending, setIsRuleRunPending] = useState(false);
  const [ruleRunMessage, setRuleRunMessage] = useState('');
  const [isQueueRunPending, setIsQueueRunPending] = useState(false);
  const [queueRunMessage, setQueueRunMessage] = useState('');
  const [blockedExportFormat, setBlockedExportFormat] = useState<BlockedExportFormat>('csv');
  const loadAll = useAppStore((state) => state.loadAll);
  const store = useAppStore();

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (store.settings) setSettingsDraft(store.settings);
  }, [store.settings]);

  const language = getLanguage(settingsDraft ?? store.settings);
  const t = copy[language];
  const helpManual = helpManuals[language];
  const visibleCandidates = store.candidates.filter((candidate) => candidate.status !== 'deleted');
  const candidateUsers = visibleCandidates.filter((candidate) => candidate.status === 'candidate');
  const whitelistedUsers = visibleCandidates.filter((candidate) => candidate.status === 'whitelisted');
  const queueItems = store.blockQueue.filter((item) => item.status !== 'success');
  const selectedSearchProfiles = store.searchResults.filter((profile) =>
    selectedSearchIds.includes(profile.id),
  );
  const selectedCandidateUsers = candidateUsers.filter((candidate) =>
    selectedCandidateIds.includes(candidate.id),
  );
  const selectedQueueItems = queueItems.filter((item) => selectedQueueIds.includes(item.id));
  const recentlyTriggered = candidateUsers.slice(0, 8);

  const metrics = useMemo(
    () => [
      { label: t.triggered, value: candidateUsers.length },
      { label: t.candidates, value: candidateUsers.length },
      { label: t.rules, value: store.rules.filter((rule) => rule.enabled).length },
      { label: t.queue, value: queueItems.length },
      { label: t.blocked, value: store.blockedUsers.length },
      { label: t.whitelist, value: whitelistedUsers.length },
    ],
    [candidateUsers.length, queueItems.length, store.blockedUsers.length, store.rules, t, whitelistedUsers.length],
  );

  const getNavCount = (id: ViewId): string | undefined => {
    if (id === 'candidates') return String(candidateUsers.length);
    if (id === 'queue') return String(queueItems.length);
    if (id === 'blocked') return String(store.blockedUsers.length);
    if (id === 'whitelist') return String(whitelistedUsers.length);
    if (id === 'rules') return `${store.rules.filter((rule) => rule.enabled).length}/${store.rules.length}`;
    if (id === 'logs') return String(store.logs.length);
    return undefined;
  };

  const activeLabel = t[navItems.find((item) => item.id === activeView)?.labelKey ?? 'overview'];

  const saveSettings = (next: AppSettings): void => {
    setSettingsDraft(next);
    void store.updateSettings(next);
  };

  const runRulesNow = (): void => {
    setIsRuleRunPending(true);
    setRuleRunMessage(t.scanningCurrentPage);
    void store
      .evaluateCandidatesNow()
      .then((summary) => {
        setRuleRunMessage(
          formatMessage(t.ruleRunResult, {
            scannedCount: summary.scannedCount,
            evaluatedCount: summary.evaluatedCount,
            matchedCount: summary.matchedCount,
          }),
        );
      })
      .catch((error: unknown) => {
        setRuleRunMessage(String(error || 'Rule run failed'));
      })
      .finally(() => setIsRuleRunPending(false));
  };

  const formatQueueResult = (result: Awaited<ReturnType<typeof store.runQueueOnce>>): string =>
    `${result.skipped ? t.queueRunSkipped : t.queueRunDone}: attempted ${result.attemptedCount}, blocked ${result.blockedCount}, skipped ${result.skippedCount}, failed ${result.failedCount}, remaining ${result.remainingQueuedCount}. ${result.message}`;

  const getQueueSettingsHint = (): string => {
    const settings = store.settings;
    if (!settings) return '';
    return t.queueSettingsHint
      .replace('{batchSize}', String(settings.executorConfig.batchSize))
      .replace('{intervalMinutes}', String(settings.executorConfig.intervalMinutes))
      .replace('{mode}', settings.blockAdapterMode === 'real' ? t.real : t.mock);
  };

  const runQueueNow = (force = false): void => {
    if (force && !window.confirm(t.manualBlockWarning)) return;

    setIsQueueRunPending(true);
    setQueueRunMessage(t.runningQueue);
    void store
      .runQueueOnce({ force })
      .then((result) => {
        setQueueRunMessage(formatQueueResult(result));
      })
      .catch((error: unknown) => {
        setQueueRunMessage(String(error || 'Queue run failed'));
      })
      .finally(() => setIsQueueRunPending(false));
  };

  const submitRule = (): void => {
    if (!ruleDraft.content.trim() || ruleDraft.fields.length === 0) return;
    void store.saveRule(ruleDraft);
    setRuleDraft(emptyRule);
  };

  const queueProfiles = (profiles: XUserProfile[], runAfterQueue: boolean): void => {
    void Promise.all(profiles.map((profile) => store.addManualCandidate(profile))).then(async () => {
      await store.loadAll();
      const candidatesToQueue = profiles
        .map((profile) => useAppStore.getState().candidates.find((candidate) => candidate.id === profile.id))
        .filter((candidate): candidate is CandidateUser => Boolean(candidate));
      await store.addCandidatesToQueue(candidatesToQueue);
      setSelectedSearchIds([]);
      if (runAfterQueue) await store.runQueueOnce();
    });
  };

  const queueCandidates = (candidates: CandidateUser[], runAfterQueue: boolean): void => {
    void store.addCandidatesToQueue(candidates).then(async () => {
      setSelectedCandidateIds([]);
      if (runAfterQueue) await store.runQueueOnce();
    });
  };

  const deleteSelectedCandidates = (): void => {
    void Promise.all(selectedCandidateUsers.map((candidate) => store.deleteCandidate(candidate.id))).then(() =>
      setSelectedCandidateIds([]),
    );
  };

  const whitelistSelectedCandidates = (): void => {
    void Promise.all(selectedCandidateUsers.map((candidate) => store.whitelistCandidate(candidate.id))).then(() =>
      setSelectedCandidateIds([]),
    );
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={chrome.runtime.getURL('icons/xshield-logo.svg')} alt="" />
          <span>XShield</span>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {navItems.map((item) => {
            const Icon = item.icon;
            const count = getNavCount(item.id);
            return (
              <button
                key={item.id}
                className={activeView === item.id ? 'nav-item active' : 'nav-item'}
                type="button"
                title={t[item.labelKey]}
                onClick={() => setActiveView(item.id)}
              >
                <Icon aria-hidden />
                <span>{t[item.labelKey]}</span>
                {count && <strong>{count}</strong>}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.appSubtitle}</p>
            <h1>{activeLabel}</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Refresh data"
            onClick={() => void store.loadAll()}
          >
            <RefreshCw aria-hidden />
          </button>
        </header>

        {activeView === 'overview' && (
          <div className="stack">
            <section className="metric-grid">
              {metrics.map((metric) => (
                <article className="metric-card" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </section>
            <DataPanel title={t.recentTriggers} meta={`${recentlyTriggered.length} / ${candidateUsers.length}`}>
              <div className="compact-list">
                {recentlyTriggered.map((candidate) => (
                  <ProfileEvidenceRow key={candidate.id} profile={candidate} t={t} />
                ))}
                {recentlyTriggered.length === 0 && <p className="empty-state">{t.noCandidates}</p>}
              </div>
            </DataPanel>
            <DataPanel title={t.manualSearch} meta={t.searchScope}>
              <div className="form-grid">
                <label>
                  {t.keyword}
                  <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
                </label>
                <button
                  className="solid-button"
                  type="button"
                  onClick={() => {
                    setSelectedSearchIds([]);
                    void store.searchUsers(query);
                  }}
                >
                  <Search aria-hidden />
                  {t.search}
                </button>
              </div>
              <BulkToolbar
                allIds={store.searchResults.map((profile) => profile.id)}
                selectedIds={selectedSearchIds}
                selectedCount={selectedSearchProfiles.length}
                t={t}
                onSelectAll={setSelectedSearchIds}
                onQueue={() => queueProfiles(selectedSearchProfiles, false)}
                onQueueAndRun={() => queueProfiles(selectedSearchProfiles, true)}
              />
              <div className="compact-list">
                {store.searchResults.map((profile) => (
                  <SelectableProfileRow
                    key={profile.id}
                    profile={profile}
                    selected={selectedSearchIds.includes(profile.id)}
                    onSelected={(selected) =>
                      setSelectedSearchIds((current) =>
                        selected
                          ? Array.from(new Set([...current, profile.id]))
                          : current.filter((id) => id !== profile.id),
                      )
                    }
                    onAdd={() => void store.addManualCandidate(profile)}
                  />
                ))}
                {store.searchResults.length === 0 && <p className="empty-state">{t.noSearchResults}</p>}
              </div>
            </DataPanel>
          </div>
        )}

        {activeView === 'candidates' && (
          <DataPanel title={t.candidates} meta={`${selectedCandidateUsers.length} / ${candidateUsers.length}`}>
            <BulkToolbar
              allIds={candidateUsers.map((candidate) => candidate.id)}
              selectedIds={selectedCandidateIds}
              selectedCount={selectedCandidateUsers.length}
              t={t}
              onSelectAll={setSelectedCandidateIds}
              onQueue={() => queueCandidates(selectedCandidateUsers, false)}
              onDelete={deleteSelectedCandidates}
              onWhitelist={whitelistSelectedCandidates}
            />
            <CandidateTable
              candidates={candidateUsers}
              selectedIds={selectedCandidateIds}
              t={t}
              onToggleSelected={(id, selected) =>
                setSelectedCandidateIds((current) =>
                  selected
                    ? Array.from(new Set([...current, id]))
                    : current.filter((candidateId) => candidateId !== id),
                )
              }
              onQueue={store.addCandidateToQueue}
              onWhitelist={store.whitelistCandidate}
              onFalsePositive={store.markFalsePositive}
              onDelete={store.deleteCandidate}
            />
          </DataPanel>
        )}

        {activeView === 'rules' && settingsDraft && (
          <div className="stack">
            <DataPanel
              title={t.ruleMode}
              meta={`${settingsDraft.ruleExecutionMode === 'automatic' ? t.automatic : t.manual} / ${
                settingsDraft.rulesRunning ? t.start : t.stop
              }`}
            >
              <div className="toolbar">
                <select
                  className="toolbar-select"
                  value={settingsDraft.ruleExecutionMode}
                  onChange={(event) =>
                    saveSettings({
                      ...settingsDraft,
                      ruleExecutionMode: event.currentTarget.value as RuleExecutionMode,
                    })
                  }
                >
                  <option value="automatic">{t.automatic}</option>
                  <option value="manual">{t.manual}</option>
                </select>
                <button
                  className={settingsDraft.rulesRunning ? 'plain-button' : 'solid-button'}
                  type="button"
                  onClick={() => saveSettings({ ...settingsDraft, rulesRunning: !settingsDraft.rulesRunning })}
                >
                  {settingsDraft.rulesRunning ? <Pause aria-hidden /> : <Play aria-hidden />}
                  {settingsDraft.rulesRunning ? t.stop : t.start}
                </button>
                <button
                  className="solid-button"
                  type="button"
                  disabled={isRuleRunPending}
                  onClick={runRulesNow}
                >
                  {isRuleRunPending ? <Pause aria-hidden /> : <Play aria-hidden />}
                  {isRuleRunPending ? t.running : t.evaluateNow}
                </button>
                {ruleRunMessage && <span className="toolbar-status">{ruleRunMessage}</span>}
              </div>
            </DataPanel>

            {!ruleDraft.id && (
              <DataPanel title={t.newRule} meta={t.onePerLine}>
                <RuleEditor
                  draft={ruleDraft}
                  t={t}
                  onChange={setRuleDraft}
                  onSave={submitRule}
                  onCancel={() => setRuleDraft(emptyRule)}
                />
              </DataPanel>
            )}

            <DataPanel title={t.rules} meta={`${store.rules.length}`}>
              <div className="rules-list">
                {store.rules.map((rule) => (
                  <article className="rule-item" key={rule.id}>
                    {ruleDraft.id === rule.id ? (
                      <RuleEditor
                        draft={ruleDraft}
                        t={t}
                        onChange={setRuleDraft}
                        onSave={submitRule}
                        onCancel={() => setRuleDraft(emptyRule)}
                        onDelete={() => {
                          void store.deleteRule(rule.id).then(() => setRuleDraft(emptyRule));
                        }}
                      />
                    ) : (
                      <>
                        <div>
                          <strong>
                            {rule.type} / {getRuleLines(rule.content).length} {t.ruleLines}
                          </strong>
                          <small>
                            score {rule.score} / {rule.fields.map((field) => getFieldLabel(field, t)).join(', ')}
                          </small>
                        </div>
                        <div className="row-actions">
                          <label className="switch" title="Enable rule">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={(event) => void store.toggleRule(rule.id, event.currentTarget.checked)}
                            />
                            <span />
                          </label>
                          <button type="button" title={t.editRule} onClick={() => setRuleDraft(rule)}>
                            <SlidersHorizontal aria-hidden />
                          </button>
                          <button type="button" title="Delete rule" onClick={() => void store.deleteRule(rule.id)}>
                            <Trash2 aria-hidden />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </DataPanel>
          </div>
        )}

        {activeView === 'queue' && (
          <DataPanel
            title={t.queue}
            meta={`${selectedQueueItems.length} / ${queueItems.length} | ${t.blockMode}: ${
              store.settings?.blockAdapterMode === 'real' ? t.real : t.mock
            }`}
          >
            <div className="toolbar">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={queueItems.length > 0 && selectedQueueIds.length === queueItems.length}
                  onChange={(event) =>
                    setSelectedQueueIds(event.currentTarget.checked ? queueItems.map((item) => item.id) : [])
                  }
                />
                {t.selectAll}
              </label>
              <button
                className="solid-button"
                type="button"
                disabled={isQueueRunPending}
                title={getQueueSettingsHint()}
                onClick={() => runQueueNow(false)}
              >
                {isQueueRunPending ? <Pause aria-hidden /> : <Play aria-hidden />}
                {isQueueRunPending ? t.running : t.runBatch}
              </button>
              <button
                className="plain-button"
                type="button"
                disabled={isQueueRunPending}
                title={t.manualBlockWarning}
                onClick={() => runQueueNow(true)}
              >
                <Play aria-hidden />
                {t.manualBlockNow}
              </button>
              {store.settings && <span className="toolbar-status">{getQueueSettingsHint()}</span>}
              {queueRunMessage && <span className="toolbar-status">{queueRunMessage}</span>}
              <button
                className="plain-button"
                type="button"
                onClick={() => void store.setQueuePaused(!store.settings?.queuePaused)}
              >
                {store.settings?.queuePaused ? <Play aria-hidden /> : <Pause aria-hidden />}
                {store.settings?.queuePaused ? t.start : t.stop}
              </button>
              <button
                className="plain-button"
                type="button"
                disabled={selectedQueueItems.length === 0}
                onClick={() => {
                  void store.removeQueueItems(selectedQueueIds).then(() => setSelectedQueueIds([]));
                }}
              >
                <Trash2 aria-hidden />
                {t.deleteSelected}
              </button>
              <button
                className="plain-button"
                type="button"
                disabled={selectedQueueItems.length === 0}
                onClick={() => {
                  void store.whitelistQueueItems(selectedQueueIds).then(() => setSelectedQueueIds([]));
                }}
              >
                <CheckCircle2 aria-hidden />
                {t.whitelistSelected}
              </button>
            </div>
            <QueueTable
              items={queueItems}
              selectedIds={selectedQueueIds}
              t={t}
              onToggleSelected={(id, selected) =>
                setSelectedQueueIds((current) =>
                  selected ? Array.from(new Set([...current, id])) : current.filter((itemId) => itemId !== id),
                )
              }
              onRemove={store.removeQueueItem}
            />
          </DataPanel>
        )}

        {activeView === 'blocked' && (
          <DataPanel title={t.blocked} meta={`${store.blockedUsers.length}`}>
            <div className="toolbar">
              <label className="toolbar-select">
                <span>{t.exportFormat}</span>
                <select
                  value={blockedExportFormat}
                  onChange={(event) => setBlockedExportFormat(event.currentTarget.value as BlockedExportFormat)}
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="ndjson">NDJSON</option>
                  <option value="sql">SQL</option>
                  <option value="txt">TXT</option>
                </select>
              </label>
              <button
                className="solid-button"
                type="button"
                disabled={store.blockedUsers.length === 0}
                onClick={() => exportBlockedUsers(store.blockedUsers, blockedExportFormat)}
              >
                <Download aria-hidden />
                {t.exportBlocked}
              </button>
            </div>
            <div className="compact-list">
              {store.blockedUsers.map((user) => (
                <div className="list-row evidence-row" key={user.id}>
                  <span className="profile-stack">
                    <ProfileIdentity profile={user} />
                    <small>
                      {t.followers}: {formatFollowers(user)} / {new Date(user.blockedAt).toLocaleString()}
                    </small>
                  </span>
                  <span className="mode-badge">{user.score ?? '-'}</span>
                </div>
              ))}
              {store.blockedUsers.length === 0 && <p className="empty-state">{t.queueEmpty}</p>}
            </div>
          </DataPanel>
        )}

        {activeView === 'whitelist' && (
          <DataPanel title={t.whitelist} meta={`${whitelistedUsers.length}`}>
            <div className="compact-list">
              {whitelistedUsers.map((candidate) => (
                <div className="list-row" key={candidate.id}>
                  <span>
                    <strong>@{candidate.username}</strong>
                    <small>{candidate.note || candidate.bio || candidate.profileUrl}</small>
                  </span>
                  <button
                    type="button"
                    title={t.restore}
                    onClick={() => void store.restoreCandidate(candidate.id)}
                  >
                    <RotateCcw aria-hidden />
                  </button>
                </div>
              ))}
              {whitelistedUsers.length === 0 && <p className="empty-state">{t.whitelistEmpty}</p>}
            </div>
          </DataPanel>
        )}

        {activeView === 'logs' && (
          <DataPanel title={t.logs} meta={`${store.logs.length}`}>
            <div className="toolbar">
              <button className="plain-button" type="button" onClick={() => void store.clearLogs()}>
                <Trash2 aria-hidden />
                {t.clearLogs}
              </button>
            </div>
            <div className="compact-list">
              {store.logs.map((log) => (
                <div className="list-row" key={log.id}>
                  <span>
                    <strong>{log.message}</strong>
                    <small>
                      {log.level} / {log.context || 'xshield'} / {new Date(log.createdAt).toLocaleString()}
                    </small>
                  </span>
                </div>
              ))}
              {store.logs.length === 0 && <p className="empty-state">{t.logsEmpty}</p>}
            </div>
          </DataPanel>
        )}

        {activeView === 'settings' && settingsDraft && (
          <DataPanel title={t.settings} meta={`${t.language} / ${t.ruleMode} / ${t.blockMode}`}>
            <div className="settings-grid">
              <label>
                {t.language}
                <select
                  value={settingsDraft.language}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, language: event.currentTarget.value as LanguageMode })
                  }
                >
                  <option value="system">{t.system}</option>
                  <option value="zh-CN">{t.languageSimplifiedChinese}</option>
                  <option value="zh-TW">{t.languageTraditionalChinese}</option>
                  <option value="ja">{t.languageJapanese}</option>
                  <option value="ko">{t.languageKorean}</option>
                  <option value="fr">{t.languageFrench}</option>
                  <option value="en">{t.languageEnglish}</option>
                </select>
              </label>
              <label>
                {t.ruleMode}
                <select
                  value={settingsDraft.ruleExecutionMode}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      ruleExecutionMode: event.currentTarget.value as RuleExecutionMode,
                    })
                  }
                >
                  <option value="automatic">{t.automatic}</option>
                  <option value="manual">{t.manual}</option>
                </select>
              </label>
              <label>
                {t.blockMode}
                <select
                  value={settingsDraft.blockAdapterMode}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      blockAdapterMode: event.currentTarget.value as BlockAdapterMode,
                    })
                  }
                >
                  <option value="mock">{t.mock}</option>
                  <option value="real">{t.real}</option>
                </select>
              </label>
              <NumberField
                label={t.scoreThreshold}
                value={settingsDraft.scoreThreshold}
                onChange={(value) => setSettingsDraft({ ...settingsDraft, scoreThreshold: value })}
              />
              <NumberField
                label={t.batchSize}
                value={settingsDraft.executorConfig.batchSize}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    executorConfig: { ...settingsDraft.executorConfig, batchSize: value },
                  })
                }
              />
              <NumberField
                label={t.intervalMinutes}
                value={settingsDraft.executorConfig.intervalMinutes}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    executorConfig: { ...settingsDraft.executorConfig, intervalMinutes: value },
                  })
                }
              />
              <NumberField
                label={t.jitterSeconds}
                value={settingsDraft.executorConfig.jitterSeconds}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    executorConfig: { ...settingsDraft.executorConfig, jitterSeconds: value },
                  })
                }
              />
              <NumberField
                label={t.maxRetries}
                value={settingsDraft.executorConfig.maxRetries}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    executorConfig: { ...settingsDraft.executorConfig, maxRetries: value },
                  })
                }
              />
              <NumberField
                label={t.cooldownMinutes}
                value={settingsDraft.executorConfig.cooldownMinutesAfterFailure}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    executorConfig: {
                      ...settingsDraft.executorConfig,
                      cooldownMinutesAfterFailure: value,
                    },
                  })
                }
              />
            </div>
            <div className="form-actions">
              <button className="solid-button" type="button" onClick={() => void store.updateSettings(settingsDraft)}>
                <Settings aria-hidden />
                {t.saveSettings}
              </button>
              <button
                className="plain-button"
                type="button"
                onClick={() =>
                  setSettingsDraft({
                    ...settingsDraft,
                    scoreThreshold: DEFAULT_SCORE_THRESHOLD,
                    executorConfig: DEFAULT_BLOCK_EXECUTOR_CONFIG,
                  })
                }
              >
                {t.resetDraft}
              </button>
            </div>
          </DataPanel>
        )}

        {activeView === 'help' && (
          <DataPanel title={helpManual.title} meta={PROJECT_INFO.name}>
            <div className="help-manual">
              <p className="help-intro">{helpManual.intro}</p>
              <div className="help-grid">
                {helpManual.sections.map((section) => (
                  <article className="help-section" key={section.title}>
                    <h3>{section.title}</h3>
                    <ul>
                      {section.body.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          </DataPanel>
        )}
        <footer className="app-footer">
          <span>
            {PROJECT_INFO.name} v{PROJECT_INFO.version} / {PROJECT_INFO.license}
          </span>
          <span>{PROJECT_INFO.copyright}</span>
          <a href={PROJECT_INFO.issuesUrl} target="_blank" rel="noreferrer">
            Feedback
          </a>
        </footer>
      </section>
    </main>
  );
}

function BulkToolbar({
  allIds,
  selectedIds,
  selectedCount,
  t,
  onSelectAll,
  onQueue,
  onQueueAndRun,
  onDelete,
  onWhitelist,
}: {
  allIds: string[];
  selectedIds: string[];
  selectedCount: number;
  t: Record<CopyKey, string>;
  onSelectAll: (ids: string[]) => void;
  onQueue: () => void;
  onQueueAndRun?: () => void;
  onDelete?: () => void;
  onWhitelist?: () => void;
}): JSX.Element {
  return (
    <div className="toolbar">
      <label className="check-label">
        <input
          type="checkbox"
          checked={allIds.length > 0 && selectedIds.length === allIds.length}
          onChange={(event) => onSelectAll(event.currentTarget.checked ? allIds : [])}
        />
        {t.selectAll}
      </label>
      <button className="plain-button" type="button" disabled={selectedCount === 0} onClick={onQueue}>
        <ListChecks aria-hidden />
        {t.queueSelected}
      </button>
      {onQueueAndRun && (
        <button className="solid-button" type="button" disabled={selectedCount === 0} onClick={onQueueAndRun}>
          <Ban aria-hidden />
          {t.queueAndRun}
        </button>
      )}
      {onDelete && (
        <button className="plain-button" type="button" disabled={selectedCount === 0} onClick={onDelete}>
          <Trash2 aria-hidden />
          {t.deleteSelected}
        </button>
      )}
      {onWhitelist && (
        <button className="plain-button" type="button" disabled={selectedCount === 0} onClick={onWhitelist}>
          <CheckCircle2 aria-hidden />
          {t.whitelistSelected}
        </button>
      )}
    </div>
  );
}

function RuleEditor({
  draft,
  t,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: RuleDraft;
  t: Record<CopyKey, string>;
  onChange: (draft: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}): JSX.Element {
  return (
    <div className="rule-form">
      <label>
        {t.ruleType}
        <select
          value={draft.type}
          onChange={(event) => onChange({ ...draft, type: event.currentTarget.value as RuleType })}
        >
          <option value="keyword">keyword</option>
          <option value="regex">regex</option>
        </select>
      </label>
      <label className="rule-content-field">
        {t.content}
        <textarea
          value={draft.content}
          placeholder={t.onePerLine}
          onChange={(event) => onChange({ ...draft, content: event.currentTarget.value })}
        />
      </label>
      <label>
        {t.score}
        <input
          min={1}
          max={100}
          type="number"
          value={draft.score}
          onChange={(event) => onChange({ ...draft, score: Number(event.currentTarget.value) })}
        />
      </label>
      <div className="field-group">
        {fields.map((field) => (
          <label className="check-label" key={field}>
            <input
              type="checkbox"
              checked={draft.fields.includes(field)}
              onChange={(event) => {
                const nextFields = event.currentTarget.checked
                  ? Array.from(new Set([...draft.fields, field]))
                  : draft.fields.filter((item) => item !== field);
                onChange({ ...draft, fields: nextFields });
              }}
            />
            {getFieldLabel(field, t)}
          </label>
        ))}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.caseSensitive}
          onChange={(event) => onChange({ ...draft, caseSensitive: event.currentTarget.checked })}
        />
        {t.caseSensitive}
      </label>
      <div className="form-actions">
        <button className="solid-button" type="button" onClick={onSave}>
          <Plus aria-hidden />
          {t.save}
        </button>
        <button className="plain-button" type="button" onClick={onCancel}>
          {t.cancel}
        </button>
        {onDelete && (
          <button className="plain-button" type="button" onClick={onDelete}>
            <Trash2 aria-hidden />
            {t.deleteRule}
          </button>
        )}
      </div>
    </div>
  );
}

function SelectableProfileRow({
  profile,
  selected,
  onSelected,
  onAdd,
}: {
  profile: XUserProfile;
  selected: boolean;
  onSelected: (selected: boolean) => void;
  onAdd: () => void;
}): JSX.Element {
  return (
    <div className="list-row">
      <ProfileIdentity profile={profile} selectable selected={selected} onSelected={onSelected} />
      <button type="button" onClick={onAdd}>
        <Plus aria-hidden />
      </button>
    </div>
  );
}

function CandidateTable({
  candidates,
  selectedIds,
  t,
  onToggleSelected,
  onQueue,
  onWhitelist,
  onFalsePositive,
  onDelete,
}: {
  candidates: CandidateUser[];
  selectedIds: string[];
  t: Record<CopyKey, string>;
  onToggleSelected: (id: string, selected: boolean) => void;
  onQueue: (candidate: CandidateUser) => Promise<void>;
  onWhitelist: (id: string) => Promise<void>;
  onFalsePositive: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className="table evidence-table candidate-table">
      <div className="table-row table-head">
        <span>User</span>
        <span>{t.score}</span>
        <span>{t.followers}</span>
        <span>{t.matched}</span>
        <span>{t.actions}</span>
      </div>
      {candidates.map((candidate) => (
        <div className="table-row" key={candidate.id}>
          <span>
            <ProfileIdentity
              profile={candidate}
              selectable
              selected={selectedIds.includes(candidate.id)}
              onSelected={(selected) => onToggleSelected(candidate.id, selected)}
            />
          </span>
          <span>{candidate.score}</span>
          <span>{formatFollowers(candidate)}</span>
          <span>
            <span className="status-pill">{candidate.status}</span>
            <small>{getTriggerSummary(candidate)}</small>
          </span>
          <span className="row-actions">
            <button type="button" title="Add to block queue" onClick={() => void onQueue(candidate)}>
              <Ban aria-hidden />
            </button>
            <button type="button" title="Whitelist" onClick={() => void onWhitelist(candidate.id)}>
              <CheckCircle2 aria-hidden />
            </button>
            <button type="button" title={t.falsePositive} onClick={() => void onFalsePositive(candidate.id)}>
              <RotateCcw aria-hidden />
            </button>
            <button type="button" title="Delete" onClick={() => void onDelete(candidate.id)}>
              <Trash2 aria-hidden />
            </button>
          </span>
        </div>
      ))}
      {candidates.length === 0 && <p className="empty-state">{t.noCandidates}</p>}
    </div>
  );
}

function QueueTable({
  items,
  selectedIds,
  t,
  onToggleSelected,
  onRemove,
}: {
  items: BlockQueueItem[];
  selectedIds: string[];
  t: Record<CopyKey, string>;
  onToggleSelected: (id: string, selected: boolean) => void;
  onRemove: (id: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className="table evidence-table queue-table">
      <div className="table-row table-head">
        <span>User</span>
        <span>{t.status}</span>
        <span>{t.followers}</span>
        <span>{t.matched}</span>
        <span>{t.actions}</span>
      </div>
      {items.map((item) => (
        <div className="table-row" key={item.id}>
          <span>
            <ProfileIdentity
              profile={item}
              selectable
              selected={selectedIds.includes(item.id)}
              onSelected={(selected) => onToggleSelected(item.id, selected)}
            />
          </span>
          <span>
            <span className="status-pill">{item.status}</span>
            <small>
              {t.retries}: {item.retryCount}
            </small>
            <small>{item.lastError || ''}</small>
          </span>
          <span>{formatFollowers(item)}</span>
          <span>
            <small>{item.triggerReason || item.matchedRules?.join(', ') || '-'}</small>
          </span>
          <span className="row-actions">
            <button type="button" title="Remove item" onClick={() => void onRemove(item.id)}>
              <Trash2 aria-hidden />
            </button>
          </span>
        </div>
      ))}
      {items.length === 0 && <p className="empty-state">{t.queueEmpty}</p>}
    </div>
  );
}

function ProfileEvidenceRow({
  profile,
  t,
}: {
  profile: CandidateUser;
  t: Record<CopyKey, string>;
}): JSX.Element {
  return (
    <div className="list-row evidence-row">
      <span className="profile-stack">
        <ProfileIdentity profile={profile} />
        <small>
          {t.followers}: {formatFollowers(profile)} / {t.matched}: {getTriggerSummary(profile)}
        </small>
      </span>
      <span className="mode-badge">{profile.score}</span>
    </div>
  );
}

function DataPanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <span>{meta}</span>
      </div>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      {label}
      <input min={0} type="number" value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
    </label>
  );
}
