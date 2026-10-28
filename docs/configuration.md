# 博客配置

根目录 `.blog/config.json` 是博客设置的唯一可编辑来源，包含仓库身份、写作标签与容器标题、站点资料、首页内容、文章分页、功能开关、社交链接和当前主题。模板中的仓库和个人资料是占位值；浏览器向导会按目标仓库生成对应配置。AstroPaper 与 Astro Cactus 都从这份配置读取标题、作者、语言、主题选择和 Pages 项目子路径。

`blog/astro-paper.config.ts` 是 AstroPaper 的衍生配置；Astro Cactus 适配器直接从该配置读取站点设置。主题切换工作流会按已验证清单准备上游源码，运行校验后再保存和发布，不需要用户编辑衍生文件。

运行 `node scripts/validate-blog-config.mjs` 检查配置。文章放在 `.blog/content/posts/`，About 页面放在 `.blog/content/pages/about.md`，个人资源放在 `.blog/assets/`。每篇文章使用稳定的 `slug` 和 `identity` 元数据；标题或主题变更不会改写文章地址。本模板面向公开博客，提交到仓库的文章和设置会公开可见。

本地预览前运行 `node scripts/sync-blog-assets.mjs`，它会将 `.blog/assets/` 同步到当前主题的公开资源目录。文章正文用相对地址 `../../assets/<文件名>` 引用资源；About 页面用 `../assets/<文件名>`。资源名需能在 Windows、macOS 和 Linux 文件系统中检出。
