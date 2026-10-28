# BlogKit

BlogKit 是一套创建和维护公开 Astro 博客的模板工具，支持 [AstroPaper](https://github.com/satnaing/astro-paper) 和 [Astro Cactus](https://github.com/chrismwilliams/astro-theme-cactus)。每个博客只启用一个主题，文章和设置由主题之外的统一配置维护。

## 创建博客

1. 使用 GitHub 的 **Use this template** 创建一个公开仓库。
2. 打开模板维护者托管的设置页面，填写博客资料并选择主题。
3. 复制生成的 JSON，打开新仓库 Actions 中的 **Configure BlogKit**。
4. 将 JSON 粘贴到 `configuration` 输入并运行任务。任务会校验设置、创建写作标签和 Note 容器，准备主题并在 Pages 已配置时发布站点。

设置页面的托管方式与首次 Pages 配置见 [docs/template-hosting.md](docs/template-hosting.md)。文章仓库是公开的；尚未发布到博客的源稿也可能被访问。Issue 和 Note 的手动发布方式见 [docs/publishing.md](docs/publishing.md)。
迁移已有公开文章的单次导入见 [docs/importing.md](docs/importing.md)。

## 本地预览

需要 Node.js 24 和 pnpm。

```sh
cd blog
pnpm install --frozen-lockfile
node ../scripts/sync-blog-assets.mjs
pnpm dev
```

配置字段、派生文件和文章目录见 [docs/configuration.md](docs/configuration.md)。主题差异、切换和每月更新方式见 [docs/template-updates.md](docs/template-updates.md)。主题源码来源、锁定版本和文件筛选说明见 [docs/template-origin.md](docs/template-origin.md)。
