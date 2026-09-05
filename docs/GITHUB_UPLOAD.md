# Cloud sync & sharing (1.0.0)

> The 0.5.x "upload full keyword library to your own repo" feature was removed
> in 0.6.0. Cloud data now flows through the project repository
> `smthdagg/XShield-keywords` with two separate files.

## Files

| File | Content | Direction |
|------|---------|-----------|
| `keywords.txt` | content rules (cleaned: 561 lines — Chinese phrases, brand words, `t.cn`, structural regexes) | download-only for all users |
| `handles.txt` | community shared blocklist (blocked handles, merge-only, permanent) | download for all users; upload for token holders |

## Download path (all users)

Each sync (6-h alarm or manual 立即同步) fetches both files with a three-tier
fallback: GitHub Contents API → jsDelivr CDN (`?t=` cache-buster) → bundled
copy inside the extension. `handles.txt` missing = empty list, never an error.

## Upload paths (owner / contributors, optional, token-gated)

Two buttons, both require a GitHub Token with Contents: read/write on the
library repo (总设置 → GitHub Token):

1. **规则与同步 → 同步我的词库到项目仓库** — publishes the panel's current
   library view (cloud words minus disabled + local custom) to `keywords.txt`
   with REPLACE semantics: the dashboard view is exactly what all users will
   sync. Deletions are intentional and preserved.
2. **总设置 → 共享拉黑名单到项目仓库** — merges the local block ledger into
   `handles.txt` (GET sha → union → PUT base64). Additive only; never
   overwrites others' entries.

Without a token nothing is ever uploaded.

## CDN cache note

The panel sync prefers the GitHub API (always fresh). The jsDelivr CDN
fallback may serve a stale copy for a while after an upstream edit; force it
with https://www.jsdelivr.com/tools/purge if needed.

Keeping the project's handle directory clean: delete a 社区共享 record to
permanently opt that handle out of the feeder on your machine, and consider
removing it from `handles.txt` upstream if it was shared by mistake.
