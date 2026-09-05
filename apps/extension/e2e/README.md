# E2E 功能验证（真实浏览器）

在真实 Chromium 中加载 `dist/` 构建产物，对 23 项功能做端到端核验：
扩展加载、内置词库种入、闹钟注册、面板五页渲染与版本徽标、词库数量、
真实网络同步、触发记录页节奏设置与空态、拉黑记录统计与近 7 天数据、
白名单增删持久化、设置页四区块、总开关写回、x.com 内容脚本注入、零未捕获异常。

运行（需系统可联网，首次需安装 chromium）：

```sh
npm i playwright && npx playwright install chromium
node e2e/e2e-check.mjs
```

输出 `23/23 passed` 即全部有效。headless 模式使用 `channel: 'chromium'`
（完整 Chromium 构建才支持加载扩展，headless-shell 不行）。
