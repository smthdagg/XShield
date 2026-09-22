/**
 * 命中呈现层（1.7.0 模块化拆分）：判定状态条 + 误判恢复面板 + 隐藏登记表。
 *
 * 职责边界 —— 本模块只负责「一条回帖被判定为垃圾/正常之后，在页面上长什么样、
 * 用户可以做什么」；是否拉黑由 index.ts 的记录管道（recordSpam → 后台队列）与
 * 两个命中处理开关（keywordAutoBlock / aiAutoBlock）决定。
 *
 * 模块内持有：会话级人工纠错状态（aiSessionUnhidden / aiAuthorIgnored）、
 * 隐藏登记表（hiddenRegistry，供误判面板汇总）。宿主（index.ts）通过
 * initHitPresentation 注入依赖，避免循环引用：
 *   - isAlive / isHighlightMode / stateOf / isWhitelisted：读宿主状态；
 *   - markCaught / renderHud：HUD 统计；
 *   - hasSentId / trackSentId / sendRecords / removeSpamRecord：触发记录管道。
 *
 * 所有 DOM 写入均做变更门控（幂等），与 MutationObserver 重扫互不触发。
 */

export type BarTone =
  | 'porn'
  | 'scam'
  | 'ad'
  | 'bot'
  | 'normal'
  | 'pending'
  | 'keyword'
  | 'suspicious';

export interface BarInfo {
  /** 触发记录 / hiddenRegistry 的 uniqueId。 */
  id: string;
  verdict: string;
  confidence: number | null;
  tone: BarTone;
  /** 当前是否判定为垃圾（决定 [垃圾]/[正常] 的高亮态）。 */
  spam: boolean;
  /** 内容当前是否收起（隐藏态）。 */
  hidden: boolean;
  handle: string;
  displayName: string;
  /** 完整规范化文本（记录/摘要用）。 */
  text: string;
  /** 左缘色条 / 类别着色，形如 '--porn'；null 为中性。 */
  accent: string | null;
}

export interface HitPresentationDeps {
  isAlive(): boolean;
  isHighlightMode(): boolean;
  stateOf(tweet: Element): Record<string, unknown> | undefined;
  isWhitelisted(handle: string): boolean;
  markCaught(id: string): void;
  renderHud(): void;
  hasSentId(id: string): boolean;
  trackSentId(id: string): void;
  sendRecords(items: Array<Record<string, unknown>>): void;
  removeSpamRecord(id: string): void;
  /** 本地学习回路：人工确认后提取特征关键词进词库。 */
  learnKeywords(text: string, nickname: string): void;
}

let deps: HitPresentationDeps | null = null;

export function initHitPresentation(d: HitPresentationDeps): void {
  deps = d;
}

function requireDeps(): HitPresentationDeps {
  if (!deps) throw new Error('hitPresentation: initHitPresentation 未调用');
  return deps;
}

// ---- 判定记忆：同一条回帖（uniqueId）本会话只判一次；翻回已读内容时
// 直接恢复状态条与折叠态，不发第二次请求、不浪费 token。----
const verdictMemory = new Map<string, BarInfo>();
const VERDICT_MEMORY_MAX = 3000;

function rememberVerdict(info: BarInfo): void {
  if (info.tone === 'pending') return;
  verdictMemory.set(info.id, info);
  if (verdictMemory.size > VERDICT_MEMORY_MAX) {
    for (const id of Array.from(verdictMemory.keys()).slice(0, VERDICT_MEMORY_MAX / 10)) {
      verdictMemory.delete(id);
    }
  }
}

// ---- 延迟自动收起：垃圾判定后先淡粉标记可见（用户看到触发过程），
// 短暂展示后自动收起。手动操作（隐藏/垃圾/正常/白名单）取消定时并立即生效。----
const COLLAPSE_DELAY_MS = 1500;
const pendingCollapse = new Map<Element, { timer: number; id: string }>();

export function cancelScheduledCollapse(tweet: Element): void {
  const pending = pendingCollapse.get(tweet);
  if (pending) {
    window.clearTimeout(pending.timer);
    pendingCollapse.delete(tweet);
  }
}

function scheduleCollapse(tweet: Element, info: BarInfo): void {
  cancelScheduledCollapse(tweet);
  const timer = window.setTimeout(() => {
    pendingCollapse.delete(tweet);
    const d = requireDeps();
    const state = d.stateOf(tweet);
    // 定时到点时内容已被换掉/撤回/手动显示 → 不收起。
    if (!state || !tweet.isConnected) return;
    const current = state.aiBar as BarInfo | undefined;
    if (!current || current.id !== info.id || !current.hidden || state.deferCollapse !== true) {
      return;
    }
    state.deferCollapse = false;
    tweet.classList.remove('xshield-marked');
    tweet.classList.add('xshield-collapsed');
  }, COLLAPSE_DELAY_MS);
  pendingCollapse.set(tweet, { timer, id: info.id });
}

/**
 * 垃圾命中的统一呈现：先淡粉标记可见（用户看到触发过程），短暂展示后
 * 自动收起；高亮模式内容常驻可见。手动操作随时取消定时并立即生效。
 */
export function applySpamPresentation(tweet: Element, info: BarInfo): void {
  const d = requireDeps();
  const state = d.stateOf(tweet);
  if (!state) return; // 呈现依赖状态表；无状态的 cell 不可能走过判定流
  // 配色归配色、隐藏归隐藏：两种配色（淡粉/黄色高亮）都走 标记→1.5s→自动收起。
  if (!d.isHighlightMode()) tweet.classList.remove('xshield-hit');
  tweet.classList.remove('x-comment-blocker-hidden');
  applyHitCategoryClass(tweet, info.accent);
  state.deferCollapse = true;
  tweet.classList.add('xshield-marked');
  scheduleCollapse(tweet, info);
  ensureBar(tweet, info);
}

/** 翻回已判定内容：从判定记忆恢复状态条与折叠态（不发任何请求）。 */
export function applyRemembered(tweet: Element, id: string): boolean {
  const d = requireDeps();
  const info = verdictMemory.get(id);
  if (!info) return false;
  const state = d.stateOf(tweet);
  if (!state) return false;
  if (info.spam) {
    applyHitCategoryClass(tweet, info.accent);
    if (!d.isHighlightMode()) tweet.classList.remove('xshield-hit');
    state.deferCollapse = false;
    tweet.classList.add('xshield-collapsed');
    tweet.classList.remove('xshield-marked');
  } else {
    tweet.classList.remove('xshield-collapsed');
  }
  state.isSpam = info.spam;
  state.aiBar = info;
  state.aiPending = false;
  ensureBar(tweet, info);
  return true;
}

// ---- 会话级人工纠错状态 ----
/** 用户点过「正常/恢复显示」的 uniqueId（本次会话不再隐藏）。 */
const aiSessionUnhidden = new Set<string>();
/** 用户标记「误判」的作者（本次会话不再判定、不再隐藏）。 */
const aiAuthorIgnored = new Set<string>();

export function isSessionUnhidden(id: string): boolean {
  return aiSessionUnhidden.has(id);
}

export function isAuthorIgnored(handle: string): boolean {
  return Boolean(handle) && aiAuthorIgnored.has(handle);
}

/**
 * 高亮模式按类别着色（左缘色条 + 浅色底）；隐藏模式下类不可见，仅保持
 * DOM 状态一致。modifier 形如 '--porn'；null 表示中性/清除。
 */
export function applyHitCategoryClass(tweet: Element, modifier: string | null): void {
  for (const cls of Array.from(tweet.classList)) {
    if (cls.startsWith('xshield-hit--')) tweet.classList.remove(cls);
  }
  if (modifier) {
    tweet.classList.add(`xshield-hit${modifier}`);
  }
}

// ---- 隐藏登记表 + 误判恢复面板 ----

interface HiddenEntry {
  id: string;
  handle: string;
  displayName: string;
  text: string;
  tag: string;
  tagClass: string;
  time: number;
  el: Element | null;
}

const hiddenRegistry = new Map<string, HiddenEntry>();

export function pruneDisconnectedHidden(): void {
  if (hiddenRegistry.size === 0) return;
  for (const [id, entry] of hiddenRegistry) {
    if (entry.el && !entry.el.isConnected) hiddenRegistry.delete(id);
  }
}

/** 登记一条被隐藏的回复（误判面板数据源）。 */
export function registerHidden(entry: HiddenEntry): void {
  if (aiSessionUnhidden.has(entry.id) || isAuthorIgnored(entry.handle)) {
    return;
  }
  hiddenRegistry.set(entry.id, entry);
  if (hiddenRegistry.size > 300) {
    for (const id of Array.from(hiddenRegistry.keys()).slice(0, hiddenRegistry.size - 300)) {
      hiddenRegistry.delete(id);
    }
  }
  renderReviewChip();
}

export function renderReviewChip(): void {
  const d = requireDeps();
  if (!d.isAlive()) return;
  pruneDisconnectedHidden();
  const count = hiddenRegistry.size;
  const chip = document.getElementById('xshield-review-chip');
  if (count === 0) {
    chip?.remove();
    document.getElementById('xshield-review-panel')?.remove();
    return;
  }
  if (chip instanceof HTMLButtonElement) {
    chip.textContent = `🛡 X护盾 · 已隐藏 ${count} 条`;
    return;
  }
  const created = document.createElement('button');
  created.id = 'xshield-review-chip';
  created.type = 'button';
  created.textContent = `🛡 X护盾 · 已隐藏 ${count} 条`;
  created.addEventListener('click', () => renderReviewPanel());
  document.body.appendChild(created);
}

function renderReviewPanel(): void {
  document.getElementById('xshield-review-panel')?.remove();
  const panel = document.createElement('div');
  panel.id = 'xshield-review-panel';
  const title = document.createElement('div');
  title.className = 'xshield-review-title';
  title.textContent = '误判检查 · 「恢复显示」撤回隐藏并退出待拉黑';
  panel.appendChild(title);
  const list = document.createElement('div');
  list.className = 'xshield-review-list';
  const entries = Array.from(hiddenRegistry.values())
    .sort((a, b) => b.time - a.time)
    .slice(0, 80);
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'xshield-review-row';
    const head = document.createElement('div');
    head.className = 'xshield-review-head';
    const tag = document.createElement('span');
    tag.className = `xshield-ai-badge xshield-ai-badge${entry.tagClass}`;
    tag.textContent = entry.tag;
    const who = document.createElement('span');
    who.className = 'xshield-review-who';
    who.textContent = `${entry.displayName || entry.handle || '未知用户'}${
      entry.handle ? ` @${entry.handle}` : ''
    }`;
    head.append(tag, who);
    const text = document.createElement('div');
    text.className = 'xshield-review-text';
    text.textContent = entry.text ? entry.text.slice(0, 120) : '（无文本内容）';
    const actions = document.createElement('div');
    actions.className = 'xshield-review-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = '恢复显示';
    restore.addEventListener('click', () => {
      restoreHiddenEntry(entry.id);
      renderReviewPanel();
    });
    actions.appendChild(restore);
    if (entry.handle) {
      const whitelist = document.createElement('button');
      whitelist.type = 'button';
      whitelist.textContent = '白名单';
      whitelist.title = '撤回隐藏，并将该用户加入白名单（永不触发）';
      whitelist.addEventListener('click', () => {
        whitelistHiddenEntry(entry.id);
        renderReviewPanel();
      });
      actions.appendChild(whitelist);
    }
    row.append(head, text, actions);
    list.appendChild(row);
  }
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'xshield-review-empty';
    empty.textContent = '当前页面没有已隐藏的回复。';
    list.appendChild(empty);
  }
  panel.appendChild(list);
  document.body.appendChild(panel);
}

/** 撤回一次隐藏：本次会话不再隐藏该内容，并撤回其触发记录（退出待拉黑）。 */
export function restoreHiddenEntry(id: string): void {
  const d = requireDeps();
  const entry = hiddenRegistry.get(id);
  if (!entry) return;
  aiSessionUnhidden.add(id);
  hiddenRegistry.delete(id);
  const el = entry.el;
  if (el?.isConnected) cancelScheduledCollapse(el);
  if (el && el.isConnected) {
    el.classList.remove(
      'x-comment-blocker-hidden',
      'x-comment-blocker-hidden-reply',
      'xshield-hit',
      'xshield-collapsed',
    );
    applyHitCategoryClass(el, null);
    // 恢复显示的淡入动画，让「撤回一次误判」有可感知的反馈。
    el.classList.add('xshield-restored');
    const state = d.stateOf(el);
    if (state) {
      state.isSpam = false;
      state.aiPending = false;
      // 状态条切换为「正常 · 人工确认」，保留人工纠错入口。
      const restoredBar: BarInfo = {
        id,
        verdict: '正常 · 人工确认',
        confidence: null,
        tone: 'normal',
        spam: false,
        hidden: false,
        handle: entry.handle,
        displayName: entry.displayName,
        text: entry.text,
        accent: null,
      };
      state.aiBar = restoredBar;
      ensureBar(el, restoredBar);
    }
  }
  d.removeSpamRecord(id);
  renderReviewChip();
}

/** 撤回隐藏 + 把作者加入白名单（storage 监听器会自动重扫并清理队列）。 */
function whitelistHiddenEntry(id: string): void {
  const entry = hiddenRegistry.get(id);
  if (!entry?.handle) {
    restoreHiddenEntry(id);
    return;
  }
  aiAuthorIgnored.add(entry.handle);
  void (async () => {
    const items = await chrome.storage.local.get({ whitelist: [] as string[] });
    const next = Array.from(new Set([...((items.whitelist as string[]) ?? []), entry.handle]));
    await chrome.storage.local.set({ whitelist: next });
  })().catch(() => {});
  restoreHiddenEntry(id);
}

// ---- 判定状态条 ----

export function removeBar(tweet: Element): void {
  tweet.querySelector(':scope > .xshield-bar')?.remove();
}

/** 收起 / 展开内容（状态条的 显示/隐藏 按钮）—— 以实际可见态为准。 */
function toggleBarHidden(tweet: Element): void {
  const d = requireDeps();
  const state = d.stateOf(tweet);
  const info = state?.aiBar as BarInfo | undefined;
  if (!state || !info || info.tone === 'pending') return;
  const currentlyVisible = !tweet.classList.contains('xshield-collapsed');
  // 用户手动操作 = 最终裁决：取消定时并清除延迟态，重扫不会还原。
  cancelScheduledCollapse(tweet);
  state.deferCollapse = false;
  tweet.classList.remove('xshield-marked');
  if (currentlyVisible) {
    info.hidden = true;
    tweet.classList.add('xshield-collapsed');
  } else {
    info.hidden = false;
    tweet.classList.remove('xshield-collapsed');
  }
  ensureBar(tweet, info);
}

/** 人工纠错：判定为正常 —— 撤回隐藏、退出待拉黑，本次会话不再隐藏。 */
function confirmBarNormal(tweet: Element): void {
  const d = requireDeps();
  const state = d.stateOf(tweet);
  const info = state?.aiBar as BarInfo | undefined;
  if (!state || !info || info.tone === 'pending') return;
  aiSessionUnhidden.add(info.id);
  if (info.handle) aiAuthorIgnored.add(info.handle);
  cancelScheduledCollapse(tweet);
  // 撤回触发记录（退出待拉黑队列），与误判面板「恢复显示」同语义。
  restoreHiddenEntry(info.id);
  info.verdict = '正常 · 人工确认';
  info.confidence = null;
  info.tone = 'normal';
  info.spam = false;
  info.hidden = false;
  info.accent = null;
  state.aiBar = info;
  state.isSpam = false;
  state.aiPending = false;
  state.deferCollapse = false;
  tweet.classList.remove('xshield-collapsed', 'xshield-hit', 'xshield-marked');
  applyHitCategoryClass(tweet, null);
  ensureBar(tweet, info);
}

/** 人工纠错：判定为垃圾 —— 收起并以「人工确认」写入触发记录（显式行为）。 */
function confirmBarSpam(tweet: Element): void {
  const d = requireDeps();
  const state = d.stateOf(tweet);
  const info = state?.aiBar as BarInfo | undefined;
  if (!state || !info || info.tone === 'pending') return;
  aiSessionUnhidden.delete(info.id);
  aiAuthorIgnored.delete(info.handle);
  info.verdict = '垃圾 · 人工确认';
  info.confidence = null;
  info.tone = 'keyword';
  info.spam = true;
  info.hidden = !d.isHighlightMode();
  info.accent = null;
  state.aiBar = info;
  state.isSpam = true;
  state.aiPending = false;
  cancelScheduledCollapse(tweet);
  state.deferCollapse = false; // 手动确认是最终裁决，重扫不得还原
  if (d.isHighlightMode()) {
    // 高亮模式：内容保持可见，状态条显示人工确认结果。
    tweet.classList.remove('xshield-collapsed', 'xshield-marked');
    tweet.classList.add('xshield-hit');
  } else {
    tweet.classList.remove('xshield-hit', 'xshield-marked');
    tweet.classList.add('xshield-collapsed');
  }
  applyHitCategoryClass(tweet, null);
  registerHidden({
    id: info.id,
    handle: info.handle,
    displayName: info.displayName,
    text: info.text,
    tag: '垃圾 · 人工确认',
    tagClass: '--pending',
    time: Date.now(),
    el: tweet,
  });
  d.markCaught(info.id);
  d.renderHud();
  // 手动点「垃圾」是显式确认，等同面板手动拉黑（不属于自动触发，
  // 不受命中处理开关约束）。
  if (!d.hasSentId(info.id)) {
    d.trackSentId(info.id);
    d.sendRecords([
      {
        id: info.id,
        text: info.text,
        user: info.handle,
        displayName: info.displayName,
        reason: '人工确认',
        time: Date.now(),
        isAutoBlock: true,
      },
    ]);
  }
  // 本地学习回路：把这条确认内容的特征词喂给词库，下次同类内容秒触发。
  d.learnKeywords(info.text, info.displayName || info.handle);
  ensureBar(tweet, info);
}

/**
 * 在 cell 顶部维护状态条（幂等、变更门控；X 重渲染后由重扫路径补回）。
 * 状态条不在 tweetText 内，不参与文本扫描，不影响 quickHash。
 */
export function ensureBar(tweet: Element, info: BarInfo): void {
  rememberVerdict(info);
  let bar = tweet.querySelector<HTMLDivElement>(':scope > .xshield-bar');
  if (bar && !bar.querySelector('.xshield-bar-toggle')) {
    // 内部节点被 X 重渲染清掉过：整个重建。
    bar.remove();
    bar = null;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'xshield-bar';
    const verdict = document.createElement('span');
    verdict.className = 'xshield-bar-verdict';
    const text = document.createElement('span');
    text.className = 'xshield-bar-text';
    // X 对回帖点击有自己的跳转处理：按钮点击必须 stopPropagation，
    // 否则点击会冒泡触发跳转/被吞掉，表现为「点了没反应」。
    const stop = (e: Event): void => e.stopPropagation();
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'xshield-bar-toggle';
    toggle.addEventListener('click', (e) => {
      stop(e);
      toggleBarHidden(tweet);
    });
    const normal = document.createElement('button');
    normal.type = 'button';
    normal.className = 'xshield-bar-normal';
    normal.textContent = '正常';
    normal.title = '人工纠正：这是正常内容（撤回隐藏并退出待拉黑）';
    normal.addEventListener('click', (e) => {
      stop(e);
      confirmBarNormal(tweet);
    });
    const spam = document.createElement('button');
    spam.type = 'button';
    spam.className = 'xshield-bar-spam';
    spam.textContent = '垃圾';
    spam.title = '人工确认：这是垃圾内容（收起并进入待拉黑队列）';
    spam.addEventListener('click', (e) => {
      stop(e);
      confirmBarSpam(tweet);
    });
    bar.addEventListener('click', stop);
    bar.append(verdict, text, toggle, normal, spam);
    tweet.prepend(bar);
  }
  const pending = info.tone === 'pending';
  const verdict = bar.querySelector<HTMLSpanElement>('.xshield-bar-verdict');
  if (verdict) {
    const verdictClass = `xshield-bar-verdict xshield-bar--${info.tone}`;
    if (verdict.className !== verdictClass) verdict.className = verdictClass;
    const text = `${info.verdict}${
      info.confidence != null ? ` · ${Math.round(info.confidence * 100)}%` : ''
    }${pending ? '…' : ''}`;
    if (verdict.textContent !== text) verdict.textContent = text;
  }
  const textEl = bar.querySelector<HTMLSpanElement>('.xshield-bar-text');
  if (textEl) {
    // 收起时展示摘要（让隐藏态可读），展开时留空保持状态条纤细。
    const who = info.displayName || info.handle || '';
    const summary = info.hidden
      ? `已隐藏 ${who}${info.handle ? ` @${info.handle}` : ''}${
          info.text ? `：${info.text.slice(0, 60)}` : ''
        }`
      : '';
    if (textEl.textContent !== summary) textEl.textContent = summary;
  }
  const toggle = bar.querySelector<HTMLButtonElement>('.xshield-bar-toggle');
  if (toggle) {
    // 文案跟随实际可见态（延迟收起期间内容可见 → 显示「隐藏」）。
    const toggleText = tweet.classList.contains('xshield-collapsed') ? '显示' : '隐藏';
    if (toggle.textContent !== toggleText) toggle.textContent = toggleText;
    const show = pending ? 'none' : '';
    if (toggle.style.display !== show) toggle.style.display = show;
  }
  const normalBtn = bar.querySelector<HTMLButtonElement>('.xshield-bar-normal');
  if (normalBtn) {
    const show = pending ? 'none' : '';
    if (normalBtn.style.display !== show) normalBtn.style.display = show;
    const on = !pending && !info.spam;
    const cls = `xshield-bar-normal${on ? ' on' : ''}`;
    if (normalBtn.className !== cls) normalBtn.className = cls;
  }
  const spamBtn = bar.querySelector<HTMLButtonElement>('.xshield-bar-spam');
  if (spamBtn) {
    const show = pending ? 'none' : '';
    if (spamBtn.style.display !== show) spamBtn.style.display = show;
    const on = !pending && info.spam;
    const cls = `xshield-bar-spam${on ? ' on' : ''}`;
    if (spamBtn.className !== cls) spamBtn.className = cls;
  }
}
