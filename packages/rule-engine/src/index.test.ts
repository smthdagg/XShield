import { describe, expect, it } from 'vitest';
import { BUILT_IN_AD_RULES } from '@xshield/shared';
import type { DetectionRule, XUserProfile } from '@xshield/shared';
import { evaluateUser } from './index';

const baseRule: Omit<DetectionRule, 'id' | 'type' | 'content' | 'fields' | 'score'> = {
  enabled: true,
  caseSensitive: false,
  createdAt: 1,
  updatedAt: 1,
};

const user: XUserProfile = {
  id: 'alice',
  username: 'alice',
  displayName: 'Alice',
  bio: 'DM me on telegram',
  postContent: ['Investment plan t.me/example'],
  discoveredAt: 1,
};

describe('evaluateUser', () => {
  it('scores keyword and regex matches independently', () => {
    const rules: DetectionRule[] = [
      {
        ...baseRule,
        id: 'telegram',
        type: 'keyword',
        content: 'telegram',
        fields: ['bio'],
        score: 30,
      },
      {
        ...baseRule,
        id: 'telegram-link',
        type: 'regex',
        content: 't\\.me\\/[A-Za-z0-9_]+',
        fields: ['postContent'],
        score: 40,
      },
    ];

    const result = evaluateUser(user, rules, 60);

    expect(result.matched).toBe(true);
    expect(result.score).toBe(70);
    expect(result.matchedRules).toEqual(['telegram', 'telegram-link']);
    expect(result.matchedFields).toEqual(['bio', 'postContent']);
  });

  it('ignores disabled and invalid regex rules', () => {
    const result = evaluateUser(
      user,
      [
        {
          ...baseRule,
          id: 'disabled',
          type: 'keyword',
          content: 'telegram',
          fields: ['bio'],
          enabled: false,
          score: 100,
        },
        {
          ...baseRule,
          id: 'bad-regex',
          type: 'regex',
          content: '[',
          fields: ['bio'],
          score: 100,
        },
      ],
      60,
    );

    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
  });

  it('matches keyword and regex content line by line', () => {
    const result = evaluateUser(
      user,
      [
        {
          ...baseRule,
          id: 'multi-keyword',
          type: 'keyword',
          content: 'whatsapp\ntelegram',
          fields: ['bio'],
          score: 30,
        },
        {
          ...baseRule,
          id: 'multi-regex',
          type: 'regex',
          content: 'wa\\.me/[A-Za-z0-9_]+\nt\\.me\\/[A-Za-z0-9_]+',
          fields: ['postContent'],
          score: 40,
        },
      ],
      60,
    );

    expect(result.matched).toBe(true);
    expect(result.score).toBe(70);
    expect(result.matchedRules).toEqual(['multi-keyword', 'multi-regex']);
  });

  it('supports slash-delimited regex syntax with flags', () => {
    const result = evaluateUser(
      user,
      [
        {
          ...baseRule,
          id: 'slash-regex',
          type: 'regex',
          content: '/T\\.ME\\/[a-z0-9_]+/i',
          fields: ['postContent'],
          score: 60,
        },
      ],
      60,
    );

    expect(result.matched).toBe(true);
    expect(result.score).toBe(60);
    expect(result.matchedRules).toEqual(['slash-regex']);
  });

  it('matches built-in Chinese resource spam patterns', () => {
    const result = evaluateUser(
      {
        id: 'spam-resource',
        username: 'WildeAlma667',
        displayName: '\u7ebf\u4e0b\u5bf9\u63a5\u9644\u8fd1\u771f\u5b9e\u8d44\u6e90\u70b9\u6211\u5934\u50cf',
        postContent: ['4e'],
        discoveredAt: 1,
      },
      [...BUILT_IN_AD_RULES],
      60,
    );

    expect(result.matched).toBe(true);
    expect(result.matchedRules).toContain('builtin-regex-zh-resource-ad-v2');
  });

  it('matches newer Chinese profile bait resource spam patterns', () => {
    const result = evaluateUser(
      {
        id: 'spam-resource-v2',
        username: 'ArleneCopp350',
        displayName: '\u7ebf\u4e0b\u7ea6\u89c1\u5165\u53e3\u771f\u5b9e\u53ef\u9760\u70b9\u6211\u4e3b\u9875',
        postContent: ['\u5168\u56fd\u7275\u7ebf 1-5\u7ebf\u8d44\u6e90\u81ea\u53d6'],
        discoveredAt: 1,
      },
      [...BUILT_IN_AD_RULES],
      60,
    );

    expect(result.matched).toBe(true);
    expect(result.matchedRules).toContain('builtin-regex-zh-resource-ad-v2');
  });

  it('keeps emoji-only spam below the default threshold', () => {
    const result = evaluateUser(
      {
        id: 'emoji-only',
        username: 'emojiOnly',
        displayName: 'normal user',
        postContent: ['\u{1f381}\u{1f381}\u{1f381}\u{1f381}\u{1f381}\u{1f381}'],
        discoveredAt: 1,
      },
      [...BUILT_IN_AD_RULES],
      60,
    );

    expect(result.matched).toBe(false);
    expect(result.score).toBe(45);
    expect(result.matchedRules).toEqual(['builtin-regex-emoji-spam-v2']);
  });
});
