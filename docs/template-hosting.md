# 配置页面与首次启用

配置页面是静态网页，不要求登录或个人访问令牌。它只读取公开仓库信息，在浏览器本地生成 `.blog/config.json`；真正的写入由用户在自己的 GitHub Actions 页面确认并执行。

## 创建博客

1. 使用 GitHub 的 **Use this template** 创建一个公开博客仓库。
2. 打开模板维护者托管的配置页面，输入博客仓库地址并填写站点资料。维护者发布后的入口形式为 `https://<owner>.github.io/<template>/setup/`；若模板使用自定义域名，则使用其 Pages 地址。
3. 页面会读取仓库默认分支和公开状态，推导 Pages 地址，并校验完整配置。复制结果后，打开新仓库 Actions 中的 **Configure BlogKit** 工作流。
4. 将完整 JSON 粘贴到 `configuration` 输入并运行。任务会创建 Note/Blog 标签及 Note 容器，保存唯一设置文件，并检查 Pages 状态。
5. 首次运行若提示 Pages 尚未就绪，在仓库 **Settings → Pages** 中选择 **GitHub Actions** 作为来源，然后重新运行该任务。设置完成后任务会校验站点并发布 Pages。

写作 Issue 和 Note 评论位于公开仓库中。它们在明确发布前不会进入博客站点，但不能视为私密草稿。

## 托管模板配置页面

此操作只由模板维护者在公开模板仓库中执行一次：

1. 在模板仓库 **Settings → Pages** 中，将来源设为 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions → Variables** 添加变量 `PUBLISH_SETUP_PAGE`，值设为 `true`。
3. 在 Actions 页面手动运行 **Publish template setup page**。完成摘要会给出可分享的入口地址。

配置页面发布工作流只上传 `setup/`、共享配置校验器和本指南，不会公开仓库中的个人内容。模板生成的新博客不会继承 `PUBLISH_SETUP_PAGE` 仓库变量，因此不会把设置页面部署到博客站点。
