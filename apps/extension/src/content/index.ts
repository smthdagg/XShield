import type { XUserProfile } from '@xshield/shared';
import type {
  CollectVisibleUsersPayload,
  MatchedUsersPayload,
  RealBlockUserPayload,
  RealBlockUserResult,
  RuntimeMessage,
} from '../types';

const RESERVED_PATHS = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'i',
  'intent',
  'search',
  'settings',
  'compose',
  'hashtag',
  'topics',
  'lists',
]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function getVisibleText(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function parseCompactCount(value: string): number | undefined {
  const normalized = value.replace(/,/g, '').trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMBkmb]|\u4e07|\u4ebf)?$/);
  if (!match) return undefined;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;

  const unit = match[2]?.toLowerCase();
  const multiplier =
    unit === 'k'
      ? 1_000
      : unit === 'm'
        ? 1_000_000
        : unit === 'b'
          ? 1_000_000_000
          : unit === '\u4e07'
            ? 10_000
            : unit === '\u4ebf'
              ? 100_000_000
              : 1;

  return Math.round(base * multiplier);
}

function extractFollowers(container: Element | Document = document): Pick<XUserProfile, 'followersCount' | 'followersText'> {
  const root = container instanceof Document ? container.body : container;
  const followerLinks = Array.from(
    root.querySelectorAll<HTMLAnchorElement>('a[href$="/followers"], a[href$="/verified_followers"]'),
  );
  const linkText = followerLinks.map((link) => getVisibleText(link)).find(Boolean);
  const sourceText = linkText || getVisibleText(root);

  const patterns = [
    /([\d,.]+(?:[KMBkmb])?)\s+(?:Followers|followers)\b/,
    /([\d,.]+(?:\u4e07|\u4ebf)?)\s*(?:\u7c89\u4e1d|\u4f4d\u5173\u6ce8\u8005|\u5173\u6ce8\u8005)/,
  ];

  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (match?.[1]) {
      return {
        followersCount: parseCompactCount(match[1]),
        followersText: match[0],
      };
    }
  }

  return {};
}

function extractAvatarUrl(container: Element | Document = document): string | undefined {
  const root = container instanceof Document ? container.body : container;
  const avatar =
    root.querySelector<HTMLImageElement>('img[src*="profile_images"]') ||
    root.querySelector<HTMLImageElement>('[data-testid="UserAvatar-Container"] img') ||
    root.querySelector<HTMLImageElement>('img[alt][src]');

  return avatar?.src;
}

function extractUsernameFromHref(href: string): string | undefined {
  try {
    const url = new URL(href, location.origin);
    const firstSegment = url.pathname.split('/').filter(Boolean)[0]?.replace(/^@+/, '');
    if (!firstSegment) return undefined;
    if (RESERVED_PATHS.has(firstSegment.toLowerCase())) return undefined;
    if (!/^[A-Za-z0-9_]{1,15}$/.test(firstSegment)) return undefined;
    return firstSegment;
  } catch {
    return undefined;
  }
}

function upsertUser(
  users: Map<string, XUserProfile>,
  username: string,
  patch: Partial<XUserProfile>,
): void {
  const normalizedUsername = username.replace(/^@+/, '');
  const id = normalizedUsername.toLowerCase();
  const existing = users.get(id);
  users.set(id, {
    id,
    username: normalizedUsername,
    displayName: patch.displayName || existing?.displayName,
    bio: patch.bio || existing?.bio,
    postContent: Array.from(new Set([...(existing?.postContent ?? []), ...(patch.postContent ?? [])])),
    followersCount: patch.followersCount ?? existing?.followersCount,
    followersText: patch.followersText || existing?.followersText,
    avatarUrl: patch.avatarUrl || existing?.avatarUrl,
    profileUrl: `https://x.com/${normalizedUsername}`,
    discoveredAt: existing?.discoveredAt ?? Date.now(),
  });
}

function collectProfileHeaderUser(users: Map<string, XUserProfile>): void {
  const username = extractUsernameFromHref(location.pathname);
  if (!username) return;

  const bio = getVisibleText(document.querySelector('[data-testid="UserDescription"]'));
  const displayName =
    getVisibleText(document.querySelector('[data-testid="UserName"] span')) ||
    getVisibleText(document.querySelector('[data-testid="UserName"]')) ||
    username;

  upsertUser(users, username, {
    displayName,
    bio,
    avatarUrl: extractAvatarUrl(document),
    ...extractFollowers(document),
  });
}

function collectFromContainer(users: Map<string, XUserProfile>, container: Element): void {
  const text = getVisibleText(container);
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const usernames = links
    .map((link) => extractUsernameFromHref(link.getAttribute('href') || ''))
    .filter((username): username is string => Boolean(username));

  for (const username of Array.from(new Set(usernames))) {
    const userNameBlock =
      container.querySelector('[data-testid="User-Name"]') ||
      container.querySelector('[data-testid="UserName"]');
    const displayName = getVisibleText(userNameBlock?.querySelector('span') ?? userNameBlock);
    const bio =
      getVisibleText(container.querySelector('[data-testid="UserDescription"]')) ||
      getVisibleText(container.querySelector('[dir="auto"]'));

    upsertUser(users, username, {
      displayName,
      bio,
      avatarUrl: extractAvatarUrl(container),
      ...extractFollowers(container),
      postContent: text ? [text] : [],
    });
  }
}

function collectVisibleUsers(): XUserProfile[] {
  const users = new Map<string, XUserProfile>();
  collectProfileHeaderUser(users);

  const containers = document.querySelectorAll(
    'article, [data-testid="UserCell"], [data-testid="cellInnerDiv"]',
  );
  containers.forEach((container) => collectFromContainer(users, container));

  return Array.from(users.values());
}

function ensureHighlightStyle(): void {
  if (document.getElementById('xshield-highlight-style')) return;

  const style = document.createElement('style');
  style.id = 'xshield-highlight-style';
  style.textContent = `
    .xshield-rule-hit {
      background: #fff7cc !important;
      box-shadow: inset 4px 0 0 #f4c430 !important;
      transition: background-color 160ms ease;
    }
  `;
  document.documentElement.appendChild(style);
}

function getUsernamesFromContainer(container: Element): string[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map((link) => extractUsernameFromHref(link.getAttribute('href') || ''))
    .filter((username): username is string => Boolean(username))
    .map((username) => username.toLowerCase());
}

function highlightMatchedUsers(usernames: string[]): void {
  ensureHighlightStyle();
  const matched = new Set(usernames.map((username) => username.replace(/^@+/, '').toLowerCase()));
  const containers = document.querySelectorAll<HTMLElement>(
    'article, [data-testid="UserCell"], [data-testid="cellInnerDiv"]',
  );

  containers.forEach((container) => {
    const hit = getUsernamesFromContainer(container).some((username) => matched.has(username));
    container.classList.toggle('xshield-rule-hit', hit);
  });
}

async function notifyVisibleUsers(users: XUserProfile[]): Promise<void> {
  const message: RuntimeMessage<XUserProfile[]> = {
    source: 'xshield',
    type: 'VISIBLE_USERS_COLLECTED',
    payload: users,
  };

  window.postMessage(message, '*');
  try {
    const response = await chrome.runtime.sendMessage<RuntimeMessage<XUserProfile[]>, MatchedUsersPayload>(message);
    highlightMatchedUsers(response?.usernames ?? []);
  } catch {
    // The extension may have been reloaded while an old content script is still alive.
  }
}

async function collectVisibleUsersWithScroll(scrollPasses = 0): Promise<XUserProfile[]> {
  const users = new Map<string, XUserProfile>();

  for (let index = 0; index <= scrollPasses; index += 1) {
    for (const user of collectVisibleUsers()) {
      upsertUser(users, user.username, user);
    }

    if (index < scrollPasses) {
      window.scrollBy({ top: Math.max(600, Math.floor(window.innerHeight * 0.85)), behavior: 'smooth' });
      await sleep(900);
    }
  }

  return Array.from(users.values());
}

let timer: number | undefined;

function sendVisibleUsers(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const users = collectVisibleUsers();
    if (users.length === 0) return;

    void notifyVisibleUsers(users);
  }, 500);
}

function findButtonByText(patterns: RegExp[]): HTMLElement | undefined {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
  return buttons.find((button) => patterns.some((pattern) => pattern.test(getVisibleText(button))));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 250,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function getCurrentProfileUsername(): string {
  const firstPath = location.pathname.split('/').filter(Boolean)[0] ?? '';
  return decodeURIComponent(firstPath).replace(/^@+/, '').toLowerCase();
}

function isProfileUnavailable(): boolean {
  const text = getVisibleText(document.body);
  return /This account doesn.t exist|Account suspended|Something went wrong/i.test(text);
}

function isAlreadyBlocked(normalized: string): boolean {
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    /^Blocked$/i,
    new RegExp(`^Blocked @?${escaped}$`, 'i'),
    /^Unblock$/i,
    new RegExp(`^Unblock @?${escaped}$`, 'i'),
    /\u5df2\u5c4f\u853d|\u53d6\u6d88\u5c4f\u853d/,
  ];
  return Boolean(
    document.querySelector('[data-testid="unblock"]') ||
      findButtonByText(patterns),
  );
}

function getProfileActionMenuButton(): HTMLElement | undefined {
  const moreText = String.fromCharCode(0x66f4, 0x591a);
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
  return (
    document.querySelector<HTMLElement>('[data-testid="userActions"]') ||
    buttons.find((button) => {
      const label = button.getAttribute('aria-label') || '';
      return /More|User actions|更多|操作/i.test(label) || label.includes(moreText);
    }) ||
    buttons.find((button) => getVisibleText(button) === '...')
  );
}

function findBlockMenuItem(normalized: string): HTMLElement | undefined {
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const menuItems = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="button"], button, div[dir="ltr"]'),
  );
  return menuItems.find((item) => {
    const text = getVisibleText(item);
    if (!text) return false;
    if (/Unblock|取消屏蔽|已屏蔽/i.test(text)) return false;
    return (
      new RegExp(`\\bBlock\\s*@?${escaped}\\b`, 'i').test(text) ||
      /^Block\b/i.test(text) ||
      /\u5c4f\u853d|\u62c9\u9ed1|\u963b\u6b62/.test(text)
    );
  });
}

function findConfirmBlockButton(): HTMLElement | undefined {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'));
  const roots = dialogs.length > 0 ? dialogs : [document.body];
  for (const root of roots) {
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const match = buttons.find((button) => {
      const text = getVisibleText(button);
      return /^Block$/i.test(text) || /\u5c4f\u853d|\u62c9\u9ed1|\u963b\u6b62/.test(text);
    });
    if (match) return match;
  }
  return undefined;
}

async function realBlockUser(username: string): Promise<RealBlockUserResult> {
  const normalized = username.replace(/^@+/, '');
  if (!normalized) return { success: false, error: 'Missing username' };

  if (getCurrentProfileUsername() !== normalized.toLowerCase()) {
    location.assign(`https://x.com/${normalized}?xshield_blocker=1`);
    const reachedProfile = await waitUntil(
      () => getCurrentProfileUsername() === normalized.toLowerCase(),
      12000,
    );
    if (!reachedProfile) {
      return { success: false, error: `Could not navigate to @${normalized} profile` };
    }
  }

  const pageReady = await waitUntil(
    () => Boolean(document.querySelector('[data-testid="primaryColumn"], main')) || isProfileUnavailable(),
    15000,
  );
  if (!pageReady) {
    return { success: false, error: `Timed out loading @${normalized} profile` };
  }
  if (isProfileUnavailable()) {
    return { success: false, error: `@${normalized} profile is unavailable` };
  }
  if (isAlreadyBlocked(normalized)) {
    return { success: true, alreadyBlocked: true };
  }

  const moreButton = getProfileActionMenuButton();
  if (!moreButton) {
    return { success: false, error: 'Could not find profile action menu' };
  }

  moreButton.click();
  const menuOpened = await waitUntil(() => Boolean(findBlockMenuItem(normalized)), 5000, 200);
  if (!menuOpened) {
    return { success: false, error: 'Could not find block menu item after opening profile menu' };
  }

  const blockMenuItem = findBlockMenuItem(normalized);

  if (!blockMenuItem) {
    return { success: false, error: 'Could not find block menu item' };
  }

  blockMenuItem.click();
  const confirmationReady = await waitUntil(() => Boolean(findConfirmBlockButton()), 5000, 200);
  if (!confirmationReady) {
    if (isAlreadyBlocked(normalized)) return { success: true, alreadyBlocked: true };
    return { success: false, error: 'Could not find block confirmation dialog' };
  }

  const confirmButton = findConfirmBlockButton();
  if (!confirmButton) {
    return { success: false, error: 'Could not find block confirmation button' };
  }

  confirmButton.click();
  const blocked = await waitUntil(() => isAlreadyBlocked(normalized), 5000, 250);
  return blocked ? { success: true } : { success: false, error: `Clicked block for @${normalized}, but X did not show blocked state` };
}

function startObserver(): void {
  if (!document.body) return;

  const observer = new MutationObserver(sendVisibleUsers);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  sendVisibleUsers();
}

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage<RealBlockUserPayload | CollectVisibleUsersPayload>,
    _sender,
    sendResponse: (response: RealBlockUserResult | XUserProfile[]) => void,
  ) => {
    if (message?.source !== 'xshield') return false;

    if (message.type === 'COLLECT_VISIBLE_USERS') {
      const payload = message.payload as CollectVisibleUsersPayload | undefined;
      void collectVisibleUsersWithScroll(payload?.scrollPasses ?? 0).then((users) => {
        sendResponse(users);
        void notifyVisibleUsers(users);
      });
      return true;
    }

    if (message.type === 'XSHIELD_PING') {
      sendResponse({ success: true });
      return false;
    }

    if (message.type === 'REAL_BLOCK_USER') {
      const payload = message.payload as RealBlockUserPayload | undefined;
      void realBlockUser(payload?.username ?? '')
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    return false;
  },
);

startObserver();
