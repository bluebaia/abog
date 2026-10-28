---
name: blogkit-publish
description: 用户明确要求将文章发布或更新到 BlogKit 博客时使用；普通分析、整理草稿或预览不触发发布。
---

# 使用 BlogKit 发布博客文章

## 确认目标与权限

1. 读取根目录 `.blog/config.json`，从 `repository`、`writing`、`site` 获取目标仓库、标签和站点地址。读取 `.template/state.json` 中的 `resources.noteContainer.number`。目标以这些项目配置为准，不使用维护者的仓库、Issue 或网址。
2. 确认当前仓库等于配置中的 `owner/name`。不为其他仓库创建或修改内容。
3. 仅当用户明确要求发布或更新时写入 GitHub。分析、文章整理、预览和“帮我准备”只生成草稿。
4. 告知用户博客仓库、Issue 和评论均公开可读；未发布到站点不代表私密。

## 准备源稿

- 长文保存到带 `writing.blogLabel` 标签的 Issue 正文。标签由初始化任务创建。Issue 评论不会自动并入文章。
- 短文保存为 Note 容器中的一条评论。正文开头使用以下元数据，标签以英文逗号分隔：

  ```markdown
  <!-- title: 文章标题 -->
  <!-- description: 一句话摘要 -->
  <!-- tags: 随笔, AI-generated -->

  > **AI 生成内容（AI-generated content）**：本文由 AI 生成。

  正文从这里开始。
  ```

- AI 生成的文章正文应保留可见来源标识，并加入 `AI-generated` 标签。作者字段使用 `.blog/config.json` 中真实的 `site.author`；不把 AI 或助手名称写成作者。
- 更新已有文章时，以用户提供的源链接或 `.blog/receipts/` 中的来源 ID 定位。不得按标题猜测并覆盖文章，也不得为了标题变化更换源 Issue 或评论。
- 在写入前检查完整正文、标题、摘要、标签和目标 Issue。只修改用户选定的源稿，不顺带发布其他评论。

## 明确发布

1. 保存或更新源稿后，取得 Blog Issue URL，或 Note 评论中包含 `#issuecomment-ID` 的永久链接。
2. 使用 GitHub Actions 的 **Publish an article** 工作流，向 `source_url` 提交该链接。手动任务是唯一发布入口；创建或编辑 Issue/评论本身不会更新线上文章。
3. 若当前 GitHub 工具可以运行 workflow dispatch，直接触发任务并等待最终结果。否则提供工作流链接 `https://github.com/<owner>/<repo>/actions/workflows/publish-blog.yml` 和待填写的源链接，说明由用户在 GitHub 页面运行。
4. 只有工作流成功部署，或已核实线上文章对应本次快照后，才报告“已发布”。文章文件、来源回执或快照生成成功都不能单独作为上线证明。

## 返回与后续更新

报告源 Issue/评论链接、稳定文章地址和工作流结果。文章地址由源 ID 决定：Issue 使用 `blog-<Issue 编号>`，Note 使用 `note-<评论编号>`；更改标题后沿用相同源链接并再次明确运行发布任务。

工作流会在 `.blog/receipts/` 保存来源 URL、版本哈希、文件路径和文章地址。后续更新先读取该回执，再检查源稿作者及所属 Issue。不要另写一份可编辑的发布目标或回执。
