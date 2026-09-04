/**
 * Content script — ported 1:1 from X(Twitter) Comment Blocker 1.4.3 content.js.
 * Only deviations: Temporal -> Date.now(), iterator helpers use equivalent
 * array ops, and the module runs at top level instead of inside an IIFE.
 */
import {
  extractCleanScreenName,
  getStorageDefaults,
  invisibleCharsRegex,
  parseKeywords,
} from '../store/blockerStorage';

let blockRegexes: RegExp[] = [];
let lastKeywordsKey = '';
let checkUsername = true;
let onlyComments = true;
let blockSpecialChars = false;
let blockEmoji = false;
let blockGrok = false;
let filterEnabled = true;
let highlightMode = false;
let filterTimer: number | null = null;
let filterVersion = 0;
let whitelistSet = new Set<string>();
let observerFlushScheduled = false;
const localSentIds = new Set<string>();
const tweetStateMap = new WeakMap<Element, Record<string, unknown>>();
const emojiRegex = /\p{RGI_Emoji}/v;
const spamCharsRegex =
  // eslint-disable-next-line no-misleading-character-class
  /[\u02B0-\u02FF\u0F00-\u0FFF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2100-\u2BFF\uA980-\uA9DF\uAA00-\uAADF\u{13000}-\u{1342F}\u{1D400}-\u{1D7FF}]/v;

function isExtensionAlive(): boolean {
  return Boolean(chrome.runtime?.id);
}

function matchesBlocklist(text: string): boolean {
  if (blockRegexes.length === 0) return false;
  return blockRegexes.some((regex) => regex.test(text));
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
    const match = kw.startsWith('/')
      ? kw.match(/^\/(?<pattern>.+)\/(?<flags>[a-zA-Z]*)$/)
      : null;
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
      getStorageDefaults(
        'keywords',
        'cloudEnabled',
        'cloudKeywords',
        'disabledCloudKeywords',
      ),
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

function getEnclosingTweetIfRelevant(target: Node | null): Element | null {
  let curr = target?.nodeType === Node.ELEMENT_NODE ? (target as Element) : (target?.parentElement ?? null);
  let isRelevant = false;
  while (curr && curr !== document.body) {
    const testId = curr.getAttribute('data-testid');
    if (testId === 'tweetText' || testId === 'User-Name') {
      isRelevant = true;
    } else if (testId === 'cellInnerDiv') {
      return isRelevant ? curr : null;
    }
    curr = curr.parentElement;
  }
  return null;
}

function getTweetTextForKeywords(node: Element | null): string {
  if (!node) return '';
  let text = '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let currentNode: Node | null = walker.currentNode;
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      text += currentNode.textContent ?? '';
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

function resolveStatusPage(tweet: Element, pageContext: { pageStatusId: string | null; isPhotoVideoOverlay: boolean }): boolean {
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

    const quickHash = `${rawTweetText}|${rawUserName}|${filterVersion}|${isStatusPage}|${logicalPageStatusId || ''}|${hasGrok}|${highlightMode}`;
    if (state.quickHash === quickHash) {
      if (state.isSpam) {
        tweet.classList.remove('x-comment-blocker-hidden-reply');
        if (highlightMode) {
          tweet.classList.remove('x-comment-blocker-hidden');
          tweet.classList.add('xshield-hit');
        } else {
          tweet.classList.remove('xshield-hit');
          tweet.classList.add('x-comment-blocker-hidden');
        }
      } else {
        tweet.classList.remove('x-comment-blocker-hidden', 'xshield-hit');
      }
      continue;
    }

    if (tweet.closest('[aria-hidden="true"]')) continue;
    state.quickHash = quickHash;

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
      ? detectSpam(
          tweet,
          textNode,
          userNode,
          rawTweetText,
          rawUserName,
          isStatusPage,
          isMainTweet,
        )
      : null;
    const isSpam = spamResult?.isSpam ?? false;

    state.isSpam = isSpam;
    if (isSpam) {
      const { isAutoBlock, blockReason, userName, stableHandle, displayName } = spamResult as SpamDecision;
      tweet.classList.remove('x-comment-blocker-hidden-reply');
      if (highlightMode) {
        tweet.classList.remove('x-comment-blocker-hidden');
        tweet.classList.add('xshield-hit');
      } else {
        tweet.classList.remove('xshield-hit');
        tweet.classList.add('x-comment-blocker-hidden');
      }
      let normalizedBody = rawTweetText
        .replaceAll(invisibleCharsRegex, '')
        .replaceAll(/\s+/gv, ' ')
        .trim();

      if (blockReason === 'Grok屏蔽') {
        const grokMeta = tweet.querySelector(
          'a[href*="/i/grok/share"], meta[content*="/i/grok/share"]',
        );
        const grokLink = grokMeta ? grokMeta.getAttribute('content') || (grokMeta as HTMLAnchorElement).href : '';
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
          isAutoBlock: isAutoBlock,
        });
      }
    } else {
      const prev = tweet.previousElementSibling;
      let isHiddenReply = false;

      if (
        prev &&
        (prev.classList.contains('x-comment-blocker-hidden') ||
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

      tweet.classList.remove('x-comment-blocker-hidden', 'xshield-hit');
    }
  }

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

async function init(): Promise<void> {
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
        'highlightMode',
      ),
    );

    checkUsername = Boolean(items.checkUsername);
    onlyComments = Boolean(items.onlyComments);
    blockSpecialChars = Boolean(items.blockSpecialChars);
    blockEmoji = Boolean(items.blockEmoji);
    blockGrok = Boolean(items.blockGrok);
    filterEnabled = Boolean(items.enabled);
    highlightMode = Boolean(items.highlightMode);
    whitelistSet = new Set((items.whitelist as string[]) ?? []);

    await mergeKeywords();
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

        const tweet = getEnclosingTweetIfRelevant(mutation.target);
        if (tweet) {
          pendingTweets.add(tweet);
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
    for (const delay of [600, 1600, 3200, 6000, 10000]) {
      setTimeout(() => {
        if (isExtensionAlive()) filterTweets();
      }, delay);
    }

    // Visible proof of which code the page is actually running — without
    // this, a stale content script is indistinguishable from a broken fix.
    console.info(
      `[XShield] content v${chrome.runtime.getManifest().version} ready · 启用=${filterEnabled} · 规则=${blockRegexes.length}`,
    );
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
  if (changes.highlightMode) {
    highlightMode = Boolean(changes.highlightMode.newValue);
    needsFilter = true;
  }

  if (
    changes.keywords ||
    changes.cloudEnabled ||
    changes.cloudKeywords ||
    changes.disabledCloudKeywords
  ) {
    void mergeKeywords().then(() => {
      filterVersion++;
      scheduleFilter();
    });
  } else if (needsFilter) {
    filterVersion++;
    scheduleFilter();
  }
});

void init();
