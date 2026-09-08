# Release Checklist

## GitHub 发布前

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
6. **构建产物**：`pnpm build` 后确认 `apps/extension/dist/manifest.json` 版本号与本次一致；可选本地打包验证 `node scripts/package-extension.mjs`。
7. **提交**：commit message 以版本号结尾（如 `feat: ... (1.1.19)`）；推送 `main`。
8. **打标签发布（自动打包）**：`git tag v1.2.0 && git push origin v1.2.0`——推送 `v*` 标签即触发 `.github/workflows/release.yml`：自动 lint/test/build、`node scripts/package-extension.mjs` 打成 `xshield-vX.Y.Z.zip`，并创建 GitHub Release 上传该安装包。Release 页提供解压即用的安装包。
9. **发布失败时的本地兜底**：若 CI 未跑或想先手动发布，可本地执行 `pnpm build && node scripts/package-extension.mjs`，然后 `gh release create vX.Y.Z --generate-notes xshield-vX.Y.Z.zip`（或对已存在的 Release 用 `gh release upload vX.Y.Z xshield-vX.Y.Z.zip --clobber`）。
