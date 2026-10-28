# 主题选择、切换与更新

设置页提供 AstroPaper 和 Astro Cactus。AstroPaper 提供归档页与分享按钮；Astro Cactus 使用暖色卡片布局，提供标签、搜索、RSS 和生成的分享图，Note 与长文章显示在同一列表，不提供独立归档页或分享按钮。两种主题共用单一配置、统一文章模型、稳定文章地址和 Pages 项目子路径适配。

## 模板核心升级

模板自身版本记录在 .template/template-version.json，和主题兼容版本分开管理。维护者发布模板核心更新时，应递增此版本并使用相同版本号创建 GitHub Release。版本状态为 unreleased 时，说明当前代码尚未作为正式模板版本发布。

博客所有者可在浏览器打开模板仓库的 Releases 页面及对应版本比较页，审查核心代码、配置 schema、workflow 和文档变更，再把确认过的文件作为自己的仓库变更提交。模板核心代码不自动覆盖用户文件；主题源码继续由每月更新任务单独通过 PR 管理。

选择新主题后，在博客仓库的 Actions 页面运行 **Configure BlogKit**。任务从兼容清单固定的官方提交准备主题，保留 `.blog/config.json`、文章、About、个人资源、发布回执和初始化状态，运行 Astro 校验，再保存并在 Pages 已启用时发布。若受管理的主题源码被本地改动，切换会先停止并指出冲突文件。

`.github/workflows/update-theme.yml` 每月检查当前启用主题的最新稳定发行版，也支持从 Actions 页面手动触发。通过 Astro 检查和站点输出校验后，任务会创建或更新 `automation/update-astro-paper` 或 `automation/update-astro-cactus` 分支上的 PR。维护任务不自动合并；没有白名单源码变化时不会创建空 PR。失败时会提供未验证源码补丁，兼容清单不会登记失败版本。

首次使用更新任务前，在 **Settings → Actions → General → Workflow permissions** 开启 **Allow GitHub Actions to create and approve pull requests**。

手动准备当前 AstroPaper 的最新稳定版候选：

```sh
node scripts/update-blog-template.mjs --latest --propose
```

手动准备当前 Astro Cactus 的最新稳定版候选：

```sh
node scripts/update-cactus-theme.mjs --latest --propose
```

固定版本时同时提供 `--ref <tag>`、`--commit <完整提交 SHA>` 和 `--propose`。候选通过 `pnpm --dir blog exec astro check` 及站点输出检查后，由工作流将精确来源登记为兼容版本。配置、文章、About 和 `.blog/assets/` 不属于上游主题清单，会保留。
