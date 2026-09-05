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

## Upload path (owner / contributors, optional)

总设置 → GitHub Token (Contents: read/write on the library repo) →
共享拉黑名单到项目仓库: the local block ledger is merged into `handles.txt`
(GET sha → union → PUT base64). Deduplicated, never overwrites others'
entries. Without a token nothing is ever uploaded.

Keeping the project's handle directory clean: delete a 社区共享 record to
permanently opt that handle out of the feeder on your machine, and consider
removing it from `handles.txt` upstream if it was shared by mistake.
