import type { BlockExecutorConfig, DetectionRule } from './types';

export const DEFAULT_SCORE_THRESHOLD = 60;

export const DEFAULT_BLOCK_EXECUTOR_CONFIG: BlockExecutorConfig = {
  batchSize: 100,
  intervalMinutes: 10,
  jitterSeconds: 60,
  maxRetries: 3,
  cooldownMinutesAfterFailure: 30,
};

export const DEFAULT_RULES = [
  {
    id: 'keyword-onlyfans',
    type: 'keyword',
    content: 'onlyfans',
    fields: ['username', 'displayName', 'bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 70,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'keyword-telegram',
    type: 'keyword',
    content: 'telegram',
    fields: ['bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 60,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'keyword-whatsapp',
    type: 'keyword',
    content: 'whatsapp',
    fields: ['bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 60,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'keyword-investment',
    type: 'keyword',
    content: 'investment',
    fields: ['bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 60,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'regex-telegram-link',
    type: 'regex',
    content: 't\\.me\\/[A-Za-z0-9_]+',
    fields: ['bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 70,
    createdAt: 0,
    updatedAt: 0,
  },
] as const satisfies readonly DetectionRule[];

export const BUILT_IN_AD_RULES_VERSION = 2;

export const BUILT_IN_AD_RULES = [
  {
    id: 'builtin-regex-zh-resource-ad-v2',
    type: 'regex',
    content: [
      '/(\\u7ebf\\u4e0b(?:\\u7ea6\\u89c1\\u5165\\u53e3|\\u5bf9\\u63a5)|\\u9644\\u8fd1\\u771f\\u5b9e\\u8d44\\u6e90|\\u540c\\u57ce\\u8d44\\u6e90|\\u8d44\\u6e90\\u81ea\\u53d6|\\u70b9\\u6211(?:\\u5934|\\u5934\\u50cf|\\u4e3b\\u9875)?|\\u770b\\u6211(?:\\u7b80\\u4ecb|\\u4e3b\\u9875)?|\\u770b\\u4e3b\\u9875|\\u771f\\u5b9e(?:\\u53ef\\u9760|\\u7ea6\\u89c1)|\\u5168\\u56fd\\u7275\\u7ebf|[1\\u4e00][\\-\\uff0d\\u2014\\u5230\\u81f3]?[5\\u4e94]\\u7ebf\\u8d44\\u6e90(?:\\u81ea\\u53d6)?|\\u4e0a\\u95e8|\\u7a7a\\u964d|\\u5916\\u56f4|\\u7ea6\\u70ae|\\u9644\\u8fd1\\u53ef\\u7ea6|\\u540c\\u57ce\\u53ef\\u7ea6|\\u79c1\\u4fe1)/i',
      '/(?:\\u8d44\\u6e90|\\u540c\\u57ce|\\u9644\\u8fd1|\\u7ebf\\u4e0b|\\u771f\\u5b9e|\\u5168\\u56fd).{0,16}(?:\\u81ea\\u53d6|\\u7ea6\\u89c1|\\u5bf9\\u63a5|\\u53ef\\u7ea6|\\u670d\\u52a1|\\u5165\\u53e3|\\u4e3b\\u9875|\\u7b80\\u4ecb)/i',
    ].join('\n'),
    fields: ['displayName', 'bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 90,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-regex-global-ad-v2',
    type: 'regex',
    content: [
      '/(?:dm|message|click|check|see).{0,24}(?:profile|bio|link)/i',
      '/(?:local|nearby|real).{0,24}(?:meet|dating|escort|service|resource)/i',
      '/(?:onlyfans|telegram|whatsapp|line|signal|cashapp|crypto\\s*(?:group|signal)|investment\\s*(?:group|signal))/i',
      '/(?:\\u30d7\\u30ed\\u30d5\\u30a3\\u30fc\\u30eb|\\u81ea\\u5df1\\u7d39\\u4ecb|\\u30ea\\u30f3\\u30af).{0,16}(?:\\u898b\\u3066|\\u78ba\\u8a8d|\\u30af\\u30ea\\u30c3\\u30af)|(?:\\u8fd1\\u304f|\\u5730\\u5143|\\u672c\\u7269).{0,16}(?:\\u51fa\\u4f1a\\u3044|\\u6848\\u5185|\\u30b5\\u30fc\\u30d3\\u30b9)/i',
      '/(?:\\ud504\\ub85c\\ud544|\\uc18c\\uac1c|\\ub9c1\\ud06c).{0,16}(?:\\ud655\\uc778|\\ud074\\ub9ad|\\ubd10)|(?:\\uadfc\\ucc98|\\uc9c0\\uc5ed|\\uc2e4\\uc81c).{0,16}(?:\\ub9cc\\ub0a8|\\uc11c\\ube44\\uc2a4|\\uc790\\ub8cc)/i',
      '/(?:voir|clique|consulte).{0,24}(?:profil|bio|lien)|(?:local|pr\\u00e8s de toi|r\\u00e9el).{0,24}(?:rencontre|service)/i',
    ].join('\n'),
    fields: ['displayName', 'bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 75,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-regex-emoji-spam-v2',
    type: 'regex',
    content: [
      '/(?:\\p{Extended_Pictographic}\\s*){6,}/u',
      '/(?:[\\u{1F1E6}-\\u{1F1FF}]\\s*){6,}/u',
    ].join('\n'),
    fields: ['displayName', 'bio', 'postContent'],
    enabled: true,
    caseSensitive: false,
    score: 45,
    createdAt: 0,
    updatedAt: 0,
  },
] as const satisfies readonly DetectionRule[];
