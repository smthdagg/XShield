/**
 * Content script — ported 1:1 from X(Twitter) Comment Blocker 1.4.3 content.js.
 * Only deviations: Temporal -> Date.now(), iterator helpers use equivalent
 * array ops, and the module runs at top level instead of inside an IIFE.
 */
import {
  extractCleanScreenName,
  getStorageDefaults,
  invisibleCharsRegex,
  normalizeHitText,
  parseKeywords,
} from '../store/blockerStorage';
import { CATEGORY_LABELS, type AiDecision } from '../background/aiJudge';
import {
  applyHitCategoryClass,
  applyRemembered,
  applySpamPresentation,
  cancelScheduledCollapse,
  ensureBar,
  initHitPresentation,
  isAuthorIgnored,
  isSessionUnhidden,
  pruneDisconnectedHidden,
  registerHidden,
  removeBar,
  type BarInfo,
  type BarTone,
} from './hitPresentation';

let blockRegexes: RegExp[] = [];
let lastKeywordsKey = '';
let checkUsername = true;
let onlyComments = true;
let blockSpecialChars = false;
let blockEmoji = false;
let blockGrok = false;
let filterEnabled = true;
let communityHandleSet = new Set<string>();
let highlightMode = false;
/** 关键字引擎命中处理 (1.7.0)：false = 仅隐藏，不进自动拉黑队列。 */
let keywordAutoBlock = true;
let filterTimer: number | null = null;
let filterVersion = 0;
let whitelistSet = new Set<string>();
let observerFlushScheduled = false;
const localSentIds = new Set<string>();
const tweetStateMap = new WeakMap<Element, Record<string, unknown>>();

// ---- AI 判断引擎 (1.5.0) ----
/** AI 暂时不可用（限流/网络错误）后的退避窗口，期间回退关键字基础层。 */
const AI_RETRY_BACKOFF_MS = 60_000;
/** 引擎开关：'ai' 时启用 TypeSafe 判定（还需已配置 API Key）。 */
let aiMode = false;
let aiKeyPresent = false;
/** AI 是否扫描未命中关键字的干净回帖（关闭 = 只复核关键字命中，省配额）。 */
let aiScanAll = true;
let aiUnavailableUntil = 0;
/** 已发过判定请求的 uniqueId（防止延迟全量重扫重复请求）。 */
const aiRequested = new Set<string>();
interface AiContext {
  tweet: Element;
  textNode: Element | null;
  uniqueId: string;
  handle: string;
  displayName: string;
  userName: string;
  normalized: string;
  keywordHold: boolean;
  /** 词库命中的词（预筛信号，未命中为空数组）。 */
  keywordHits: string[];
}
// ---- live 状态框 (1.6.0)：半透明 HUD，参考 Slop Filter 卡片 ----
/** 后台随 AI 裁决回传的会话用量快照。 */
interface AiHudMeta {
  calls?: number;
  cacheHits?: number;
  tokens?: number;
  costUsd?: number;
  chars?: number;
  msPer10kChars?: number;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
}
const HUD_ID_CAP = 20000;
const hudState = {
  /** 已评估过的回帖（uniqueId 去重；超上限滚动清零并累加基数）。 */
  scannedIds: new Set<string>(),
  scannedOverflow: 0,
  /** 已拦截（关键字 + AI，含高亮模式标记）。 */
  caughtIds: new Set<string>(),
  caughtOverflow: 0,
  aiCalls: 0,
  aiCacheHits: 0,
  aiTokens: 0,
  aiCostUsd: 0,
  aiChars: 0,
  aiMsPer10k: 0,
  aiLatencySum: 0,
  lastLatency: 0,
};
interface HudRefs {
  root: HTMLDivElement;
  scanned: HTMLElement;
  caught: HTMLElement;
  latency: HTMLElement;
  tokens: HTMLElement;
  foot: HTMLElement;
  foot2: HTMLElement;
}
let hudRefs: HudRefs | null = null;
const emojiRegex = /\p{RGI_Emoji}/v;
const spamCharsRegex =
  // eslint-disable-next-line no-misleading-character-class
  /[\u02B0-\u02FF\u0F00-\u0FFF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2100-\u2BFF\uA980-\uA9DF\uAA00-\uAADF\u{13000}-\u{1342F}\u{1D400}-\u{1D7FF}]/v;

function isExtensionAlive(): boolean {
  return Boolean(chrome.runtime?.id);
}

/**
 * Track the logged-in account for the dashboard runtime-status card. X renders
 * the current user's profile as `AppTabBar_Profile_Link` in the primary nav;
 * fall back to any other `*_Link` nav entry whose href is a single handle
 * segment. Reports to the background only when the handle actually changes —
 * one message per account switch, not a per-tick stream.
 */
let lastReportedUser = '';
/** Throttle for the piggybacked user re-check inside the observer flush. */
let lastUserCheck = 0;

function detectCurrentUser(): void {
  const primary = document.querySelector<HTMLAnchorElement>(
    'a[data-testid="AppTabBar_Profile_Link"]',
  );
  let handle = '';
  if (primary) {
    handle = extractCleanScreenName(primary.getAttribute('href') ?? '');
  } else {
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const profileLink = nav
      ? Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[data-testid$="_Link"]')).find((a) => {
          const seg = (a.getAttribute('href') ?? '').split('?')[0].replace(/\/+$/, '');
          return /^\/[a-zA-Z0-9_]{1,15}$/.test(seg);
        })
      : null;
    handle = profileLink ? extractCleanScreenName(profileLink.getAttribute('href') ?? '') : '';
  }
  if (!handle || handle === lastReportedUser) return;
  lastReportedUser = handle;
  void chrome.runtime
    .sendMessage({
      action: 'reportCurrentUser',
      username: handle,
      seenAt: Date.now(),
    })
    .catch(() => {});
}

function matchesBlocklist(text: string): boolean {
  if (blockRegexes.length === 0) return false;
  return blockRegexes.some((regex) => regex.test(text));
}

/**
 * 提取命中的词库片段（最多 5 个）作为 AI 判定的预筛信号 —— 词库本身是
 * 长期维护的垃圾话术库，把它喂给模型，AI 才能理解「福不黑」这类暗语是黄推。
 */
function findKeywordMatches(text: string): string[] {
  if (blockRegexes.length === 0) return [];
  const hits: string[] = [];
  for (const regex of blockRegexes) {
    const m = text.match(regex);
    if (m?.[0] && !hits.includes(m[0])) hits.push(m[0]);
    if (hits.length >= 5) break;
  }
  return hits;
}

function buildTrieRegex(plainKeywords: string[]): RegExp | null {
  if (!plainKeywords?.length) return null;
  const seen = new Set<string>();
  const MAX_KEYWORD_LENGTH = 1000;
  for (const kw of plainKeywords) {
    if (typeof kw !== 'string') continue;
    const cleaned = kw.trim().toLowerCase();
    if (cleaned && cleaned.length <= MAX_KEYWORD_LENGTH) seen.add(cleaned);
  }
  if (!seen.size) return null;
  const sorted = Array.from(seen).sort((a, b) => a.length - b.length);

  const pruned: string[] = [];
  for (const kw of sorted) {
    if (!pruned.some((p) => kw.includes(p))) pruned.push(kw);
  }

  const root: Record<string, unknown> = {};
  for (const kw of pruned) {
    let node = root;
    for (const ch of kw) {
      const next = (node[ch] ??= {}) as Record<string, unknown>;
      node = next;
    }
  }

  const escapeChar = (c: string) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c);
  function stringify(node: Record<string, unknown>): string {
    const keys = Object.keys(node);
    if (!keys.length) return '';
    const branches = keys.map((k) => escapeChar(k) + stringify(node[k] as Record<string, unknown>));
    return branches.length > 1 ? `(?:${branches.join('|')})` : branches[0];
  }

  return new RegExp(stringify(root), 'iu');
}

function buildRegexes(keywords: string[]): RegExp[] {
  if (!keywords || keywords.length === 0) return [];
  const plainKeywords: string[] = [];
  const customRegexes: RegExp[] = [];

  for (const kw of keywords) {
    const match = kw.startsWith('/') ? kw.match(/^\/(?<pattern>.+)\/(?<flags>[a-zA-Z]*)$/) : null;
    if (match) {
      try {
        const cleanFlags = (match.groups?.flags ?? '').replace(/[gy]/g, '');
        customRegexes.push(new RegExp(match.groups?.pattern ?? '', cleanFlags));
      } catch (e) {
        console.warn('[X-Blocker] Invalid regex ignored:', kw, e);
      }
    } else {
      plainKeywords.push(kw);
    }
  }

  const regexes: RegExp[] = [];
  if (plainKeywords.length > 0) {
    const trieRegex = buildTrieRegex(plainKeywords);
    if (trieRegex) regexes.push(trieRegex);
  }
  if (customRegexes.length > 0) {
    regexes.push(...customRegexes);
  }
  return regexes;
}

async function mergeKeywords(): Promise<void> {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults('keywords', 'cloudEnabled', 'cloudKeywords', 'disabledCloudKeywords'),
    );

    const userKws = parseKeywords((items.keywords as string) ?? '');
    const disabledCloudKws = (items.disabledCloudKeywords as string[]) ?? [];
    const disabledSet = new Set(disabledCloudKws);
    const cloudKws = items.cloudEnabled
      ? parseKeywords((items.cloudKeywords as string) ?? '').filter((k) => !disabledSet.has(k))
      : [];

    const blockKeywords = Array.from(new Set([...cloudKws, ...userKws]));

    const newKey = blockKeywords.join('\n');
    if (newKey === lastKeywordsKey) return;
    lastKeywordsKey = newKey;

    blockRegexes = buildRegexes(blockKeywords);
  } catch (e) {
    console.error('[X-Blocker] mergeKeywords error:', e);
  }
}

function getTweetTextForKeywords(node: Element | null): string {
  if (!node) return '';
  let text = '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let currentNode: Node | null = walker.currentNode;
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      // AI 徽标是我们自己注入的节点：不计入文本，否则会污染关键字匹配，
      // 还会让 quickHash 在「加徽标 → 文本变化 → 重扫」之间来回抖动。
      const parent = currentNode.parentElement;
      if (!(parent instanceof HTMLElement && parent.classList.contains('xshield-ai-badge'))) {
        text += currentNode.textContent ?? '';
      }
    } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
      const el = currentNode as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      if (['br', 'div', 'p'].includes(tagName)) {
        if (text && !text.endsWith('\n')) text += '\n';
      } else if (tagName === 'img') {
        const imgEl = el as HTMLImageElement;
        if (!imgEl.alt) {
          // no alt text
        } else {
          let altText = imgEl.alt;
          if (
            imgEl.src &&
            (imgEl.src.includes('emoji') || imgEl.src.includes('twemoji')) &&
            !altText.endsWith('\uFE0F')
          ) {
            if (altText.length <= 2) {
              altText += '\uFE0F';
            }
          }
          text += altText;
        }
      }
    }
    currentNode = walker.nextNode();
  }
  return text;
}

function hasEmoji(node: Element | null): boolean {
  if (!node) return false;

  if (emojiRegex.test(node.textContent ?? '')) return true;

  return Array.from(node.querySelectorAll('img')).some((img) => {
    const src = (img as HTMLImageElement).src ?? '';
    if (src.includes('emoji') || src.includes('twemoji')) return true;
    return emojiRegex.test(img.alt ?? '');
  });
}

function getTweetStatusInfo(
  tweet: Element,
  pageStatusId: string | null,
): { id: string | null; isMainTweet: boolean } {
  for (const timeEl of Array.from(tweet.querySelectorAll('time'))) {
    const href = timeEl.closest('a')?.getAttribute('href') ?? '';
    const m = href.match(/\/status\/(\d+)/iv);
    if (m) {
      return {
        id: m[1],
        isMainTweet: pageStatusId ? m[1] === pageStatusId : false,
      };
    }
  }
  return { id: null, isMainTweet: false };
}

function getPageContext(): { pageStatusId: string | null; isPhotoVideoOverlay: boolean } {
  const urlMatch = window.location.pathname.match(/\/status\/(\d+)/iv);
  return {
    pageStatusId: urlMatch ? urlMatch[1] : null,
    isPhotoVideoOverlay: /\/status\/\d+\/(?:photo|video)\//iv.test(window.location.pathname),
  };
}

function resolveStatusPage(
  tweet: Element,
  pageContext: { pageStatusId: string | null; isPhotoVideoOverlay: boolean },
): boolean {
  if (pageContext.isPhotoVideoOverlay) {
    if (tweet.closest('[role="dialog"]') !== null) return true;
    const state = tweetStateMap.get(tweet);
    if (state && state.isStatusPage !== undefined) return Boolean(state.isStatusPage);
    return false;
  }
  return Boolean(pageContext.pageStatusId);
}

function hasGrokCard(tweet: Element): boolean {
  if (!tweet) return false;
  return Boolean(tweet.querySelector('a[href*="/i/grok/share"], meta[content*="/i/grok/share"]'));
}

interface SpamDecision {
  isSpam: boolean;
  isAutoBlock?: boolean;
  blockReason?: string;
  userName?: string;
  stableHandle?: string;
  displayName?: string;
}

function detectSpam(
  tweet: Element,
  textNode: Element | null,
  userNode: Element | null,
  rawTweetText: string,
  userName: string,
  isStatusPage: boolean,
  isMainTweet: boolean,
): SpamDecision {
  const tweetBody = rawTweetText.replaceAll(invisibleCharsRegex, '');
  let stableHandle = '';
  let displayName = '';

  const handleLink = userNode?.querySelector('a[href^="/"]');
  if (handleLink) {
    const rawHref = handleLink.getAttribute('href') || '';
    stableHandle = extractCleanScreenName(rawHref);
    displayName = getTweetTextForKeywords(handleLink).replaceAll(invisibleCharsRegex, '').trim();
  }

  if (stableHandle && whitelistSet.has(stableHandle)) {
    return { isSpam: false };
  }

  // Community blocklist: handles shared through the project repository are
  // treated as confirmed spam sources and enter the pending flow directly.
  if (stableHandle && communityHandleSet.has(stableHandle)) {
    return {
      isSpam: true,
      isAutoBlock: true,
      blockReason: '社区共享',
      userName,
      stableHandle,
      displayName,
    };
  }

  if (blockGrok && hasGrokCard(tweet)) {
    return {
      isSpam: true,
      isAutoBlock: false,
      blockReason: 'Grok屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  if (isStatusPage && !isMainTweet) {
    if (blockEmoji && textNode && hasEmoji(textNode)) {
      return {
        isSpam: true,
        isAutoBlock: false,
        blockReason: '表情屏蔽',
        userName,
        stableHandle,
        displayName,
      };
    }
    if (blockSpecialChars && textNode && spamCharsRegex.test(textNode.textContent ?? '')) {
      return {
        isSpam: true,
        isAutoBlock: false,
        blockReason: '特殊字符屏蔽',
        userName,
        stableHandle,
        displayName,
      };
    }
  }

  const cleanUserName = userName
    ? userName.replaceAll(/[\s_.\-]+/gv, '').replaceAll(invisibleCharsRegex, '')
    : '';

  // Unified keyword model (0.6.0): every keyword hit enters the pending
  // queue; the user can still intervene during the grace window, otherwise
  // the auto-block program takes over.
  if (matchesBlocklist(tweetBody)) {
    return {
      isSpam: true,
      isAutoBlock: true,
      blockReason: '内容屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  if (
    checkUsername &&
    userName &&
    (matchesBlocklist(cleanUserName) ||
      matchesBlocklist(userName) ||
      matchesBlocklist(stableHandle))
  ) {
    return {
      isSpam: true,
      isAutoBlock: true,
      blockReason: '昵称屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  return { isSpam: false };
}

// ---------------------------------------------------------------------------
// AI 判断引擎 (1.5.0)：TypeSafe System One 判定、四类彩色标签、误判恢复面板。
// 关键字仍是基础信号；AI 模式下由 AI 对「是否隐藏 + 归类」做最终裁决。
// ---------------------------------------------------------------------------

function aiAvailable(): boolean {
  return aiMode && aiKeyPresent && Date.now() >= aiUnavailableUntil;
}

function buildAiContext(
  tweet: Element,
  textNode: Element | null,
  userNode: Element | null,
  rawTweetText: string,
  rawUserName: string,
  tweetId: string | null,
  keywordHold: boolean,
): AiContext {
  let handle = '';
  let displayName = '';
  const handleLink = userNode?.querySelector('a[href^="/"]');
  if (handleLink) {
    handle = extractCleanScreenName(handleLink.getAttribute('href') || '');
    displayName = getTweetTextForKeywords(handleLink).replaceAll(invisibleCharsRegex, '').trim();
  }
  const normalized = normalizeHitText(rawTweetText);
  // 词库命中片段：仅关键字命中时提取（干净回帖为空数组，省一次正则遍历）。
  const keywordHits = keywordHold ? findKeywordMatches(normalized) : [];
  return {
    tweet,
    textNode,
    uniqueId: tweetId ?? `${normalized}|${handle}`,
    handle,
    displayName,
    userName: rawUserName,
    normalized,
    keywordHold,
    keywordHits,
  };
}

/**
 * 向后台请求 AI 裁决并应用结果。请求按 uniqueId 去重（文本级去重/缓存/限速
 * 由后台 aiJudge 模块负责）；AI 不可用时回退关键字基础层。
 */
async function requestAiFor(ctx: AiContext, priority: boolean): Promise<void> {
  if (aiRequested.has(ctx.uniqueId)) return;
  aiRequested.add(ctx.uniqueId);
  if (aiRequested.size > 3000) {
    for (const val of Array.from(aiRequested).slice(0, 300)) aiRequested.delete(val);
  }
  if (!aiAvailable()) {
    onAiUnavailable(ctx, 'disabled');
    return;
  }
  try {
    const resp = (await chrome.runtime.sendMessage({
      action: 'aiJudge',
      text: ctx.normalized,
      keywords: ctx.keywordHits,
      author: ctx.displayName
        ? `${ctx.displayName}${ctx.handle ? `(@${ctx.handle})` : ''}`
        : ctx.handle,
      priority,
    })) as
      | {
          ok?: boolean;
          decision?: AiDecision;
          autoBlock?: boolean;
          reason?: string;
          meta?: AiHudMeta;
        }
      | undefined;
    if (!resp?.ok || !resp.decision) {
      onAiUnavailable(ctx, String(resp?.reason ?? 'network'));
      return;
    }
    hudNoteAi(resp.meta);
    applyAiVerdict(ctx, resp.decision, resp.autoBlock !== false);
    renderHud();
  } catch {
    onAiUnavailable(ctx, 'network');
  }
}

function applyAiVerdict(ctx: AiContext, decision: AiDecision, autoBlock: boolean): void {
  const { tweet } = ctx;
  const state = tweetStateMap.get(tweet);
  if (!tweet.isConnected) {
    // 虚拟列表已回收该 cell：垃圾判定仍要上报（内容确实出现过）。
    // 「仅隐藏」时同样写触发记录（isAutoBlock=false），保证触发记录页可见。
    if (decision.isSpam) reportAiSpam(ctx, decision.reason, autoBlock);
    return;
  }
  if (state) state.aiPending = false;
  const label = CATEGORY_LABELS[decision.category] ?? decision.category;
  const accent = `--${decision.category}`;
  // 关键字已即时触发的回帖：AI 只细化状态条分类（不重复记录），否决则撤回。
  const prevBar = state?.aiBar as BarInfo | undefined;
  const refineOnly = prevBar?.tone === 'keyword';
  // 手动恢复 / 已忽略作者 / 白名单 —— 都优先于模型裁决（按正常展示）。
  if (
    isSessionUnhidden(ctx.uniqueId) ||
    (Boolean(ctx.handle) && (isAuthorIgnored(ctx.handle) || whitelistSet.has(ctx.handle)))
  ) {
    if (state) {
      state.isSpam = false;
      state.aiBar = {
        id: ctx.uniqueId,
        verdict: '正常 · 人工确认',
        confidence: null,
        tone: 'normal',
        spam: false,
        hidden: false,
        handle: ctx.handle,
        displayName: ctx.displayName,
        text: ctx.normalized,
        accent: null,
      } satisfies BarInfo;
      tweet.classList.remove('xshield-collapsed', 'xshield-hit');
      applyHitCategoryClass(tweet, null);
      ensureBar(tweet, state.aiBar as BarInfo);
    }
    return;
  }
  if (refineOnly) {
    // 关键字触发在先：本条已隐藏+已记录，AI 只能「细化归类」，无权改判。
    const info = prevBar as BarInfo;
    if (decision.isSpam) {
      // 采纳 AI 的四类归类，状态条原位更新（内容保持收起）。
      info.verdict = `AI·${label}`;
      info.confidence = decision.confidence;
      info.tone = decision.category as BarTone;
      info.accent = accent;
      applyHitCategoryClass(tweet, accent);
    } else if (!info.verdict.includes('（AI 未确认）')) {
      // 词库是人工维护的真值：AI 说"正常"也不否决触发，只标注未确认。
      info.verdict = `${info.verdict}（AI 未确认）`;
    }
    ensureBar(tweet, info);
    return;
  }
  const barInfo: BarInfo = {
    id: ctx.uniqueId,
    verdict: decision.isSpam
      ? `AI·${label}`
      : decision.suspicious
        ? decision.category !== 'normal'
          ? `可疑·${label}`
          : '可疑'
        : '正常',
    confidence: decision.confidence,
    tone: decision.isSpam
      ? (decision.category as BarTone)
      : decision.suspicious
        ? 'suspicious'
        : 'normal',
    spam: decision.isSpam,
    hidden: decision.isSpam && !highlightMode,
    handle: ctx.handle,
    displayName: ctx.displayName,
    text: ctx.normalized,
    accent: decision.isSpam ? accent : null,
  };
  if (state) {
    state.isSpam = decision.isSpam;
    state.aiBar = barInfo;
  }
  if (decision.isSpam) {
    // 统一呈现：视口内先标记可见（看到判定过程），扫过去后自动收起。
    applySpamPresentation(tweet, barInfo);
    markCaught(ctx.uniqueId);
    registerHidden({
      id: ctx.uniqueId,
      handle: ctx.handle,
      displayName: ctx.displayName,
      text: ctx.normalized,
      tag: label,
      tagClass: accent,
      time: Date.now(),
      el: tweet,
    });
    // 「仅隐藏」也写触发记录（isAutoBlock=false）：触发记录页可见、可手动拉黑，
    // 但不会进入待拉黑队列，自动拉黑程序永远不会碰它。
    reportAiSpam(ctx, decision.reason, autoBlock);
  } else if (decision.suspicious) {
    // 可疑档（置信度未达阈值）：琥珀色提示，内容可见、不隐藏不上报，
    // 交由用户通过状态条按钮人工纠错 —— 置信度阈值由此可感知。
    tweet.classList.remove('x-comment-blocker-hidden', 'xshield-collapsed', 'xshield-hit');
    applyHitCategoryClass(tweet, null);
  } else {
    // 扫描型判定的否决：不隐藏、不上报，状态条显示正常结果。
    tweet.classList.remove('x-comment-blocker-hidden', 'xshield-collapsed', 'xshield-hit');
    applyHitCategoryClass(tweet, null);
  }
  if (state) ensureBar(tweet, barInfo);
}

/** AI 不可用（关闭/无 Key/限流/网络错误）：回退关键字基础层。 */
function onAiUnavailable(ctx: AiContext, reason: string): void {
  if (reason === 'disabled' || reason === 'nokey') {
    aiKeyPresent = false;
  } else {
    aiUnavailableUntil = Date.now() + AI_RETRY_BACKOFF_MS;
  }
  const { tweet } = ctx;
  if (!tweet.isConnected) return;
  const state = tweetStateMap.get(tweet);
  if (state) state.aiPending = false;
  if (!ctx.keywordHold) {
    // 扫描型请求失败：撤掉「AI 判定中」状态条，回退为普通展示。
    removeBar(tweet);
    if (state) state.aiBar = null;
    return;
  }
  // 关键字命中挂在 AI 上等裁决，AI 答不了 → 立即生效（隐藏模式为折叠状态条）。
  if (state) state.isSpam = true;
  const fallbackInfo: BarInfo = {
    id: ctx.uniqueId,
    verdict: '关键字',
    confidence: null,
    tone: 'keyword',
    spam: true,
    hidden: !highlightMode,
    handle: ctx.handle,
    displayName: ctx.displayName,
    text: ctx.normalized,
    accent: null,
  };
  if (state) state.aiBar = fallbackInfo;
  if (highlightMode) {
    // 高亮模式：内容可见，状态条保留。
    tweet.classList.remove('x-comment-blocker-hidden', 'xshield-collapsed');
    tweet.classList.add('xshield-hit');
    applyHitCategoryClass(tweet, null);
  } else {
    tweet.classList.remove('x-comment-blocker-hidden', 'xshield-hit');
    tweet.classList.add('xshield-collapsed');
    applyHitCategoryClass(tweet, null);
  }
  registerHidden({
    id: ctx.uniqueId,
    handle: ctx.handle,
    displayName: ctx.displayName,
    text: ctx.normalized,
    tag: '关键字',
    tagClass: '--pending',
    time: Date.now(),
    el: tweet,
  });
  ensureBar(tweet, fallbackInfo);
  markCaught(ctx.uniqueId);
  renderHud();
  reportAiSpam(ctx, '内容屏蔽', keywordAutoBlock);
}

function reportAiSpam(ctx: AiContext, reason: string, isAutoBlock: boolean): void {
  if (localSentIds.has(ctx.uniqueId)) return;
  localSentIds.add(ctx.uniqueId);
  if (localSentIds.size > 5000) {
    for (const val of Array.from(localSentIds).slice(0, 500)) localSentIds.delete(val);
  }
  try {
    void chrome.runtime
      .sendMessage({
        action: 'recordSpam',
        items: [
          {
            id: ctx.uniqueId,
            text: ctx.normalized,
            user: ctx.handle || ctx.userName,
            displayName: ctx.displayName || '',
            reason,
            time: Date.now(),
            isAutoBlock,
          },
        ],
      })
      .catch(() => {});
  } catch {
    // Extension context gone; nothing to do.
  }
}

async function refreshAiSettings(): Promise<void> {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults('aiEngine', 'aiApiKey', 'aiScanAll'),
    );
    aiMode = items.aiEngine === 'ai';
    aiKeyPresent = Boolean(items.aiApiKey);
    aiScanAll = items.aiScanAll !== false;
    aiRequested.clear();
  } catch {
    // 设置读取失败时保持现状。
  }
}

// ---- live 状态框（HUD）----

function markScanned(id: string): void {
  if (!id) return;
  if (hudState.scannedIds.size >= HUD_ID_CAP) {
    hudState.scannedOverflow += HUD_ID_CAP;
    hudState.scannedIds.clear();
  }
  hudState.scannedIds.add(id);
}

function markCaught(id: string): void {
  if (!id) return;
  if (hudState.caughtIds.size >= HUD_ID_CAP) {
    hudState.caughtOverflow += HUD_ID_CAP;
    hudState.caughtIds.clear();
  }
  hudState.caughtIds.add(id);
}

/** 采纳后台回传的会话用量快照（AI 调用数 / tokens / 延迟）。 */
function hudNoteAi(meta: AiHudMeta | undefined): void {
  if (!meta) return;
  const calls = Number(meta.calls ?? 0);
  const avgLatency = Number(meta.avgLatencyMs ?? 0);
  hudState.aiCalls = calls;
  hudState.aiCacheHits = Number(meta.cacheHits ?? 0);
  hudState.aiTokens = Number(meta.tokens ?? 0);
  hudState.aiCostUsd = Number(meta.costUsd ?? 0);
  hudState.aiChars = Number(meta.chars ?? 0);
  hudState.aiMsPer10k = Number(meta.msPer10kChars ?? 0);
  hudState.lastLatency = Number(meta.lastLatencyMs ?? 0);
  hudState.aiLatencySum = Math.round(avgLatency * calls);
}

/** 美元格式化：小额保留两位有效数字，正常金额两位小数。 */
function formatUsd(v: number): string {
  if (v <= 0) return '—';
  if (v < 0.01) return `$${Number(v.toPrecision(2))}`;
  return `$${v.toFixed(2)}`;
}

function hudSetText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function hudBuildTile(label: string): { wrap: HTMLDivElement; value: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'xshield-hud-tile';
  const value = document.createElement('strong');
  const caption = document.createElement('span');
  caption.textContent = label;
  wrap.append(value, caption);
  return { wrap, value };
}

function renderHud(): void {
  if (!isExtensionAlive()) return;
  if (!hudRefs) {
    const root = document.createElement('div');
    root.id = 'xshield-hud';
    const head = document.createElement('div');
    head.className = 'xshield-hud-head';
    const dot = document.createElement('span');
    dot.className = 'xshield-hud-dot';
    const title = document.createElement('span');
    title.className = 'xshield-hud-title';
    title.textContent = 'X护盾 · live';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'xshield-hud-reset';
    reset.textContent = 'reset';
    reset.title = '清零本次会话计数（后台 AI 用量同步清零）';
    reset.addEventListener('click', () => resetHud());
    head.append(dot, title, reset);
    const grid = document.createElement('div');
    grid.className = 'xshield-hud-grid';
    const scannedTile = hudBuildTile('已扫描回复');
    const caughtTile = hudBuildTile('已拦截垃圾');
    const latencyTile = hudBuildTile('最近判定');
    const tokensTile = hudBuildTile('AI 费用');
    grid.append(scannedTile.wrap, caughtTile.wrap, latencyTile.wrap, tokensTile.wrap);
    const foot = document.createElement('div');
    foot.className = 'xshield-hud-foot';
    const foot2 = document.createElement('div');
    foot2.className = 'xshield-hud-foot';
    root.append(head, grid, foot, foot2);
    document.body.appendChild(root);
    hudRefs = {
      root,
      scanned: scannedTile.value,
      caught: caughtTile.value,
      latency: latencyTile.value,
      tokens: tokensTile.value,
      foot,
      foot2,
    };
  }
  // 总开关关闭 → 整框隐藏；所有写入都做变更门控，避免与 MutationObserver 互相触发。
  const visible = filterEnabled;
  if (hudRefs.root.style.display !== (visible ? '' : 'none')) {
    hudRefs.root.style.display = visible ? '' : 'none';
  }
  if (!visible) return;
  const scanned = hudState.scannedOverflow + hudState.scannedIds.size;
  const caught = hudState.caughtOverflow + hudState.caughtIds.size;
  const pct = scanned > 0 ? Math.round((caught / scanned) * 100) : 0;
  hudSetText(hudRefs.scanned, String(scanned));
  hudSetText(hudRefs.caught, `${caught} (${pct}%)`);
  hudSetText(hudRefs.latency, hudState.aiCalls > 0 ? `${hudState.lastLatency} ms` : '—');
  hudSetText(hudRefs.tokens, hudState.aiCostUsd > 0 ? formatUsd(hudState.aiCostUsd) : '—');
  let footText: string;
  let foot2Text: string;
  if (hudState.aiCalls > 0 || hudState.aiCacheHits > 0) {
    const avg = Math.round(hudState.aiLatencySum / Math.max(1, hudState.aiCalls));
    // 官方定价：仅输入 token 计费（$42/Btok），费用按输入侧折算。
    const costPer1k = (hudState.aiCostUsd / Math.max(1, scanned)) * 1000;
    footText = `avg ${avg} ms · ${hudState.aiCalls} 次 AI 调用 · 缓存命中 ${hudState.aiCacheHits} 次`;
    foot2Text =
      `${hudState.aiTokens.toLocaleString('en-US')} tokens · ${formatUsd(hudState.aiCostUsd)} 累计 · ` +
      `${formatUsd(costPer1k)} / 1,000 回帖 · ` +
      `${hudState.aiMsPer10k.toLocaleString('en-US')} ms / 万字`;
  } else if (aiMode && aiKeyPresent) {
    footText = 'AI 引擎待命 · 出现命中内容后开始判定';
    foot2Text = '';
  } else {
    footText = '关键字引擎运行中 · 总设置可切换 AI 判断';
    foot2Text = '';
  }
  hudSetText(hudRefs.foot, footText);
  hudSetText(hudRefs.foot2, foot2Text);
}

function resetHud(): void {
  hudState.scannedIds.clear();
  hudState.scannedOverflow = 0;
  hudState.caughtIds.clear();
  hudState.caughtOverflow = 0;
  hudState.aiCalls = 0;
  hudState.aiCacheHits = 0;
  hudState.aiTokens = 0;
  hudState.aiCostUsd = 0;
  hudState.aiChars = 0;
  hudState.aiMsPer10k = 0;
  hudState.aiLatencySum = 0;
  hudState.lastLatency = 0;
  try {
    void chrome.runtime.sendMessage({ action: 'aiResetStats' }).catch(() => {});
  } catch {
    // Extension context gone.
  }
  renderHud();
}

function filterTweets(specificTweets: Element[] | null = null): void {
  if (!isExtensionAlive()) return;

  const tweets: Element[] =
    specificTweets || Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
  if (!tweets || tweets.length === 0) return;

  const pendingSpam: Array<Record<string, unknown>> = [];
  const pageContext = getPageContext();

  for (const tweet of tweets) {
    const userNode = tweet.querySelector('[data-testid="User-Name"]');
    const textNode = tweet.querySelector('[data-testid="tweetText"]');
    const isStatusPage = resolveStatusPage(tweet, pageContext);

    let state = tweetStateMap.get(tweet);
    if (!state) {
      state = {};
      tweetStateMap.set(tweet, state);
    }

    let logicalPageStatusId = pageContext.pageStatusId;
    if (pageContext.isPhotoVideoOverlay && tweet.closest('[role="dialog"]') === null) {
      logicalPageStatusId = (state.pageStatusId as string) ?? pageContext.pageStatusId;
    } else {
      state.pageStatusId = pageContext.pageStatusId;
    }
    state.isStatusPage = isStatusPage;

    const rawTweetText = textNode ? getTweetTextForKeywords(textNode) : '';
    const rawUserName = userNode ? getTweetTextForKeywords(userNode) : '';
    const hasGrok = blockGrok ? hasGrokCard(tweet) : false;

    const quickHash = `${rawTweetText}|${rawUserName}|${filterVersion}|${isStatusPage}|${logicalPageStatusId || ''}|${hasGrok}|${highlightMode}|${aiMode}|${aiScanAll}`;
    if (state.quickHash === quickHash) {
      if (state.isSpam) {
        tweet.classList.remove('x-comment-blocker-hidden-reply');
        const barInfo = state.aiBar as BarInfo | undefined;
        if (barInfo) {
          // 状态条模式：按当前 hidden 态补回 collapsed/状态条（X 重渲染自愈）。
          if (highlightMode) {
            // 高亮模式：内容可见，状态条保留。
            tweet.classList.remove('x-comment-blocker-hidden', 'xshield-collapsed');
            tweet.classList.add('xshield-hit');
          } else {
            tweet.classList.remove('x-comment-blocker-hidden', 'xshield-hit', 'xshield-marked');
            // 延迟隐藏中（用户还在看）保持展开；否则维持收起。
            if (barInfo.hidden && state.deferCollapse !== true) {
              tweet.classList.add('xshield-collapsed');
            } else {
              tweet.classList.remove('xshield-collapsed');
              if (barInfo.hidden) tweet.classList.add('xshield-marked');
            }
          }
          applyHitCategoryClass(tweet, barInfo.accent);
          ensureBar(tweet, barInfo);
        } else {
          // 无状态条信息的隐藏（历史状态兜底）：维持旧行为。
          if (highlightMode) {
            tweet.classList.remove('x-comment-blocker-hidden');
            tweet.classList.add('xshield-hit');
          } else {
            tweet.classList.remove('xshield-hit');
            tweet.classList.add('x-comment-blocker-hidden');
          }
          applyHitCategoryClass(tweet, null);
        }
      } else {
        tweet.classList.remove('x-comment-blocker-hidden', 'xshield-hit');
        applyHitCategoryClass(tweet, null);
        const barInfo = state.aiBar as BarInfo | undefined;
        // 用户手动收起（[隐藏]）的回帖在重扫时保持收起状态。
        if (barInfo?.hidden) tweet.classList.add('xshield-collapsed');
        else tweet.classList.remove('xshield-collapsed');
        if (state.aiPending) {
          ensureBar(tweet, {
            id: barInfo?.id ?? '',
            verdict: 'AI 判定中',
            confidence: null,
            tone: 'pending',
            spam: false,
            hidden: false,
            handle: barInfo?.handle ?? '',
            displayName: barInfo?.displayName ?? '',
            text: barInfo?.text ?? '',
            accent: null,
          });
        } else if (barInfo) {
          // AI 已判正常的回帖：状态条自愈补回。
          ensureBar(tweet, barInfo);
        }
      }
      continue;
    }

    if (tweet.closest('[aria-hidden="true"]')) continue;
    state.quickHash = quickHash;
    // X 的虚拟列表会复用 cell 元素：重处理前先清掉上一条内容的 AI 状态，
    // 否则残留的状态条/徽标会贴到毫不相干的干净回帖上。
    state.aiPending = false;
    state.aiBar = null;
    state.deferCollapse = false;
    // cell 可能被复用为新内容：必须取消上一个内容的延迟收起定时。
    cancelScheduledCollapse(tweet);
    tweet.classList.remove('xshield-collapsed', 'xshield-marked');
    removeBar(tweet);

    let shouldCheck =
      filterEnabled && (blockRegexes.length > 0 || blockEmoji || blockSpecialChars || blockGrok);
    if (shouldCheck && onlyComments && !isStatusPage) shouldCheck = false;

    let isMainTweet = false;
    let tweetId: string | null = null;
    if (shouldCheck) {
      const statusInfo = getTweetStatusInfo(tweet, logicalPageStatusId || null);
      tweetId = statusInfo.id;

      if (isStatusPage && logicalPageStatusId) {
        isMainTweet = statusInfo.isMainTweet;
        if (!tweet.querySelector('article')) {
          state.quickHash = '';
          continue;
        }
      }
    }

    if (shouldCheck && onlyComments && isMainTweet) shouldCheck = false;

    const spamResult = shouldCheck
      ? detectSpam(tweet, textNode, userNode, rawTweetText, rawUserName, isStatusPage, isMainTweet)
      : null;
    const localIsSpam = spamResult?.isSpam ?? false;
    const isTextKeywordHit = spamResult?.isSpam === true && spamResult.blockReason === '内容屏蔽';

    // HUD 计数：评估过的评论回帖（uniqueId 去重，重扫不重复计数）。
    if (shouldCheck && !isMainTweet) {
      markScanned(tweetId ?? `${rawTweetText.slice(0, 80)}|${rawUserName}`);
    }

    // ---- AI 判断引擎（1.5.0/1.7.0）----
    // 触发分层：关键字命中【立即触发】（标记+隐藏+记录，零等待，走下方
    // 关键字呈现路径），AI 以词库命中为上下文【随后细化】状态条的四类归类、
    // 或否决误报（撤回隐藏+退出待拉黑）；未命中关键字的干净回帖做一次静默
    // 扫描（aiScanAll，状态条显示判定过程）。社区名单 / 昵称 / Grok / 表情 /
    // 特殊字符等非文本规则不受影响，保持即时触发。
    const aiApplies = aiAvailable() && shouldCheck && Boolean(textNode) && !isMainTweet;
    let aiContext: AiContext | null = null;
    if (aiApplies) {
      aiContext = buildAiContext(
        tweet,
        textNode,
        userNode,
        rawTweetText,
        rawUserName,
        tweetId,
        isTextKeywordHit,
      );
      if (
        (Boolean(aiContext.handle) &&
          (whitelistSet.has(aiContext.handle) || isAuthorIgnored(aiContext.handle))) ||
        (!isTextKeywordHit && (!aiScanAll || !rawTweetText.trim()))
      ) {
        aiContext = null; // 白名单/已忽略作者不消耗 AI 配额；关闭扫描时不扫干净回帖
      }
    }
    if (aiContext && isTextKeywordHit) {
      // 词库命中即预筛信号：立即触发在先，AI 细化在后（零等待）。
      void requestAiFor(aiContext, true);
    }
    if (aiContext && !localIsSpam) {
      // 翻回已判定内容：从记忆恢复状态条/折叠态，不发第二次请求。
      if (applyRemembered(tweet, aiContext.uniqueId)) {
        // 已恢复；无需 pending/请求。
      } else if (!state.aiBar) {
        const scanInfo: BarInfo = {
          id: aiContext.uniqueId,
          verdict: 'AI 判定中',
          confidence: null,
          tone: 'pending',
          spam: false,
          hidden: false,
          handle: aiContext.handle,
          displayName: aiContext.displayName,
          text: aiContext.normalized,
          accent: null,
        };
        state.aiBar = scanInfo;
        ensureBar(tweet, scanInfo);
      }
      void requestAiFor(aiContext, false);
    }

    const isSpam = localIsSpam;

    state.isSpam = isSpam;
    if (isSpam) {
      const { isAutoBlock, blockReason, userName, stableHandle, displayName } =
        spamResult as SpamDecision;
      // 命中处理（1.7.0）：关键字引擎可选「仅隐藏」；社区共享名单始终进队列。
      const autoBlock = isAutoBlock === true && (keywordAutoBlock || blockReason === '社区共享');
      let normalizedBody = normalizeHitText(rawTweetText);

      if (blockReason === 'Grok屏蔽') {
        const grokMeta = tweet.querySelector(
          'a[href*="/i/grok/share"], meta[content*="/i/grok/share"]',
        );
        const grokLink = grokMeta
          ? grokMeta.getAttribute('content') || (grokMeta as HTMLAnchorElement).href
          : '';
        if (grokLink) {
          normalizedBody = normalizedBody ? `${normalizedBody}\n${grokLink}` : grokLink;
        }
      }

      const uniqueId = tweetId ?? `${normalizedBody}|${stableHandle}`;

      if (!localSentIds.has(uniqueId)) {
        localSentIds.add(uniqueId);
        if (localSentIds.size > 5000) {
          const toDelete = Array.from(localSentIds).slice(0, 500);
          for (const val of toDelete) {
            localSentIds.delete(val);
          }
        }

        pendingSpam.push({
          id: uniqueId,
          text: normalizedBody,
          user: stableHandle || userName,
          displayName: displayName || '',
          reason: blockReason,
          time: Date.now(),
          isAutoBlock: autoBlock,
        });
      }

      registerHidden({
        id: uniqueId,
        handle: stableHandle ?? '',
        displayName: displayName || '',
        text: normalizedBody,
        tag: blockReason ?? '',
        tagClass: '--pending',
        time: Date.now(),
        el: tweet,
      });
      markCaught(uniqueId);
      // 呈现（1.7.0）：高亮模式黄底可见；隐藏模式折叠 + 状态条（标明原因，
      // 可显示原文 / 人工纠错）—— 不再完全不可见。
      const keywordBar: BarInfo = {
        id: uniqueId,
        verdict: `关键字 · ${blockReason ?? '命中'}`,
        confidence: null,
        tone: 'keyword',
        spam: true,
        hidden: !highlightMode,
        handle: stableHandle ?? '',
        displayName: displayName || '',
        text: normalizedBody,
        accent: null,
      };
      state.aiBar = keywordBar;
      // 呈现（1.8.0）：视口内先淡粉标记可见，扫过去后自动收起；高亮模式常驻可见。
      applySpamPresentation(tweet, keywordBar);
    } else {
      const prev = tweet.previousElementSibling;
      let isHiddenReply = false;

      if (
        prev &&
        (prev.classList.contains('xshield-collapsed') ||
          prev.classList.contains('x-comment-blocker-hidden') ||
          prev.classList.contains('x-comment-blocker-hidden-reply'))
      ) {
        const hasThreadLine =
          Boolean(tweet.querySelector('div[style*="width: 2px"]')) ||
          Boolean(tweet.querySelector('[class*="r-1d2f490"]'));
        const hasReplyingTo = Boolean(tweet.querySelector('div[dir="ltr"] a[href^="/"]'));
        if (hasThreadLine || hasReplyingTo) {
          isHiddenReply = true;
        }
      }

      if (isHiddenReply) {
        tweet.classList.add('x-comment-blocker-hidden-reply');
      } else {
        tweet.classList.remove('x-comment-blocker-hidden-reply');
      }

      tweet.classList.remove(
        'x-comment-blocker-hidden',
        'xshield-hit',
        'xshield-collapsed',
        'xshield-marked',
      );
      state.aiBar = null;
      state.aiPending = false;
      state.deferCollapse = false;
      applyHitCategoryClass(tweet, null);
    }
  }

  pruneDisconnectedHidden();
  renderHud();

  if (pendingSpam.length > 0) {
    try {
      void chrome.runtime.sendMessage({ action: 'recordSpam', items: pendingSpam }).catch(() => {});
    } catch {
      // Extension context gone; nothing to do.
    }
  }
}

function scheduleFilter(): void {
  if (!isExtensionAlive()) return;
  if (filterTimer) cancelAnimationFrame(filterTimer);
  filterTimer = requestAnimationFrame(() => {
    filterTimer = null;
    filterTweets();
  });
}

// ---- 呈现层（hitPresentation）依赖注入：触发记录管道 + 宿主状态 ----

function sendRecords(items: Array<Record<string, unknown>>): void {
  try {
    void chrome.runtime.sendMessage({ action: 'recordSpam', items }).catch(() => {});
  } catch {
    // Extension context gone.
  }
}

function trackSentId(id: string): void {
  localSentIds.add(id);
  if (localSentIds.size > 5000) {
    for (const val of Array.from(localSentIds).slice(0, 500)) localSentIds.delete(val);
  }
}

function removeSpamRecordById(id: string): void {
  try {
    void chrome.runtime.sendMessage({ action: 'removeSpamRecord', id }).catch(() => {});
  } catch {
    // Extension context gone.
  }
}

async function init(): Promise<void> {
  initHitPresentation({
    isAlive: isExtensionAlive,
    isHighlightMode: () => highlightMode,
    stateOf: (tweet) => tweetStateMap.get(tweet),
    isWhitelisted: (handle) => whitelistSet.has(handle),
    markCaught,
    renderHud,
    hasSentId: (id) => localSentIds.has(id),
    trackSentId,
    sendRecords,
    removeSpamRecord: removeSpamRecordById,
    learnKeywords: (text, nickname) => {
      try {
        void chrome.runtime
          .sendMessage({ action: 'learnKeywords', text, nickname })
          .catch(() => {});
      } catch {
        // Extension context gone.
      }
    },
  });
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults(
        'checkUsername',
        'onlyComments',
        'blockSpecialChars',
        'blockEmoji',
        'blockGrok',
        'enabled',
        'whitelist',
        'communityHandles',
        'highlightMode',
        'keywordAutoBlock',
        'aiEngine',
        'aiApiKey',
        'aiScanAll',
      ),
    );

    checkUsername = Boolean(items.checkUsername);
    onlyComments = Boolean(items.onlyComments);
    blockSpecialChars = Boolean(items.blockSpecialChars);
    blockEmoji = Boolean(items.blockEmoji);
    blockGrok = Boolean(items.blockGrok);
    filterEnabled = Boolean(items.enabled);
    highlightMode = Boolean(items.highlightMode);
    keywordAutoBlock = items.keywordAutoBlock !== false;
    whitelistSet = new Set((items.whitelist as string[]) ?? []);
    communityHandleSet = new Set((items.communityHandles as string[]) ?? []);
    aiMode = items.aiEngine === 'ai';
    aiKeyPresent = Boolean(items.aiApiKey);
    aiScanAll = items.aiScanAll !== false;

    await mergeKeywords();
    // HUD 初始化即创建：不等第一条回帖，进页面就能看到动态面板。
    renderHud();
    filterTweets();

    const pendingTweets = new Set<Element>();

    const observer = new MutationObserver((mutations) => {
      if (!isExtensionAlive()) {
        observer.disconnect();
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          // Three arrival shapes: the cell itself, a subtree containing the
          // cell, and — the first-open hydration case — content inserted
          // INSIDE an existing skeleton cell, where the cell is an ancestor
          // of the added node rather than the node itself.
          const cell =
            el.closest('[data-testid="cellInnerDiv"]') ??
            (el.firstElementChild ? el.querySelector('[data-testid="cellInnerDiv"]') : null);
          if (cell) pendingTweets.add(cell);
        }

        // 任何 cell 内的 DOM 变化都重排该 cell（含 React 重渲染抹掉占位条/
        // 徽标的场景）；quickHash 未变时重扫是幂等补回，成本极低。
        const targetEl =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const cell = targetEl?.closest('[data-testid="cellInnerDiv"]') ?? null;
        if (cell) {
          pendingTweets.add(cell);
        }
      }

      if (pendingTweets.size > 0 && !observerFlushScheduled) {
        observerFlushScheduled = true;
        queueMicrotask(() => {
          observerFlushScheduled = false;
          if (pendingTweets.size > 0) {
            filterTweets(Array.from(pendingTweets));
            pendingTweets.clear();
          }
          // Runtime-status piggybacks here: nav re-renders on account switch
          // flip the DOM, so this flush fires; throttled to once a minute and
          // the report itself is change-gated.
          if (Date.now() - lastUserCheck >= 60_000) {
            lastUserCheck = Date.now();
            detectCurrentUser();
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // X renders cell skeletons first and fills text afterwards (characterData
    // mutations). Schedule a few delayed full re-scans so tweets that hydrated
    // after the initial pass still get evaluated without needing a refresh —
    // the tail extends far enough to cover a cold-cache first open.
    for (const delay of [300, 800, 1600, 3200, 6000, 10000]) {
      setTimeout(() => {
        if (isExtensionAlive()) filterTweets();
      }, delay);
    }

    // Visible proof of which code the page is actually running — without
    // this, a stale content script is indistinguishable from a broken fix.
    console.info(
      `[XShield] content v${chrome.runtime.getManifest().version} ready · 启用=${filterEnabled} · 规则=${blockRegexes.length} · AI=${aiMode && aiKeyPresent ? 'on' : 'off'} · HUD=on`,
    );

    // First report; afterwards the observer's flush keeps it fresh (see above).
    detectCurrentUser();
  } catch (e) {
    console.error('[X-Blocker] init error:', e);
  }
}

chrome.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  if (!isExtensionAlive()) return;
  if (message.action === 'removeLocalSentId' && message.id) {
    localSentIds.delete(String(message.id));
    return;
  }
  if (message.action === 'removeLocalSentIds' && Array.isArray(message.ids)) {
    for (const id of message.ids) localSentIds.delete(String(id));
    return;
  }
  if (message.action === 'clearLocalSentIds') {
    localSentIds.clear();
    return;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !isExtensionAlive()) return;

  let needsFilter = false;

  if (changes.enabled) {
    filterEnabled = Boolean(changes.enabled.newValue);
    needsFilter = true;
  }
  if (changes.checkUsername) {
    checkUsername = Boolean(changes.checkUsername.newValue);
    needsFilter = true;
  }
  if (changes.onlyComments) {
    onlyComments = Boolean(changes.onlyComments.newValue);
    needsFilter = true;
  }
  if (changes.blockEmoji) {
    blockEmoji = Boolean(changes.blockEmoji.newValue);
    needsFilter = true;
  }
  if (changes.blockGrok) {
    blockGrok = Boolean(changes.blockGrok.newValue);
    needsFilter = true;
  }
  if (changes.blockSpecialChars) {
    blockSpecialChars = Boolean(changes.blockSpecialChars.newValue);
    needsFilter = true;
  }
  if (changes.whitelist) {
    whitelistSet = new Set((changes.whitelist.newValue as string[]) ?? []);
    needsFilter = true;
  }
  if (changes.communityHandles) {
    communityHandleSet = new Set((changes.communityHandles.newValue as string[]) ?? []);
    needsFilter = true;
  }
  if (changes.highlightMode) {
    highlightMode = Boolean(changes.highlightMode.newValue);
    needsFilter = true;
  }

  if (changes.keywordAutoBlock) {
    // 命中处理方式切换：只影响之后的命中是否进拉黑队列，无需重扫。
    keywordAutoBlock = changes.keywordAutoBlock.newValue !== false;
  }
  if (changes.aiEngine || changes.aiApiKey || changes.aiScanAll) {
    // AI 引擎配置变更：刷新本地开关并全量重扫（徽标/隐藏状态随之切换）。
    void refreshAiSettings().then(() => {
      filterVersion++;
      scheduleFilter();
    });
    return;
  }

  if (
    changes.keywords ||
    changes.cloudEnabled ||
    changes.cloudKeywords ||
    changes.disabledCloudKeywords
  ) {
    void mergeKeywords().then(() => {
      filterVersion++;
      // 词库变更触发全量重扫：清空请求去重表，让 AI 命中缓存快速重新应用裁决。
      aiRequested.clear();
      scheduleFilter();
    });
  } else if (needsFilter) {
    filterVersion++;
    scheduleFilter();
  }
});

void init();
