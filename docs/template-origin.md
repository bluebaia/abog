# 模板来源与文件筛选

本仓库由个人博客项目经显式文件白名单导出，使用全新 Git 历史，不含原仓库文章或提交记录。

| 主题 | 官方源码 | 当前提交 | 文件清单 | 兼容版本 |
| --- | --- | --- | --- | --- |
| AstroPaper | [satnaing/astro-paper](https://github.com/satnaing/astro-paper) | `.template/theme-catalog.json` | `scripts/theme-files/astro-paper.json` | `.template/compatibility.json` |
| Astro Cactus | [chrismwilliams/astro-theme-cactus](https://github.com/chrismwilliams/astro-theme-cactus) | `.template/theme-catalog.json` | `scripts/theme-files/astro-cactus.json` | `.template/cactus-compatibility.json` |

当前启用主题、上游提交和逐文件摘要保存在 `.template/theme-source.json`。主题切换和每月更新都从官方仓库按兼容版本清单取源码，不依赖个人项目的 subtree 历史，也不直接跟随上游主分支。

白名单只包含主题运行需要的依赖、页面、布局、组件、样式、工具、图标与通用图片，不包括上游文章、About、示例内容或个人资源。配置、文章、About、资源和发布回执都保存在主题目录之外；主题许可证随源码保留在 `blog/LICENSE`。
