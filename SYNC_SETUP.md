# 私有 GitHub 仓库同步配置

网页仍由 GitHub Pages 托管；`worker/` 中的 Cloudflare Worker 作为受同步密钥保护的中间层，将个人学习数据写入单独的 GitHub 私有仓库。

## 1. 创建私有数据仓库

创建一个空的私有仓库，例如 `IELSnetwork-data`。不要把它设为 GitHub Pages 源，也不要将 GitHub Token 写入任何仓库文件。

创建 fine-grained GitHub Token，仅授权这个数据仓库，并授予 **Contents: Read and write**。这是 GitHub Contents API 创建和更新数据文件所需的权限。

## 2. 部署 Worker

在 Cloudflare 创建名为 `listenfolio-sync` 的 Worker，然后在 `worker` 目录执行：

```text
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_OWNER
npx wrangler secret put GITHUB_REPO
npx wrangler secret put SYNC_KEY
npx wrangler deploy
```

- `GITHUB_TOKEN`：上一步创建的 fine-grained Token。
- `GITHUB_OWNER`：私有数据仓库的用户名或组织名。
- `GITHUB_REPO`：私有数据仓库名称，不带 `.git`。
- `SYNC_KEY`：至少 12 个字符，建议使用随机生成的长密钥；每台设备首次配置时输入同一个值。

默认数据文件是 `data/listenfolio-state.json`，默认分支是 `main`。如需修改，编辑 `worker/wrangler.toml`。

如需让 GitHub Actions 自动部署 Worker，在当前网站仓库的 Actions Secrets 中配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

运行时的四个 Worker Secret 仍应通过 Cloudflare 控制台或 `wrangler secret put` 配置，不能提交到 Git。

## 3. 网页端启用同步

打开网站的“设置”，在“私有仓库同步”中填写：

- Worker 地址，例如 `https://listenfolio-sync.<account>.workers.dev`
- `SYNC_KEY` 的原始值

首次连接时，如果私有仓库还没有数据，当前浏览器的数据会自动上传；如果已经有数据，则优先加载云端版本。后续修改会在约一秒后自动同步。

## 安全说明

- GitHub Token 只存在 Cloudflare Worker Secret 中，不会发送到浏览器。
- 浏览器本地只保存 Worker 地址和同步密钥。
- Worker 只允许 `wrangler.toml` 中列出的网页 Origin。若使用自定义域名，请同时更新 `ALLOWED_ORIGINS`。
- 私有仓库会保留每次同步提交的历史；不要把该数据仓库改为公开。
