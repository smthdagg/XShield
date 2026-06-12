# Changelog

## 0.3.6 - 2026-06-12

- Fixed profile enrichment so queued users never receive the current logged-in account's avatar, bio, or follower count.
- Profile enrichment now only accepts X profile data when the parsed `screen_name` matches the target username.
- Added automatic cleanup for suspicious shared queue profile data caused by the previous enrichment bug.
- Updated project links to the public GitHub repository.

## 0.3.5 - 2026-06-12

- Added an in-app multilingual Help manual in the dashboard.
- Help content now follows the selected/system language and covers setup, rules, candidate review, block queue, export, real block safety, and common usage guidance.

## 0.3.4 - 2026-06-12

- Redesigned the extension logo with an X platform, protective shield, and classical Chinese shield style.
- Added Chrome extension icon assets for 16, 32, 48, and 128 pixel sizes.
- Added blocked-user export from the dashboard in TXT, CSV, JSON, NDJSON, and SQL formats.

## 0.3.3 - 2026-06-12

- 入队前自动补拉 X 用户主页资料，补全粉丝数、头像、自我介绍等字段。
- 修复候选用户从回复列表采集时缺少粉丝数，导致待拉黑列表粉丝为空的问题。

## 0.3.2 - 2026-06-12

- 修复内置中文、日文、韩文广告规则编码污染导致无法匹配的问题。
- 新增内置规则版本号，旧版本用户升级后会自动导入新版广告规则。
- 增强识别“线下约见入口、真实可靠、全国牵线、1-5线资源自取、看我主页”等 X 广告账号。

## 0.3.1 - 2026-06-12

- 新增可删除的内置广告识别规则，覆盖中文资源引流、多语言广告引流和 emoji 刷屏。
- 内置规则仅首次升级导入一次，用户删除后不会反复恢复。
- 适配类似“线下对接、附近真实资源、同城资源自取、点我头像、看我简介”的 X 广告账号。

## 0.3.0 - 2026-06-11

- 整理为 GitHub 开源发布版本。
- 新增项目元数据、版本、反馈、赞助和版权信息。
- 新增弹窗版权水印与关于页。
- 新增完整 README、使用说明、隐私说明、开发说明、安全说明、贡献指南和 GitHub 模板。
- 保留真实拉黑队列、候选用户复核、白名单、规则匹配、命中高亮、节流执行等核心能力。

## 0.2.13 - 2026-06-11

- 移除弹窗里的 Open Settings 入口。
- 弹窗改为显示触发待处理数量和拉黑队列数量。

## 0.2.12 - 2026-06-11

- 执行队列按钮跟随设置中的批量、间隔和模式。
- 新增手动立即拉黑按钮，并提示账号风险。

## 0.2.x - 2026-06-11

- 完成规则匹配、候选用户、白名单、拉黑队列、真实拉黑适配、重复用户去重、已拉黑数据库、页面命中提醒等功能。
