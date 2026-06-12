import type { DetectionResult, DetectionRule, MatchField, XUserProfile } from '@xshield/shared';

export function getFieldText(user: XUserProfile, field: MatchField): string {
  if (field === 'username') return user.username || '';
  if (field === 'displayName') return user.displayName || '';
  if (field === 'bio') return user.bio || '';
  if (field === 'postContent') return (user.postContent || []).join('\n');
  return '';
}

function getRulePatterns(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseRegexPattern(pattern: string): { source: string; flags: string } {
  if (!pattern.startsWith('/')) return { source: pattern, flags: '' };

  let escaped = false;
  for (let index = pattern.length - 1; index > 0; index -= 1) {
    const char = pattern[index];
    if (char !== '/' || escaped) {
      escaped = char === '\\' && !escaped;
      if (char !== '\\') escaped = false;
      continue;
    }

    return {
      source: pattern.slice(1, index),
      flags: pattern.slice(index + 1),
    };
  }

  return { source: pattern, flags: '' };
}

function getRegexFlags(patternFlags: string, caseSensitive: boolean): string {
  const flags = new Set(patternFlags.replace(/[gy]/g, '').split('').filter(Boolean));
  if (caseSensitive) {
    flags.delete('i');
  } else {
    flags.add('i');
  }
  return Array.from(flags).join('');
}

function testRegexPattern(pattern: string, text: string, caseSensitive: boolean): boolean {
  try {
    const parsed = parseRegexPattern(pattern);
    const regex = new RegExp(parsed.source, getRegexFlags(parsed.flags, caseSensitive));
    return regex.test(text);
  } catch {
    return false;
  }
}

export function evaluateUser(
  user: XUserProfile,
  rules: DetectionRule[],
  threshold = 60,
): DetectionResult {
  let score = 0;
  const matchedRules: string[] = [];
  const matchedFields = new Set<MatchField>();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const patterns = getRulePatterns(rule.content);
    if (patterns.length === 0) continue;

    for (const field of rule.fields) {
      const text = getFieldText(user, field);
      if (!text) continue;

      let matched = false;
      if (rule.type === 'keyword') {
        const source = rule.caseSensitive ? text : text.toLowerCase();
        matched = patterns.some((pattern) => {
          const keyword = rule.caseSensitive ? pattern : pattern.toLowerCase();
          return source.includes(keyword);
        });
      }

      if (rule.type === 'regex') {
        matched = patterns.some((pattern) => testRegexPattern(pattern, text, rule.caseSensitive));
      }

      if (matched) {
        score += rule.score;
        matchedRules.push(rule.id);
        matchedFields.add(field);
        break;
      }
    }
  }

  return {
    userId: user.id,
    matched: score >= threshold,
    score,
    matchedRules,
    matchedFields: Array.from(matchedFields),
  };
}
