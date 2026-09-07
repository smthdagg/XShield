# Release Checklist

## GitHub 发布前

- [ ] 替换 `your-name/xshield` 为真实仓库地址。
- [ ] 替换 `security@example.com` 为真实安全邮箱。
- [ ] 替换 `.github/FUNDING.yml` 的赞助账号。
- [ ] 更新 `CHANGELOG.md`。
- [ ] 运行 `pnpm lint`。
- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm build`。
- [ ] Chrome 加载 `apps/extension/dist`。
- [ ] 手动测试弹窗、Dashboard、规则、候选池、队列、白名单、模拟执行。
- [ ] 谨慎测试真实拉黑。

## 建议 GitHub 仓库设置

- 开启 Issues。
- 开启 Discussions。
- 设置 Topics：`chrome-extension`, `twitter`, `x`, `spam-detection`, `typescript`, `react`, `manifest-v3`。
- 在 About 中写明：Local-first Chrome extension for X/Twitter spam account detection and block queue management.

## 发布流程（每次发版按此执行）

1. **审计**：`/ponytail-audit`（或 ponytail-review）扫描代码，采纳删除/简化项，修复后重跑测试。
2. **功能验证**：`pnpm lint` → `pnpm test` → `pnpm build`（CI 门禁必须全绿）。
3. **版本号**：同步更新四处 `manifest.json`、`apps/extension/package.json`、根 `package.json`、`apps/extension/src/projectInfo.ts`。
4. **CHANGELOG.md**：按 `## x.y.z - 日期` 追加本节变更。
5. **文档**：检查 README（中/英）与 `docs/USER_GUIDE.*` 是否有过期文字（同步机制、数字、按钮名），随功能更新。
6. **构建产物**：`pnpm build` 后确认 `apps/extension/dist/manifest.json` 版本号与本次一致。
7. **提交**：commit message 以版本号结尾（如 `feat: ... (1.1.19)`）；推送 `main`。
8. **打标签 + 发布**：`git tag v1.1.19 && git push origin v1.1.19`，`gh release create v1.1.19 --generate-notes`。
