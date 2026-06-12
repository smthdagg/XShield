import {
  BUILT_IN_AD_RULES,
  BUILT_IN_AD_RULES_VERSION,
  DEFAULT_BLOCK_EXECUTOR_CONFIG,
  DEFAULT_RULES,
  DEFAULT_SCORE_THRESHOLD,
} from '@xshield/shared';
import type { AppSettings } from '@xshield/shared';
import { db } from './dexie';

const defaultSettings: AppSettings = {
  id: 'default',
  scoreThreshold: DEFAULT_SCORE_THRESHOLD,
  executorConfig: DEFAULT_BLOCK_EXECUTOR_CONFIG,
  queuePaused: false,
  language: 'system',
  ruleExecutionMode: 'automatic',
  rulesRunning: true,
  blockAdapterMode: 'mock',
  updatedAt: Date.now(),
};

export async function seedDefaultRules(): Promise<void> {
  await db.rules.bulkDelete(DEFAULT_RULES.map((rule) => rule.id));
}

export async function seedDefaultSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('default');
  const settings: AppSettings = {
    ...defaultSettings,
    ...existing,
    executorConfig: {
      ...DEFAULT_BLOCK_EXECUTOR_CONFIG,
      ...existing?.executorConfig,
    },
    updatedAt: existing?.updatedAt ?? Date.now(),
  };

  await db.settings.put(settings);
  return settings;
}

export async function seedBuiltInAdRules(): Promise<void> {
  const settings = await db.settings.get('default');
  if ((settings?.builtInAdRulesVersion ?? 0) >= BUILT_IN_AD_RULES_VERSION) return;

  const now = Date.now();
  const rules = BUILT_IN_AD_RULES.map((rule) => ({
    ...rule,
    createdAt: now,
    updatedAt: now,
  }));

  await db.transaction('rw', db.rules, db.settings, async () => {
    await db.rules.bulkPut(rules);
    await db.settings.put({
      ...(settings ?? defaultSettings),
      builtInAdRulesSeeded: true,
      builtInAdRulesVersion: BUILT_IN_AD_RULES_VERSION,
      updatedAt: now,
    });
  });
}

export async function seedDefaults(): Promise<void> {
  await seedDefaultRules();
  await seedDefaultSettings();
  await seedBuiltInAdRules();
}
