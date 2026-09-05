# XShield Privacy Policy / 隐私政策

Last updated: 2026-09-05 · Applies to XShield 1.0.0+

XShield is a local-first browser extension. All user data is stored locally in
the browser (`chrome.storage.local`, with the `unlimitedStorage` permission so
large block lists never evict). The extension has **no backend server** and
never sells or shares data for advertising.

XShield 是一款本地优先的浏览器扩展。所有用户数据仅保存在浏览器本地
（`chrome.storage.local`，含 `unlimitedStorage` 权限以保证大容量名单不丢失）。
扩展**没有自建后端服务器**，绝不出售数据，也不将数据用于广告。

## 1. Data stored locally / 本地保存的数据

- 触发记录（命中关键词的推文文本、作者 handle、昵称、时间）
- 拉黑账本与拉黑时间戳（blockedUsersOnX / blockedAt）
- 待拉黑队列与执行时间（autoBlockQueue / autoBlockEta）
- 社区共享名单与退出列表（communityHandles / communityDismissed）
- 白名单、词库（云端下载 + 本地自定义）、运行日志、设置项

Stored locally: trigger records (tweet text, author handle, display name,
time), the block ledger with timestamps, the pending queue, the downloaded
community blocklist, whitelist, keyword libraries, logs, and settings.

## 2. Network requests / 网络请求

| 目的 | 目标 | 触发方式 |
|------|------|----------|
| 下载云端词库与共享黑名单 | `api.github.com` / `fastly.jsdelivr.net`（项目仓库的 keywords.txt / handles.txt） | 自动同步（6 小时）与手动「立即同步」 |
| 真实拉黑 / 解除拉黑 | `x.com` / `twitter.com` 的 `blocks/create.json`、`destroy.json` | 触发名单自动执行，或用户在面板点击 |
| 共享拉黑名单（可选） | `api.github.com`（项目仓库 handles.txt） | **仅**用户主动点击「共享拉黑名单到项目仓库」并配置了 GitHub Token |

| Purpose | Target | When |
|---------|--------|------|
| Download cloud library & shared blocklist | `api.github.com` / `fastly.jsdelivr.net` | automatic (6 h) + manual sync |
| Block / unblock on X | `x.com` / `twitter.com` block endpoints | on queued auto-blocks or dashboard clicks |
| Share blocked handles (optional) | `api.github.com` | **only** on explicit button click with a user-configured token |

## 3. Cookies / Cookie 使用

The `cookies` permission reads the `ct0` session cookie of x.com solely to
authenticate block/unblock requests with the user's own X session. It is never
sent anywhere else, never persisted off-device, and never used for tracking.

`cookies` 权限仅读取 x.com 的 `ct0` 会话 Cookie，用于让拉黑请求以用户本人身份
通过 X 的鉴权。该 Cookie 不会发送给 X 以外的任何一方，不会离开本机保存，
也不用于任何追踪。

## 4. Optional sharing / 可选的名单共享

When the user explicitly clicks「共享拉黑名单到项目仓库」with a configured
GitHub token, the **handles of accounts the user blocked** are merged into a
public `handles.txt` file in the project repository, so other users can block
the same spam accounts. This upload:

- happens only on an explicit button click;
- contains only the handles (no tweet content, no personal data of the user);
- is permanent until removed from the repository.

Users without a configured token never upload anything.

用户只有在主动点击且配置了 GitHub Token 时，才会把自己已拉黑账号的 handle
合并上传到项目仓库的公开文件中（不含推文内容，不含用户本人个人信息）。
未配置 Token 的用户不会有任何数据上传。

## 5. Data deletion / 数据删除

Uninstalling the extension (or removing it from chrome://extensions) deletes
all locally stored data. Individual records, queue entries, whitelist rows and
logs can be deleted inside the dashboard at any time.

卸载扩展即删除全部本地数据；也可在面板中随时单独删除记录、队列、白名单与日志。

## 6. Permissions / 权限用途

| Permission | Why |
|------------|-----|
| `storage` / `unlimitedStorage` | save lists, records and settings locally; large block lists must not be evicted |
| `cookies` | read x.com `ct0` to authenticate the user's own block requests |
| `alarms` | periodic cloud-library sync and block-queue pacing |
| `contextMenus` | right-click selected text → add to keyword library |
| host: `x.com` / `twitter.com` | content filtering on X pages + block API with the user's session |
| host: `api.github.com` / `fastly.jsdelivr.net` | cloud library & shared blocklist sync |

## 7. Contact / 联系

Issues: https://github.com/smthdagg/XShield/issues
